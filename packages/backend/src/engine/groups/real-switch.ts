// Real-person group switching (Phase 7 — DESIGN.md §8.3).
//
// "When alternative-fit > current-fit + threshold AND current membership ≥ 3
// years (no whiplash), switch. Writes `converted` or `defected` memory + state
// tag." (No 'converted'/'defected' state tag exists in §5.2 yet; we tag the
// memory with kind='converted'|'defected' and tone='literary'. State-tag
// system stays untouched.)
//
// Pure: takes current group + alts, returns the chosen target (or null).

import type { GroupKind, Memory, MemoryTone } from '@claude-god/shared';
import { scoreFit, type FitGroup, type FitSubject } from './fit-score';

/** Tenure required before a member is allowed to switch (no whiplash). */
const TENURE_GATE_YEARS = 3;
/** alt_fit must beat current_fit by at least this much to flip. */
export const SWITCH_THRESHOLD = 1.0;

export interface SwitchInput {
  subject: FitSubject;
  kind: GroupKind;
  /** Subject's current group of this kind, or null if unaffiliated. */
  current: FitGroup | null;
  /** Year subject joined `current`. Ignored when `current` is null. */
  joinedYear: number | null;
  /** Candidates of the same kind in the subject's city. */
  alternatives: FitGroup[];
  /** { groupId: shareInSubjectCity } for proximity bonus. */
  cityShares: Record<string, number>;
  /** Current world year. */
  year: number;
  threshold?: number;
}

export interface SwitchPlan {
  /** Group to switch to, null if no switch this year. */
  switchTo: FitGroup | null;
  /** Reason used for instrumentation/tests. */
  reason:
    | 'no-alternatives'
    | 'tenure-gate'
    | 'no-better-fit'
    | 'switch'
    | 'join-from-unaffiliated';
  leaveMemory?: Memory;
  joinMemory?: Memory;
}

/**
 * Plan a switch, if any. Caller persists Person fields + memories.
 */
export function planRealSwitch(input: SwitchInput): SwitchPlan {
  const threshold = input.threshold ?? SWITCH_THRESHOLD;

  if (input.alternatives.length === 0) {
    return { switchTo: null, reason: 'no-alternatives' };
  }

  // Score every alternative; pick the best.
  const scoredAlts = input.alternatives.map((g) => ({
    group: g,
    fit: scoreFit(input.subject, g, input.cityShares[g.id] ?? 0),
  }));
  scoredAlts.sort((a, b) => b.fit - a.fit);
  const best = scoredAlts[0];
  if (best.fit <= 0) {
    return { switchTo: null, reason: 'no-better-fit' };
  }

  // Unaffiliated → joining is always allowed (no tenure to honor).
  if (input.current == null) {
    return {
      switchTo: best.group,
      reason: 'join-from-unaffiliated',
      joinMemory: makeJoinMemory(input.kind, best.group.id, input.year),
    };
  }

  // Tenure gate: must have been a member for >=3 years.
  const joined = input.joinedYear ?? input.year;
  if (input.year - joined < TENURE_GATE_YEARS) {
    return { switchTo: null, reason: 'tenure-gate' };
  }

  const currentFit = scoreFit(
    input.subject,
    input.current,
    input.cityShares[input.current.id] ?? 0,
  );

  if (best.fit <= currentFit + threshold) {
    return { switchTo: null, reason: 'no-better-fit' };
  }

  // If best is the same group somehow, no-op.
  if (best.group.id === input.current.id) {
    return { switchTo: null, reason: 'no-better-fit' };
  }

  return {
    switchTo: best.group,
    reason: 'switch',
    leaveMemory: makeLeaveMemory(input.kind, input.current.id, input.year),
    joinMemory: makeJoinMemory(input.kind, best.group.id, input.year),
  };
}

function makeLeaveMemory(kind: GroupKind, groupId: string, year: number): Memory {
  const tone: MemoryTone = 'literary';
  return {
    year,
    kind: kind === 'religion' ? 'apostatized' : 'defected',
    summary:
      kind === 'religion'
        ? 'broke from the old faith'
        : 'broke ranks with the old faction',
    magnitude: 0.6,
    tone,
    counterparty_id: groupId,
  };
}

function makeJoinMemory(kind: GroupKind, groupId: string, year: number): Memory {
  const tone: MemoryTone = 'literary';
  return {
    year,
    kind: kind === 'religion' ? 'converted' : 'enlisted',
    summary:
      kind === 'religion'
        ? 'took up a new faith'
        : 'pledged to a new faction',
    magnitude: 0.6,
    tone,
    counterparty_id: groupId,
  };
}
