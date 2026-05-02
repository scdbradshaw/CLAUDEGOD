// Sample faction/religion at materialization (Phase 7).
//
// New real persons inherit their bucket's group affiliation distribution as
// a categorical draw. The implicit residual (1 - Σ shares) is "unaffiliated."
// Pure: takes a shares map + rng, returns the picked groupId or null.

import type { GroupShares } from '@claude-god/shared';
import type { Rng } from '../../lib/rng';

/**
 * Categorical sample from a {groupId: share} map. Returns null if the random
 * draw lands in the implicit unaffiliated residual.
 */
export function sampleAffiliation(shares: GroupShares, rng: Rng): string | null {
  const r = rng.next();
  let acc = 0;
  for (const [id, share] of Object.entries(shares)) {
    if (share <= 0) continue;
    acc += share;
    if (r < acc) return id;
  }
  return null;
}
