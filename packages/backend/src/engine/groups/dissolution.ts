// Group dissolution + leader succession (Phase 7 — DESIGN.md §8.3).
//
// Triggers (either):
//   - Member count < GROUP_DISSOLUTION_MIN_MEMBERS for
//     GROUP_DISSOLUTION_GRACE_YEARS consecutive years.
//   - Leader dies and no member satisfies (intelligence ≥ 50 + tag_overlap ≥ 2).
//
// Pure planners; the service layer applies side effects (status flip, treasury
// distribution, memory writes).

import {
  GROUP_DISSOLUTION_GRACE_YEARS,
  GROUP_DISSOLUTION_MIN_MEMBERS,
  type PersonalityTag,
} from '@claude-god/shared';

export interface DissolutionEvalInput {
  memberCount: number;
  /** Counter on Group: how many consecutive low-membership years so far. */
  lowMembershipYears: number;
}

export type DissolutionAction =
  | { kind: 'dissolve'; reason: 'low-membership' }
  | { kind: 'increment-grace'; nextLowMembershipYears: number }
  | { kind: 'reset-grace' }
  | { kind: 'noop' };

/**
 * Evaluate dissolution by member count. Caller separately checks leader-loss.
 */
export function evaluateDissolution(input: DissolutionEvalInput): DissolutionAction {
  const isLow = input.memberCount < GROUP_DISSOLUTION_MIN_MEMBERS;
  if (!isLow) {
    return input.lowMembershipYears > 0 ? { kind: 'reset-grace' } : { kind: 'noop' };
  }
  const next = input.lowMembershipYears + 1;
  if (next >= GROUP_DISSOLUTION_GRACE_YEARS) {
    return { kind: 'dissolve', reason: 'low-membership' };
  }
  return { kind: 'increment-grace', nextLowMembershipYears: next };
}

// ─── Successor selection ────────────────────────────────────────────────────

/** Leader-succession qualification: §8.3 floor. */
export const SUCCESSOR_INTELLIGENCE_MIN = 50;
export const SUCCESSOR_TAG_OVERLAP_MIN = 2;

export interface SuccessorCandidate {
  id: string;
  intelligence: number;
  personality_tags: PersonalityTag[];
}

export interface SuccessorContext {
  /** Tags that defined the founding leader's bent (or current leader's). */
  leaderReferenceTags: PersonalityTag[];
}

/**
 * Pick a successor from `candidates`. Returns the best-overlap qualifying
 * candidate, or null if none qualify (→ caller should dissolve).
 */
export function pickSuccessor(
  candidates: SuccessorCandidate[],
  ctx: SuccessorContext,
): SuccessorCandidate | null {
  let best: SuccessorCandidate | null = null;
  let bestOverlap = -1;

  for (const c of candidates) {
    if (c.intelligence < SUCCESSOR_INTELLIGENCE_MIN) continue;
    const overlap = c.personality_tags.filter((t) =>
      ctx.leaderReferenceTags.includes(t),
    ).length;
    if (overlap < SUCCESSOR_TAG_OVERLAP_MIN) continue;
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && best != null && c.intelligence > best.intelligence)
    ) {
      best = c;
      bestOverlap = overlap;
    }
  }
  return best;
}
