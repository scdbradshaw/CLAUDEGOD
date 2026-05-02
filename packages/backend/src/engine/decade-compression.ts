// Decade compression (Phase 6 — DESIGN.md §5.4).
//
// On every birthday where `age % 10 === 0`, take the top-N memories of the
// past decade and promote them to a `LifeDecadeSummary` row. Raw entries
// outside that top-N are condensed (dropped from the buffer). Buffer keeps
// rolling. Chains via `prior_summary_id`.
//
// Pure: returns the summary payload + reduced buffer. The caller persists.

import {
  DECADE_COMPRESSION_INTERVAL,
  type Memory,
  type RankedDecadeMemory,
} from '@claude-god/shared';

/** How many top-N memories the summary keeps. */
const RANKED_KEEP = 5;

export interface CompressDecadeInput {
  memories: Memory[];
  /** Person's *new* age (post-aging). Compression triggers at multiples of 10. */
  age: number;
  /** Year compression runs in (= world year). */
  year: number;
  /** Last summary's id (null if none). */
  prior_summary_id?: string | null;
}

export interface CompressDecadeResult {
  /** Trigger fired? `age % interval === 0 && age > 0`. */
  triggered: boolean;
  /** New buffer (may be unchanged if no trigger). */
  buffer: Memory[];
  /** Summary payload to insert. Only populated if triggered. */
  summary: {
    decade_start_year: number;
    ranked_memories: RankedDecadeMemory[];
    prior_summary_id: string | null;
  } | null;
}

export function shouldCompress(age: number): boolean {
  return age > 0 && age % DECADE_COMPRESSION_INTERVAL === 0;
}

/**
 * Apply decade compression. Memory entries from the *current* decade are
 * ranked by magnitude; top-RANKED_KEEP go into the summary. The buffer is
 * trimmed to drop those promoted entries (older entries from prior decades
 * are also dropped — anything before `decade_start_year`).
 */
export function compressDecade(input: CompressDecadeInput): CompressDecadeResult {
  if (!shouldCompress(input.age)) {
    return { triggered: false, buffer: input.memories, summary: null };
  }
  const decadeStart = input.year - DECADE_COMPRESSION_INTERVAL;
  const inDecade = input.memories.filter((m) => m.year >= decadeStart);
  const ranked = [...inDecade]
    .sort((a, b) => b.magnitude - a.magnitude || b.year - a.year)
    .slice(0, RANKED_KEEP);

  const promotedKey = new Set(
    ranked.map((m) => `${m.year}|${m.kind}|${m.summary}|${m.magnitude}`),
  );
  // Buffer keeps non-promoted, in-decade entries (so the rolling buffer
  // doesn't lose recent low-magnitude texture). Drops anything older than
  // the decade boundary.
  const buffer = input.memories.filter(
    (m) =>
      m.year >= decadeStart &&
      !promotedKey.has(`${m.year}|${m.kind}|${m.summary}|${m.magnitude}`),
  );

  return {
    triggered: true,
    buffer,
    summary: {
      decade_start_year: decadeStart,
      ranked_memories: ranked.map(
        (m): RankedDecadeMemory => ({
          year: m.year,
          kind: m.kind,
          summary: m.summary,
          magnitude: m.magnitude,
          tone: m.tone,
        }),
      ),
      prior_summary_id: input.prior_summary_id ?? null,
    },
  };
}
