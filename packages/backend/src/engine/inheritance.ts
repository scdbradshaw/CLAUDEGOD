// Phase 13a — Inheritance distribution (§7.4).
//
// Pure planner. Takes a decedent's wealth + candidate heirs and returns the
// list of transfers to apply. Cascade order:
//   1. Living spouse              → 100%
//   2. Eldest living child        → 100%
//   3. Active faction + religion  → split 50/50
//   4. Active faction only        → 100%
//   5. Active religion only       → 100%
//   6. City                       → 100%
//
// "Active" means the group still has is_active=true at decedent's death year.
// The DB lookups happen in `inheritance.service.ts`; this file is only logic.

export type InheritanceTarget =
  | { kind: 'spouse'; person_id: string; amount: number }
  | { kind: 'child'; person_id: string; amount: number }
  | { kind: 'faction'; group_id: string; amount: number }
  | { kind: 'religion'; group_id: string; amount: number }
  | { kind: 'city'; city_id: string; amount: number };

export interface DecedentInfo {
  id: string;
  wealth: number;
  faction_id: string | null;
  religion_id: string | null;
  city_id: string;
}

export interface InheritanceCandidates {
  /** Living spouse (already filtered to is_alive=true). */
  spouse: { id: string } | null;
  /** Eldest living child (already filtered + ordered). */
  eldest_child: { id: string } | null;
  /** Whether the decedent's faction (if any) is still is_active. */
  faction_active: boolean;
  /** Whether the decedent's religion (if any) is still is_active. */
  religion_active: boolean;
}

/**
 * Returns the list of transfers to execute. Empty list if wealth <= 0.
 * Each amount is a non-negative integer; sums equal `decedent.wealth`.
 */
export function planInheritance(
  decedent: DecedentInfo,
  c: InheritanceCandidates,
): InheritanceTarget[] {
  if (decedent.wealth <= 0) return [];
  const w = decedent.wealth;

  // 1. Spouse
  if (c.spouse) {
    return [{ kind: 'spouse', person_id: c.spouse.id, amount: w }];
  }
  // 2. Eldest child
  if (c.eldest_child) {
    return [{ kind: 'child', person_id: c.eldest_child.id, amount: w }];
  }
  // 3. Faction + religion split (50/50; remainder cent goes to faction)
  if (c.faction_active && c.religion_active && decedent.faction_id && decedent.religion_id) {
    const half = Math.floor(w / 2);
    return [
      { kind: 'faction', group_id: decedent.faction_id, amount: w - half },
      { kind: 'religion', group_id: decedent.religion_id, amount: half },
    ];
  }
  // 4. Faction only
  if (c.faction_active && decedent.faction_id) {
    return [{ kind: 'faction', group_id: decedent.faction_id, amount: w }];
  }
  // 5. Religion only
  if (c.religion_active && decedent.religion_id) {
    return [{ kind: 'religion', group_id: decedent.religion_id, amount: w }];
  }
  // 6. City fallback
  return [{ kind: 'city', city_id: decedent.city_id, amount: w }];
}
