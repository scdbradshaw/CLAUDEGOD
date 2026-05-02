// Bucket stat drift (Phase 4).
//
// Slow random walk on the 5 bucket stat averages so worlds don't sit
// frozen at their seed values. Birth/death rates and avg_age are NOT
// drifted — they're either set at seed (rates) or computed from births
// (age). All drift is clamped to [0, 100].
//
// Magnitude is intentionally small: events should still dominate the
// signal. Phase 4 alone with no events should yield a barely-perceptible
// walk over 50 years (~ ±5 points expected from a ±0.5/yr step).

import type { Rng } from '../../lib/rng';
import type { BucketState } from './types';

export const DRIFT_STEP_MAX = 0.5;

const DRIFTED_FIELDS = [
  'avg_intelligence',
  'avg_combat',
  'avg_health',
  'avg_happiness',
  'avg_sexuality',
] as const;

export function applyDrift(buckets: BucketState[], rng: Rng): BucketState[] {
  return buckets.map((b) => {
    if (b.count <= 0) return { ...b };
    const out: BucketState = { ...b };
    for (const f of DRIFTED_FIELDS) {
      const step = (rng.next() * 2 - 1) * DRIFT_STEP_MAX;
      out[f] = clamp(round2(b[f] + step), 0, 100);
    }
    return out;
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
