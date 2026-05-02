// Bucket-level deaths (Phase 4 — DESIGN.md §7.3).
//
// `count -= round(count × death_rate × jitter)`. Total bucket wealth is
// preserved (survivors inherit from the dead, raising avg_wealth slightly).
// Real-person deaths + inheritance distribution land in Phase 5.
//
// IMPORTANT — two-tier accounting (§19):
// `bucket.count` includes both aggregate NPCs and real persons of that type.
// Real persons have their own death roll (archiveAndDeleteTx) which also
// decrements bucket.count. To avoid double-counting, bucket-dynamics deaths
// are applied only to the AGGREGATE portion: (count - real_count). The real
// persons' slice is added back unchanged so the total stays consistent.

import type { Rng } from '../../lib/rng';
import type { BucketState } from './types';

/** ±10% jitter on deaths. */
export const DEATH_JITTER = 0.10;

export interface DeathsStepResult {
  buckets: BucketState[];
  /** Diagnostic — total deaths this year. */
  total_deaths: number;
}

/**
 * @param real_person_counts  Optional map of PersonType → number of alive real
 *   persons of that type in this city. When provided, deaths are applied only
 *   to the aggregate-NPC portion of each bucket (count − real_count) so that
 *   the subsequent real-person archiveAndDeleteTx decrements don't push the
 *   count negative.
 */
export function applyDeaths(
  buckets: BucketState[],
  rng: Rng,
  real_person_counts?: Record<string, number>,
): DeathsStepResult {
  let totalDeaths = 0;
  const next = buckets.map((b) => {
    if (b.count <= 0 || b.death_rate <= 0) return { ...b };

    // Only kill aggregate NPCs; real persons have their own death roll.
    const realCount = real_person_counts?.[b.type] ?? 0;
    const aggregateCount = Math.max(0, b.count - realCount);
    if (aggregateCount === 0) return { ...b };

    const expected = aggregateCount * b.death_rate;
    const jitter = 1 + (rng.next() * 2 - 1) * DEATH_JITTER;
    let deaths = Math.max(0, Math.round(expected * jitter));
    // Cap so aggregate portion can't go negative.
    if (deaths >= aggregateCount) deaths = aggregateCount;
    if (deaths === 0) return { ...b };

    totalDeaths += deaths;
    const newCount = b.count - deaths; // real persons preserved in total
    const totalWealth = b.count * b.avg_wealth; // survivors inherit
    if (newCount === 0) {
      return { ...b, count: 0, avg_wealth: 0 };
    }
    const newAvgWealth = Math.max(0, Math.round(totalWealth / newCount));
    return { ...b, count: newCount, avg_wealth: newAvgWealth };
  });
  return { buckets: next, total_deaths: totalDeaths };
}
