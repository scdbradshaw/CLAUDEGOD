// Phase 8 — Per-year real-person target picker (DESIGN.md §9.4).
//
// Given a RealPersonTargetRule and a candidate pool (already scope-filtered
// by the caller), draw `[count_min, count_max]` victims via seeded RNG without
// replacement. Returns the picked Person.id list. Caller maps the rule's
// `apply` directive (kill / state_tag / health_delta) into actual mutations.

import type { RealPersonTargetRule } from '@claude-god/shared';
import type { Rng } from '../../lib/rng';

export interface CandidateLite {
  id: string;
  city_id?: string | null;
  type?: string | null;
  faction_id?: string | null;
}

/** Filter `candidates` by the rule's `pool`, then draw N in [min,max] without
 *  replacement. Returns at most `count_max` ids. Empty pool → empty result. */
export function pickEventVictims(
  rule: RealPersonTargetRule,
  candidates: CandidateLite[],
  rng: Rng,
): string[] {
  const pool = candidates.filter((c) => {
    if (rule.pool.city_id !== undefined && c.city_id !== rule.pool.city_id) return false;
    if (rule.pool.type !== undefined && c.type !== rule.pool.type) return false;
    if (rule.pool.faction_id !== undefined && c.faction_id !== rule.pool.faction_id) return false;
    return true;
  });
  if (pool.length === 0) return [];

  const target =
    rule.count_min === rule.count_max
      ? rule.count_min
      : rng.intInclusive(rule.count_min, rule.count_max);
  const n = Math.min(target, pool.length);
  if (n <= 0) return [];

  // Fisher-Yates partial shuffle for the first n picks.
  const arr = pool.slice();
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rng.next() * (arr.length - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, n).map((c) => c.id);
}
