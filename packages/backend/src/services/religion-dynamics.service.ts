// ============================================================
// RELIGION DYNAMICS SERVICE — Phase 7 Wave 5
// ------------------------------------------------------------
// Annual self-driven conversion pass. Complements the existing
// viral (exposure-based) join mechanic in membership.service —
// this runs once per year at the boundary and lets people seek
// out faith on their own when they're in a "doubt" state.
//
// Doubt signal: low happiness OR low faith.devotion. Non-members
// in this state scan all active religions and join the one they
// align best with, provided alignment ≥ CONVERSION_ALIGNMENT.
//
// Bounded by:
//   - CONVERSION_POOL_FRACTION of living population per year
//   - Only truly non-member persons are considered
//   - Alignment bar is higher than viral join (no "close enough"
//     conversions — people have to genuinely fit)
// ============================================================

import { Prisma, Tone } from '@prisma/client';
import {
  computeAlignment,
  type GroupSnapshot,
  type PersonSnapshot,
} from './membership.service';
import { writeMemoriesBatch, type MemoryWriteInput } from './memory.service';

// ── Tunables ────────────────────────────────────────────────
/** Alignment threshold for self-conversion. Intentionally higher
 *  than MIN_ALIGNMENT_JOIN (viral 0.75) — doubt-driven converts are
 *  picky, they're looking for a spiritual home, not just company. */
const CONVERSION_ALIGNMENT = 0.85;
/** Cap on how much of the population converts per year. At 2%
 *  civ-tier worlds (5000 souls) convert ≤100/year. */
const CONVERSION_POOL_FRACTION = 0.02;
const CONVERSION_HARD_CAP = 100;
/** Happiness at/below this is a doubt signal. */
const DOUBT_HAPPINESS_MAX = 40;
/** faith.devotion at/below this is a doubt signal. */
const DOUBT_FAITH_MAX = 30;

export interface ConversionEvent {
  person_id:     string;
  religion_id:   string;
  religion_name: string;
  alignment:     number;
}

export interface ConversionRunResult {
  conversions: ConversionEvent[];
}

/**
 * Pick the subset of `snapshots` that qualifies as "in doubt". We cap at
 * CONVERSION_POOL_FRACTION of population (hard cap 100) to keep the cost
 * bounded at civ tier. Random sampling inside the doubt pool avoids the
 * same 100 unhappiest people converting year after year.
 */
function selectDoubters(
  snapshots: PersonSnapshot[],
): PersonSnapshot[] {
  const doubters = snapshots.filter(p => {
    if (p.happiness <= DOUBT_HAPPINESS_MAX) return true;
    const devotion = p.global_scores['faith.devotion'];
    return typeof devotion === 'number' && devotion <= DOUBT_FAITH_MAX;
  });

  const cap = Math.min(CONVERSION_HARD_CAP, Math.ceil(snapshots.length * CONVERSION_POOL_FRACTION));
  if (doubters.length <= cap) return doubters;

  // Fisher-Yates partial shuffle — picks `cap` distinct doubters without
  // mutating or fully sorting the source array.
  const shuffled = [...doubters];
  for (let i = 0; i < cap; i++) {
    const j = i + Math.floor(Math.random() * (shuffled.length - i));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, cap);
}

/**
 * Annual self-driven religion conversion. Non-members in a doubt state
 * scan all active religions and join the one they align best with, as
 * long as alignment clears CONVERSION_ALIGNMENT. Writes memberships +
 * conversion memories in-transaction.
 */
export async function runReligionConversionPass(
  tx:       Prisma.TransactionClient,
  snapshots: PersonSnapshot[],
  religions: GroupSnapshot[],
  memberships: { religionsByPerson: Map<string, Set<string>> },
  worldYear: number,
): Promise<ConversionRunResult> {
  if (religions.length === 0 || snapshots.length === 0) {
    return { conversions: [] };
  }

  // A "non-member" for conversion purposes is anyone not in ANY religion —
  // keeps the model simple (no polytheism via conversion). Existing viral
  // joins can still add people to multiple religions if profiles overlap.
  const pool = selectDoubters(snapshots).filter(
    p => (memberships.religionsByPerson.get(p.id)?.size ?? 0) === 0,
  );
  if (pool.length === 0) return { conversions: [] };

  const events: ConversionEvent[] = [];
  const memberRows: { person_id: string; religion_id: string; joined_year: number; alignment: number }[] = [];
  const memories:   MemoryWriteInput[] = [];

  for (const person of pool) {
    let best: { religion: GroupSnapshot; alignment: number } | null = null;
    for (const r of religions) {
      const a = computeAlignment(person, r.virus_profile, r.tolerance);
      if (a < CONVERSION_ALIGNMENT) continue;
      if (!best || a > best.alignment) best = { religion: r, alignment: a };
    }
    if (!best) continue;

    memberRows.push({
      person_id:   person.id,
      religion_id: best.religion.id,
      joined_year: worldYear,
      alignment:   best.alignment,
    });
    memories.push({
      personId:        person.id,
      eventSummary:    `Found faith in ${best.religion.name}.`,
      emotionalImpact: 'positive',
      deltaApplied:    { conversion: best.religion.id, alignment: best.alignment },
      magnitude:       0.7,
      worldYear,
      tone:            Tone.literary,
      eventKind:       'group_joined',
    });
    events.push({
      person_id:     person.id,
      religion_id:   best.religion.id,
      religion_name: best.religion.name,
      alignment:     best.alignment,
    });
  }

  if (memberRows.length > 0) {
    await tx.religionMembership.createMany({
      data:           memberRows,
      skipDuplicates: true,
    });
    await writeMemoriesBatch(tx, memories);
  }

  return { conversions: events };
}
