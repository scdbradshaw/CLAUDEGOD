// Outlaw theft (Phase 10 — DESIGN.md §6.3).
//
// Once per year, the city's Outlaw bucket extracts wealth from each strictly
// richer same-city bucket. Per user direction (2026-04-30): the **full**
// stolen amount lands in the Outlaw bucket — no void / loss split.
//
//   stolen_from_X = OUTLAW_THEFT_RATE × (X.count × X.avg_wealth)
//
// Outlaw bucket gains the sum of all stolen_from_X. If the Outlaw bucket has
// `count = 0`, theft is a no-op (no thieves exist).
//
// Pure: returns new bucket array + diagnostics.

import { OUTLAW_THEFT_RATE } from '@claude-god/shared';
import type { BucketState } from '../bucket-dynamics/types';

export interface TheftStepResult {
  buckets: BucketState[];
  /** Diagnostic — total wealth moved this step. */
  total_stolen: number;
  /** Diagnostic — per-victim-type breakdown. */
  per_victim: Array<{ type: BucketState['type']; stolen: number }>;
}

export function applyTheft(buckets: BucketState[]): TheftStepResult {
  const outlaw = buckets.find((b) => b.type === 'Outlaw');
  if (!outlaw || outlaw.count <= 0) {
    return {
      buckets: buckets.map((b) => ({ ...b })),
      total_stolen: 0,
      per_victim: [],
    };
  }
  const outlawWealthPerCap = outlaw.avg_wealth;
  const next: BucketState[] = [];
  let totalStolen = 0;
  const perVictim: TheftStepResult['per_victim'] = [];

  for (const b of buckets) {
    if (b.type === 'Outlaw' || b.count <= 0 || b.avg_wealth <= outlawWealthPerCap) {
      next.push({ ...b });
      continue;
    }
    const totalWealth = b.count * b.avg_wealth;
    const stolen = Math.floor(totalWealth * OUTLAW_THEFT_RATE);
    if (stolen <= 0) {
      next.push({ ...b });
      continue;
    }
    const newTotal = Math.max(0, totalWealth - stolen);
    const newAvgWealth = b.count > 0 ? Math.round(newTotal / b.count) : 0;
    next.push({ ...b, avg_wealth: newAvgWealth });
    totalStolen += stolen;
    perVictim.push({ type: b.type, stolen });
  }

  // Credit Outlaw bucket with the full stolen sum (per user override).
  const outlawTotalBefore = outlaw.count * outlaw.avg_wealth;
  const outlawTotalAfter = outlawTotalBefore + totalStolen;
  const newOutlawAvg =
    outlaw.count > 0 ? Math.round(outlawTotalAfter / outlaw.count) : 0;

  // Replace the Outlaw entry in `next` with credited version.
  const finalBuckets = next.map((b) =>
    b.type === 'Outlaw' ? { ...b, avg_wealth: newOutlawAvg } : b,
  );

  return {
    buckets: finalBuckets,
    total_stolen: totalStolen,
    per_victim: perVictim,
  };
}
