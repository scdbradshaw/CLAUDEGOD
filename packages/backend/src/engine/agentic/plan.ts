// Phase 9 — orchestrator: turns world snapshots into a list of intents
// (DESIGN.md §11.2 + §11.4 + §15.3 step 10).
//
// 1. Resolve queued (pinned) actions first — each gets a QueuedIntent.
// 2. For every alive person *not* already firing a queued action this year,
//    roll act-chance(); if hit, weighted-pick an action.
// 3. Shuffle engine intents into random order (per §11.5: subsequent
//    actions see updated state).

import type { Rng } from '../../lib/rng';
import { actChance } from './frequency';
import { actionWeights, pickAction } from './weights';
import { planQueuedActions } from './queue';
import type {
  AgenticIntent,
  AgenticPlan,
  BondSnapshot,
  EngineIntent,
  PersonSnapshot,
  QueuedActionSnapshot,
} from './types';

export interface PlanInput {
  year: number;
  alivePersons: PersonSnapshot[];
  bonds: BondSnapshot[];
  queues: QueuedActionSnapshot[];
  rng: Rng;
}

export function planYearActions(input: PlanInput): AgenticPlan {
  const alivePersonsById = new Map(input.alivePersons.map((p) => [p.id, p]));
  const bondsByOwner = new Map<string, BondSnapshot[]>();
  for (const b of input.bonds) {
    const arr = bondsByOwner.get(b.owner_id);
    if (arr) arr.push(b);
    else bondsByOwner.set(b.owner_id, [b]);
  }

  const queuedIntents = planQueuedActions({
    year: input.year,
    queues: input.queues,
    alivePersonsById,
    bondsByOwner,
    alivePersons: input.alivePersons,
  });

  // Track actors that already fired a queued (non-failed) intent so we don't
  // double-roll them this year. Failed queued intents *do not* consume the
  // year's roll — the player set them, the gate failed, and we let the engine
  // try.
  const queuedFiredActors = new Set(
    queuedIntents.filter((q) => q.gate === 'pass').map((q) => q.actor_id),
  );

  // Engine roll. Sort by id for deterministic chance-roll order, then shuffle
  // the surviving intents at the end for execution order.
  const engineCandidates = [...input.alivePersons].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const engineIntents: EngineIntent[] = [];
  for (const actor of engineCandidates) {
    if (queuedFiredActors.has(actor.id)) continue;
    const chance = actChance(actor);
    if (input.rng.next() >= chance) continue;
    const ws = actionWeights(actor, {
      ownedBonds: bondsByOwner.get(actor.id) ?? [],
      alivePersons: input.alivePersons,
    });
    const pick = pickAction(ws, input.rng);
    if (!pick) continue;
    engineIntents.push({
      source: 'engine',
      actor_id: actor.id,
      action_type: pick.action_type,
      target_id: pick.target_id,
      params: pick.params,
    });
  }

  // §11.5: process engine intents in random order. Fisher-Yates.
  for (let i = engineIntents.length - 1; i > 0; i--) {
    const j = Math.floor(input.rng.next() * (i + 1));
    const tmp = engineIntents[i];
    engineIntents[i] = engineIntents[j];
    engineIntents[j] = tmp;
  }

  const intents: AgenticIntent[] = [...queuedIntents, ...engineIntents];
  return { intents };
}
