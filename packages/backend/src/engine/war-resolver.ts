// Phase 13a — War resolver (§8.5).
//
// Pure logic. The service supplies both sides of an active FactionWar; this
// module decides whether the war should end now and why.
//
// Sam's v1 ruleset: peace and spoils are deferred. A war ends when EITHER
// side hits zero on any of: army_size, treasury, or member_count_cached.

export interface FactionSnapshot {
  id: string;
  name: string;
  army_size: number;
  treasury: number;
  member_count_cached: number;
  is_active: boolean;
}

export type WarEndReason =
  | 'side_a_dissolved'
  | 'side_b_dissolved'
  | 'side_a_no_army'
  | 'side_b_no_army'
  | 'side_a_broke'
  | 'side_b_broke'
  | 'side_a_no_members'
  | 'side_b_no_members';

export interface WarEvaluation {
  ended: boolean;
  reason?: WarEndReason;
  loser_id?: string;
}

/** Returns the first end-trigger encountered, with side-A checked first. */
export function evaluateWarEnd(
  a: FactionSnapshot,
  b: FactionSnapshot,
): WarEvaluation {
  if (!a.is_active) return { ended: true, reason: 'side_a_dissolved', loser_id: a.id };
  if (!b.is_active) return { ended: true, reason: 'side_b_dissolved', loser_id: b.id };

  if (a.member_count_cached <= 0)
    return { ended: true, reason: 'side_a_no_members', loser_id: a.id };
  if (b.member_count_cached <= 0)
    return { ended: true, reason: 'side_b_no_members', loser_id: b.id };

  if (a.army_size <= 0)
    return { ended: true, reason: 'side_a_no_army', loser_id: a.id };
  if (b.army_size <= 0)
    return { ended: true, reason: 'side_b_no_army', loser_id: b.id };

  if (a.treasury <= 0) return { ended: true, reason: 'side_a_broke', loser_id: a.id };
  if (b.treasury <= 0) return { ended: true, reason: 'side_b_broke', loser_id: b.id };

  return { ended: false };
}
