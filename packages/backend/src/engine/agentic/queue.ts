// Phase 9 — pinned-action-queue resolver (DESIGN.md §11.4).
//
// At year-end, queue entries with `scheduled_year === year` and
// `status === 'queued'` fire BEFORE engine-rolled actions. Each entry is
// gate-checked against current state; failure (target dead, gates fail)
// produces a `gate:'fail'` intent that the executor turns into a memory
// + status='failed' write — never a hard error.

import type { ActionQueueEntry } from '@claude-god/shared';
import {
  donateEligibility,
  foundGroupEligibility,
  giftEligibility,
  marryEligibility,
  murderEligibility,
  type EligibilityCtx,
} from './eligibility';
import type { PersonSnapshot, QueuedActionSnapshot, QueuedIntent } from './types';

/** Build queued intents for `year` from snapshots. Sorted by person id for
 *  determinism (queue is small per person, so order within a single
 *  person's queue is preserved). */
export function planQueuedActions(input: {
  year: number;
  queues: QueuedActionSnapshot[];
  alivePersonsById: Map<string, PersonSnapshot>;
  bondsByOwner: Map<string, EligibilityCtx['ownedBonds']>;
  alivePersons: PersonSnapshot[];
}): QueuedIntent[] {
  const intents: QueuedIntent[] = [];
  const sorted = [...input.queues].sort((a, b) => {
    if (a.person_id !== b.person_id) {
      return a.person_id < b.person_id ? -1 : 1;
    }
    return a.entry.scheduled_year - b.entry.scheduled_year;
  });
  for (const q of sorted) {
    if (q.entry.scheduled_year !== input.year) continue;
    if (q.entry.status !== 'queued') continue;
    const actor = input.alivePersonsById.get(q.person_id);
    if (!actor) {
      // actor dead → drop silently; no executor side effect to queue
      // (the row remains as 'queued' on a deleted Person, which is fine
      // since the row is gone).
      continue;
    }
    const intent = gateQueuedEntry(q.entry, actor, {
      ownedBonds: input.bondsByOwner.get(q.person_id) ?? [],
      alivePersons: input.alivePersons,
    });
    intents.push(intent);
  }
  return intents;
}

function gateQueuedEntry(
  entry: ActionQueueEntry,
  actor: PersonSnapshot,
  ctx: EligibilityCtx,
): QueuedIntent {
  const base: Omit<QueuedIntent, 'gate' | 'failure_reason'> = {
    source: 'queued',
    actor_id: actor.id,
    action_type: entry.action_type,
    target_id: entry.target_id,
    params: entry.params,
    scheduled_year: entry.scheduled_year,
  };

  switch (entry.action_type) {
    case 'marry': {
      // Player-supplied target overrides eligibility's auto-pick if alive +
      // unmarried. Otherwise fall back to the autopick.
      if (actor.spouse_id) {
        return { ...base, gate: 'fail', failure_reason: 'actor_already_married' };
      }
      const aliveById = new Map(ctx.alivePersons.map((p) => [p.id, p]));
      if (entry.target_id) {
        const t = aliveById.get(entry.target_id);
        if (!t) return { ...base, gate: 'fail', failure_reason: 'target_unavailable' };
        if (t.spouse_id) return { ...base, gate: 'fail', failure_reason: 'target_already_married' };
        return { ...base, gate: 'pass' };
      }
      const e = marryEligibility(actor, ctx);
      if (!e.ok) return { ...base, gate: 'fail', failure_reason: 'no_eligible_spouse' };
      return { ...base, gate: 'pass', target_id: e.target.id };
    }
    case 'murder': {
      const aliveById = new Map(ctx.alivePersons.map((p) => [p.id, p]));
      if (entry.target_id) {
        const t = aliveById.get(entry.target_id);
        if (!t) return { ...base, gate: 'fail', failure_reason: 'target_unavailable' };
        return { ...base, gate: 'pass' };
      }
      const e = murderEligibility(actor, ctx);
      if (!e.ok) return { ...base, gate: 'fail', failure_reason: 'no_target' };
      return { ...base, gate: 'pass', target_id: e.target.id };
    }
    case 'found-group': {
      const e = foundGroupEligibility(actor);
      if (!e.ok) {
        return { ...base, gate: 'fail', failure_reason: 'gates_unmet' };
      }
      // Honor player override of `kind` via params if present + valid.
      const overrideKind = entry.params?.kind;
      const kind =
        overrideKind === 'faction' || overrideKind === 'religion'
          ? overrideKind
          : e.kind;
      // §8.3 — religion founding requires `faithful`; refuse the player override
      // here so the queued intent fails fast with a clear reason rather than
      // dying inside the executor.
      if (kind === 'religion' && !actor.personality_tags.includes('faithful')) {
        return { ...base, gate: 'fail', failure_reason: 'religion_requires_faithful' };
      }
      return { ...base, gate: 'pass', params: { ...entry.params, kind } };
    }
    case 'gift': {
      const aliveById = new Map(ctx.alivePersons.map((p) => [p.id, p]));
      if (entry.target_id) {
        const t = aliveById.get(entry.target_id);
        if (!t) return { ...base, gate: 'fail', failure_reason: 'target_unavailable' };
        if (t.wealth >= actor.wealth) {
          return { ...base, gate: 'fail', failure_reason: 'target_richer' };
        }
        if (actor.wealth < 100) {
          return { ...base, gate: 'fail', failure_reason: 'actor_poor' };
        }
        return { ...base, gate: 'pass' };
      }
      const e = giftEligibility(actor, ctx);
      if (!e.ok) return { ...base, gate: 'fail', failure_reason: 'no_target' };
      return { ...base, gate: 'pass', target_id: e.target.id };
    }
    case 'donate': {
      // target_id is the religion (group) id — must match the actor's
      // current religion. The eligibility check covers wealth + affiliation;
      // the executor re-validates the group row exists + is_active.
      const e = donateEligibility(actor);
      if (!e.ok) return { ...base, gate: 'fail', failure_reason: 'gates_unmet' };
      if (entry.target_id && entry.target_id !== e.religion_id) {
        return { ...base, gate: 'fail', failure_reason: 'wrong_religion' };
      }
      return { ...base, gate: 'pass', target_id: e.religion_id };
    }
    default:
      return { ...base, gate: 'fail', failure_reason: 'unknown_action' };
  }
}
