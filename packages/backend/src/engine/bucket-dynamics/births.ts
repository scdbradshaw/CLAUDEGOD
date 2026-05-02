// Bucket-level births (Phase 4 — DESIGN.md §7.1).
//
// `count += round(count × birth_rate × jitter)`. Total wealth is preserved
// across the birth (children enter at 0 wealth → avg_wealth dilutes
// proportionally to the new headcount).
//
// Real-person pregnancies are deferred to Phase 5.

import type { Rng } from '../../lib/rng';
import type { BucketState } from './types';

/** ±10% jitter on births so populations vary year-to-year. */
export const BIRTH_JITTER = 0.10;

export interface BirthsStepResult {
  buckets: BucketState[];
  /** Diagnostic — total births this year. */
  total_births: number;
}

export function applyBirths(buckets: BucketState[], rng: Rng): BirthsStepResult {
  let totalBirths = 0;
  const next = buckets.map((b) => {
    if (b.count <= 0 || b.birth_rate <= 0) return { ...b };
    const expected = b.count * b.birth_rate;
    const jitter = 1 + (rng.next() * 2 - 1) * BIRTH_JITTER;
    const births = Math.max(0, Math.round(expected * jitter));
    if (births === 0) return { ...b };

    totalBirths += births;
    const totalWealth = b.count * b.avg_wealth; // children at 0 wealth
    const newCount = b.count + births;
    const newAvgWealth = Math.max(0, Math.round(totalWealth / newCount));
    // Births also pull avg_age toward 0 — mass-weighted: existing avg_age × old_count
    // + 0 × births, all over new_count.
    const newAvgAge = (b.avg_age * b.count) / newCount;
    return {
      ...b,
      count: newCount,
      avg_wealth: newAvgWealth,
      avg_age: round2(newAvgAge),
    };
  });
  return { buckets: next, total_births: totalBirths };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
