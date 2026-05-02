// Relationship-bond engine (Phase 6 — DESIGN.md §5.5).
//
// Pure planner for the cap-5 declared-bond rule. The service layer takes the
// plan and applies it (DB writes + "drifted apart" memory entry on the owner).

import { DECLARED_BONDS_CAP, type RelationshipKind } from '@claude-god/shared';

/** Slim row for the planner — just what bond-cap logic needs. */
export interface BondRow {
  /** Optional id — present for existing rows, absent for the candidate. */
  id?: string;
  target_id: string;
  kind: RelationshipKind;
  strength: number;
  set_year: number;
}

export interface AddBondPlan {
  /** Final list (≤ cap). Includes the new bond if accepted. */
  kept: BondRow[];
  /** Existing bond evicted by the cap, or null if none. */
  evicted: BondRow | null;
  /** Was the new bond added? (Always true unless caller passed dup.) */
  added: boolean;
}

/**
 * Plan adding a new bond to the existing list:
 *   - if a bond with same (target_id, kind) exists, update its strength/year
 *     in place — no eviction (returns added=true, evicted=null).
 *   - else if list is at cap, evict the lowest-strength existing bond
 *     (ties broken by oldest set_year first).
 *   - returns the new list and the evicted row (if any).
 */
export function planAddBond(
  existing: BondRow[],
  candidate: BondRow,
  cap: number = DECLARED_BONDS_CAP,
): AddBondPlan {
  const dupIdx = existing.findIndex(
    (b) => b.target_id === candidate.target_id && b.kind === candidate.kind,
  );
  if (dupIdx >= 0) {
    const kept = existing.slice();
    kept[dupIdx] = { ...kept[dupIdx], strength: candidate.strength, set_year: candidate.set_year };
    return { kept, evicted: null, added: true };
  }

  if (existing.length < cap) {
    return { kept: [...existing, candidate], evicted: null, added: true };
  }

  // Cap hit — evict lowest-strength (oldest tiebreak).
  let evictIdx = 0;
  for (let i = 1; i < existing.length; i++) {
    const cur = existing[evictIdx];
    const cand = existing[i];
    if (cand.strength < cur.strength) {
      evictIdx = i;
    } else if (cand.strength === cur.strength && cand.set_year < cur.set_year) {
      evictIdx = i;
    }
  }
  const evicted = existing[evictIdx];
  // If the candidate is *weaker* than the weakest existing bond, the new
  // bond loses — keep the list and reject the candidate.
  if (candidate.strength < evicted.strength) {
    return { kept: existing.slice(), evicted: null, added: false };
  }
  const kept = existing.filter((_, i) => i !== evictIdx).concat(candidate);
  return { kept, evicted, added: true };
}
