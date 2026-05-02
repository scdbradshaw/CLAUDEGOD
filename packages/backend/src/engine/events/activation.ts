// Phase 8 — Event activation rules (DESIGN.md §9.1).
//
// Pure planner: given a list of *planned* drops (player + cascade) and the
// list of currently-active events, decides what fires immediately, what gets
// queued (cascade only — players never queue, see §9.1), and what is rejected.
//
//   - Cap 6 active per world.
//   - God-override (source='player') replaces an active event of the same
//     `event_def_id` (extends/refreshes), without consuming a new slot.
//   - Cascade events queue if the cap is hit.

import { EVENT_ACTIVE_CAP } from '@claude-god/shared';
import type { EventType } from '@claude-god/shared';

export type DropSource = 'player' | 'cascade';

export interface PlannedDrop {
  /** Stable identity for the planning step (caller's responsibility). */
  intent_id: string;
  source: DropSource;
  event_def_id: EventType;
  city_id?: string;
  faction_id?: string;
  /** Cascade fires include the cooldown key for downstream bookkeeping. */
  cooldown_key?: string;
}

export interface ActiveEventLite {
  id: string;
  event_def_id: EventType;
}

export type ActivationDecision =
  | { intent_id: string; action: 'fire'; replaces_event_id?: string }
  | { intent_id: string; action: 'queue' } // cascade-only when cap is hit
  | { intent_id: string; action: 'reject'; reason: 'cap-full' | 'no-target' };

export interface ActivationPlan {
  decisions: ActivationDecision[];
}

/**
 * Plan how to apply each PlannedDrop.
 *
 * Players first (god-override semantics), then cascades. Cap is enforced
 * against a *running* count so multiple drops in one tick all see consistent
 * state. Player drops that find a same-def active row consume no new slot.
 */
export function planActivation(
  planned: PlannedDrop[],
  active: ActiveEventLite[],
): ActivationPlan {
  const decisions: ActivationDecision[] = [];
  const activeByDef = new Map<EventType, ActiveEventLite>();
  for (const a of active) {
    // Last-write-wins; a single same-def active row is the invariant.
    activeByDef.set(a.event_def_id, a);
  }
  let activeCount = active.length;

  // Validate target presence per scope handled at route layer; here we just
  // accept anything the caller passed and trust scope wiring.

  // Process player drops first.
  for (const p of planned) {
    if (p.source !== 'player') continue;
    const existing = activeByDef.get(p.event_def_id);
    if (existing) {
      // God-override: replace, no new slot.
      decisions.push({
        intent_id: p.intent_id,
        action: 'fire',
        replaces_event_id: existing.id,
      });
      // The replacing event becomes the active row for that def. We don't
      // mutate `active` here — caller does the DB swap.
      continue;
    }
    if (activeCount >= EVENT_ACTIVE_CAP) {
      decisions.push({ intent_id: p.intent_id, action: 'reject', reason: 'cap-full' });
      continue;
    }
    decisions.push({ intent_id: p.intent_id, action: 'fire' });
    activeCount += 1;
    activeByDef.set(p.event_def_id, { id: `__planned__${p.intent_id}`, event_def_id: p.event_def_id });
  }

  // Then cascades (queued if cap hit; replaced if same-def already active —
  // we let the existing event tick out rather than refreshing it on cascade).
  for (const p of planned) {
    if (p.source !== 'cascade') continue;
    const existing = activeByDef.get(p.event_def_id);
    if (existing) {
      // Same def already running; cascade has nothing to do — drop silently.
      decisions.push({ intent_id: p.intent_id, action: 'reject', reason: 'cap-full' });
      continue;
    }
    if (activeCount >= EVENT_ACTIVE_CAP) {
      decisions.push({ intent_id: p.intent_id, action: 'queue' });
      continue;
    }
    decisions.push({ intent_id: p.intent_id, action: 'fire' });
    activeCount += 1;
    activeByDef.set(p.event_def_id, { id: `__planned__${p.intent_id}`, event_def_id: p.event_def_id });
  }

  return { decisions };
}
