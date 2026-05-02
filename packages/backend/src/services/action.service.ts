// Phase 9 — agentic-actions service (DESIGN.md §11).
//
// `runAgenticPhaseTx` loads snapshots, runs the engine planner, dispatches
// each intent against the open transaction, and returns an array of
// `AgenticActionResult` rows for the year's audit log.
//
// All side effects (DB writes, archive routing, group creation) live here.
// Engine modules under `engine/agentic/` stay pure.

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  AGENTIC_ACTION_TYPES,
  FOUND_GROUP_TREASURY_SEED,
  GROUP_PER_YEAR_CAP,
  RELIGION_DEFAULT_COST_PCT,
  type ActionQueueEntry,
  type AgenticActionResult,
  type AgenticActionType,
  type Memory,
  type PersonalityTag,
  type StateTag,
  type StateTagEntry,
} from '@claude-god/shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import type { Rng } from '../lib/rng';
import { addStateTag } from '../engine/state-tags';
import { addMemory } from '../engine/memory';
import {
  planDonate,
  planFoundGroup,
  planGift,
  planMarry,
  planMurder,
} from '../engine/agentic/actions';
import { planYearActions } from '../engine/agentic/plan';
import type {
  AgenticIntent,
  BondSnapshot,
  PersonSnapshot,
  QueuedActionSnapshot,
} from '../engine/agentic/types';
import { archiveAndDeleteTx } from './person.service';
import { handleLeaderDeathTx, createGroupTx } from './group.service';
import { setBondTx } from './relationship.service';

type TxClient = Prisma.TransactionClient | PrismaClient;

// ─── Per-phase apply context ───────────────────────────────────────────────
// Performance refactor (2026-05-01). The agentic phase used to fire 5–10
// awaited DB calls per intent (loadActorAlive, applyPersonPatch with
// findUnique-then-update, tryAppendMemoryTx, markQueueEntryStatusTx, plus
// scalar updates in each executor). All those calls serialized over a single
// Prisma interactive-tx connection — the dominant cost at 500 pinned actors.
//
// We now load every alive person's writeable columns once, mutate them in
// JS through the dispatch loop, and emit a single bulk UPDATE … FROM
// (VALUES …) at the end of the phase covering every dirty person. Inline
// ops that touch other tables (Group, Relationship, archive) stay direct.

interface PersonMutable extends PersonSnapshot {
  /** Owning world — needed by found-group; precomputed so we don't hit DB. */
  world_id: string;
  /** Display name — needed by found-group for the group label. */
  name: string;
  // Mutable Person columns we may write back at end of phase.
  m_wealth: number;
  m_happiness: number;
  m_spouse_id: string | null;
  m_faction_id: string | null;
  m_religion_id: string | null;
  m_faction_joined_year: number | null;
  m_religion_joined_year: number | null;
  m_state_tags_raw: StateTagEntry[];
  m_recent_memories: Memory[];
  m_action_queue: ActionQueueEntry[];
  m_is_alive: boolean;
}

interface ApplyCtx {
  worldId: string;
  year: number;
  persons: Map<string, PersonMutable>;
  /** Persons whose mutable columns changed; flushed in the final bulk UPDATE. */
  dirty: Set<string>;
}

/** Push a memory entry into the local buffer, applying the cap-aware
 *  weight-FIFO eviction. */
function ctxAppendMemory(ctx: ApplyCtx, personId: string, entry: Memory): void {
  const p = ctx.persons.get(personId);
  if (!p) return;
  p.m_recent_memories = addMemory(p.m_recent_memories, entry);
  ctx.dirty.add(personId);
}

/** Add a state tag for `year`, deduping via the engine helper. */
function ctxAddStateTag(
  ctx: ApplyCtx,
  personId: string,
  tag: StateTag,
  year: number,
): void {
  const p = ctx.persons.get(personId);
  if (!p) return;
  p.m_state_tags_raw = addStateTag(p.m_state_tags_raw, tag, year);
  ctx.dirty.add(personId);
}

/** Mark a queued entry as fired/failed/skipped in the local action_queue. */
function ctxMarkQueueStatus(
  ctx: ApplyCtx,
  personId: string,
  scheduledYear: number,
  status: 'fired' | 'failed' | 'skipped',
  failureReason?: string,
): void {
  const p = ctx.persons.get(personId);
  if (!p) return;
  p.m_action_queue = p.m_action_queue.map((entry) =>
    entry.scheduled_year === scheduledYear && entry.status === 'queued'
      ? { ...entry, status, failure_reason: failureReason }
      : entry,
  );
  ctx.dirty.add(personId);
}

/** Read an actor from the context map. Returns null if not present or dead. */
function ctxGetAlive(ctx: ApplyCtx, personId: string): PersonMutable | null {
  const p = ctx.persons.get(personId);
  return p && p.m_is_alive ? p : null;
}

/** Mark a person dead in-context. The actual archive write is still done
 *  inline by the murder executor (deletes the row). */
function ctxMarkDead(ctx: ApplyCtx, personId: string): void {
  const p = ctx.persons.get(personId);
  if (!p) return;
  p.m_is_alive = false;
  // Don't add to dirty — the archive pipeline deletes the row, so any
  // pending mutable buffer for it would target a missing row. Drop the
  // dirty marker if present so the bulk UPDATE skips this id.
  ctx.dirty.delete(personId);
}

/** Flush every dirty person to the DB in a single bulk UPDATE. */
async function flushApplyCtx(ctx: ApplyCtx, tx: TxClient): Promise<void> {
  if (ctx.dirty.size === 0) return;
  const rows: Prisma.Sql[] = [];
  for (const id of ctx.dirty) {
    const p = ctx.persons.get(id);
    if (!p || !p.m_is_alive) continue; // dead → row gone via archive pipeline
    rows.push(
      Prisma.sql`(
        ${p.id}::text,
        ${p.m_wealth}::int,
        ${p.m_happiness}::int,
        ${p.m_spouse_id}::text,
        ${p.m_faction_id}::text,
        ${p.m_faction_joined_year}::int,
        ${p.m_religion_id}::text,
        ${p.m_religion_joined_year}::int,
        ${JSON.stringify(p.m_recent_memories)}::jsonb,
        ${JSON.stringify(p.m_state_tags_raw)}::jsonb,
        ${JSON.stringify(p.m_action_queue)}::jsonb
      )`,
    );
  }
  if (rows.length === 0) return;
  await tx.$executeRaw`
    UPDATE "Person" AS p
    SET wealth = v.wealth,
        happiness = v.happiness,
        spouse_id = v.spouse_id,
        faction_id = v.faction_id,
        faction_joined_year = v.fjy,
        religion_id = v.religion_id,
        religion_joined_year = v.rjy,
        recent_memories = v.mem,
        state_tags = v.tags,
        action_queue = v.queue
    FROM (VALUES ${Prisma.join(rows)}) AS v(
      id, wealth, happiness,
      spouse_id, faction_id, fjy, religion_id, rjy,
      mem, tags, queue
    )
    WHERE p.id = v.id
  `;
}

// ─── Public entry: full year-end agentic phase ─────────────────────────────

export async function runAgenticPhaseTx(
  worldId: string,
  year: number,
  rng: Rng,
  tx: TxClient,
): Promise<AgenticActionResult[]> {
  // 1. Load snapshots — including every column we may write so the apply
  //    phase doesn't need any read-modify-write round-trips.
  const personRows = await tx.person.findMany({
    where: { world_id: worldId, is_alive: true },
    select: {
      id: true,
      world_id: true,
      name: true,
      age: true,
      city_id: true,
      type: true,
      gender: true,
      sexuality: true,
      spouse_id: true,
      wealth: true,
      combat: true,
      intelligence: true,
      happiness: true,
      is_pinned: true,
      faction_id: true,
      religion_id: true,
      faction_joined_year: true,
      religion_joined_year: true,
      personality_tags: true,
      state_tags: true,
      recent_memories: true,
      action_queue: true,
    },
  });

  if (personRows.length === 0) return [];

  // Build the apply context — one PersonMutable per alive person.
  const ctx: ApplyCtx = {
    worldId,
    year,
    persons: new Map(),
    dirty: new Set(),
  };
  for (const p of personRows) {
    const tags = (Array.isArray(p.personality_tags)
      ? p.personality_tags
      : []) as unknown as PersonalityTag[];
    const stateTagsRaw = (Array.isArray(p.state_tags)
      ? p.state_tags
      : []) as unknown as StateTagEntry[];
    const memories = (Array.isArray(p.recent_memories)
      ? p.recent_memories
      : []) as unknown as Memory[];
    const queue = (Array.isArray(p.action_queue)
      ? p.action_queue
      : []) as unknown as ActionQueueEntry[];
    ctx.persons.set(p.id, {
      // PersonSnapshot fields the planner uses (read-only past planning):
      id: p.id,
      age: p.age,
      city_id: p.city_id,
      type: p.type as string,
      gender: p.gender,
      sexuality: p.sexuality,
      spouse_id: p.spouse_id,
      wealth: p.wealth,
      combat: p.combat,
      intelligence: p.intelligence,
      happiness: p.happiness,
      is_pinned: p.is_pinned,
      faction_id: p.faction_id,
      religion_id: p.religion_id,
      personality_tags: tags,
      state_tags: stateTagsRaw.map((e) => e.tag),
      // Extra metadata needed by executors:
      world_id: p.world_id,
      name: p.name,
      // Mutable mirrors:
      m_wealth: p.wealth,
      m_happiness: p.happiness,
      m_spouse_id: p.spouse_id,
      m_faction_id: p.faction_id,
      m_religion_id: p.religion_id,
      m_faction_joined_year: p.faction_joined_year,
      m_religion_joined_year: p.religion_joined_year,
      m_state_tags_raw: stateTagsRaw,
      m_recent_memories: memories,
      m_action_queue: queue,
      m_is_alive: true,
    });
  }

  const alivePersons: PersonSnapshot[] = [...ctx.persons.values()];

  const queues: QueuedActionSnapshot[] = [];
  for (const p of ctx.persons.values()) {
    for (const entry of p.m_action_queue) queues.push({ person_id: p.id, entry });
  }

  const personIds = alivePersons.map((p) => p.id);
  const bondRows = await tx.relationship.findMany({
    where: { owner_id: { in: personIds } },
    select: { owner_id: true, target_id: true, kind: true, strength: true },
  });
  const bonds: BondSnapshot[] = bondRows.map((b) => ({
    owner_id: b.owner_id,
    target_id: b.target_id,
    kind: b.kind as BondSnapshot['kind'],
    strength: b.strength,
  }));

  // 2. Plan intents.
  const plan = planYearActions({ year, alivePersons, bonds, queues, rng });
  if (plan.intents.length === 0) return [];

  // 3. Dispatch sequentially. Each executor mutates ctx.persons so subsequent
  //    intents see updated state (§11.5). Inline ops (Group, Relationship,
  //    archive) still write through tx.
  const results: AgenticActionResult[] = [];
  for (const intent of plan.intents) {
    const r = await dispatchIntent(intent, ctx, rng, tx);
    if (r) results.push(r);
  }

  // 4. Flush every Person column change in a single bulk UPDATE.
  await flushApplyCtx(ctx, tx);

  return results;
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

async function dispatchIntent(
  intent: AgenticIntent,
  ctx: ApplyCtx,
  rng: Rng,
  tx: TxClient,
): Promise<AgenticActionResult | null> {
  const year = ctx.year;
  // Queued + gate fail → record status + flavor memory in-context; return.
  if (intent.source === 'queued' && intent.gate === 'fail') {
    ctxMarkQueueStatus(
      ctx,
      intent.actor_id,
      intent.scheduled_year,
      'failed',
      intent.failure_reason,
    );
    ctxAppendMemory(ctx, intent.actor_id, {
      year,
      kind: 'queued-action-failed',
      summary: `a planned ${intent.action_type} fell through`,
      magnitude: 0.4,
      tone: 'neutral',
    });
    return {
      year,
      source: 'queued',
      action_type: intent.action_type,
      actor_id: intent.actor_id,
      target_id: intent.target_id,
      status: 'failed',
      failure_reason: intent.failure_reason,
    };
  }

  // Look up actor in-context; may have died earlier this phase.
  const actor = ctxGetAlive(ctx, intent.actor_id);
  if (!actor) {
    return {
      year,
      source: intent.source,
      action_type: intent.action_type,
      actor_id: intent.actor_id,
      target_id: intent.target_id,
      status: 'skipped',
      failure_reason: 'actor_no_longer_alive',
    };
  }

  switch (intent.action_type) {
    case 'marry':
      return executeMarryTx(actor, intent, ctx, tx);
    case 'murder':
      return executeMurderTx(actor, intent, ctx, tx);
    case 'found-group':
      return executeFoundGroupTx(actor, intent, ctx, tx);
    case 'gift':
      return executeGiftTx(actor, intent, ctx, rng, tx);
    case 'donate':
      return executeDonateTx(actor, intent, ctx, tx);
    default:
      return null;
  }
}

// ─── marry executor ─────────────────────────────────────────────────────────

async function executeMarryTx(
  actor: PersonMutable,
  intent: AgenticIntent,
  ctx: ApplyCtx,
  tx: TxClient,
): Promise<AgenticActionResult> {
  const year = ctx.year;
  const targetId = intent.target_id;
  if (!targetId) return resultFail(intent, year, 'no_target');
  if (actor.m_spouse_id) return resultFail(intent, year, 'actor_already_married');

  const target = ctxGetAlive(ctx, targetId);
  if (!target) return resultFail(intent, year, 'target_unavailable');
  if (target.m_spouse_id) return resultFail(intent, year, 'target_already_married');

  const desc = planMarry(actor, target, year);

  // Spouse linkage + 'wedded-recently' state tag + memories — all in-context.
  actor.m_spouse_id = target.id;
  target.m_spouse_id = actor.id;
  ctx.dirty.add(actor.id);
  ctx.dirty.add(target.id);
  ctxAddStateTag(ctx, actor.id, 'wedded-recently', year);
  ctxAddStateTag(ctx, target.id, 'wedded-recently', year);
  ctxAppendMemory(ctx, actor.id, desc.actor_memory);
  ctxAppendMemory(ctx, target.id, desc.target_memory);

  // Mutual `spouse` bond at the planned strength. setBondTx writes
  // Relationship rows + emits drift memories on eviction (separate table —
  // not batched here).
  await setBondTx(
    { owner_id: actor.id, target_id: target.id, kind: 'spouse', strength: desc.bond_strength, year },
    tx,
  );
  await setBondTx(
    { owner_id: target.id, target_id: actor.id, kind: 'spouse', strength: desc.bond_strength, year },
    tx,
  );

  if (intent.source === 'queued') {
    ctxMarkQueueStatus(ctx, actor.id, intent.scheduled_year, 'fired');
  }

  return {
    year,
    source: intent.source,
    action_type: 'marry',
    actor_id: actor.id,
    target_id: target.id,
    status: 'fired',
  };
}

// ─── murder executor ────────────────────────────────────────────────────────

async function executeMurderTx(
  actor: PersonMutable,
  intent: AgenticIntent,
  ctx: ApplyCtx,
  tx: TxClient,
): Promise<AgenticActionResult> {
  const year = ctx.year;
  const targetId = intent.target_id;
  if (!targetId) return resultFail(intent, year, 'no_target');
  if (targetId === actor.id) return resultFail(intent, year, 'self_target');

  const target = ctxGetAlive(ctx, targetId);
  if (!target) return resultFail(intent, year, 'target_unavailable');

  const desc = planMurder(actor, target, year);

  // Death pipeline (other tables) stays inline. Mark dead in-context first
  // so the bulk UPDATE skips deleted rows.
  for (const id of desc.kills) {
    ctxMarkDead(ctx, id);
    await handleLeaderDeathTx(id, year, tx);
    await archiveAndDeleteTx(
      { person_id: id, reason: 'death', year, death_cause: 'interaction' },
      tx,
    );
  }

  // Survivor memory — in-context (witness is still alive).
  if (desc.survivor_memory && desc.witness_id) {
    ctxAppendMemory(ctx, desc.witness_id, desc.survivor_memory);
  }

  if (intent.source === 'queued') {
    ctxMarkQueueStatus(ctx, actor.id, intent.scheduled_year, 'fired');
  }

  return {
    year,
    source: intent.source,
    action_type: 'murder',
    actor_id: actor.id,
    target_id: target.id,
    status: 'fired',
    failure_reason: desc.outcome === 'target_wins' ? 'actor_killed_in_attempt' : undefined,
  };
}

// ─── found-group executor ──────────────────────────────────────────────────

async function executeFoundGroupTx(
  actor: PersonMutable,
  intent: AgenticIntent,
  ctx: ApplyCtx,
  tx: TxClient,
): Promise<AgenticActionResult> {
  const year = ctx.year;
  // Determine kind: explicit param wins, else infer from actor tags.
  const paramKind = intent.params?.kind;
  const kind: 'faction' | 'religion' =
    paramKind === 'faction' || paramKind === 'religion'
      ? paramKind
      : actor.personality_tags.includes('faithful')
      ? 'religion'
      : 'faction';

  // §8.3 — religion founding hard-gates on `faithful`. Without it the founder
  // can't anchor the doctrine, so we refuse rather than silently downgrading.
  if (kind === 'religion' && !actor.personality_tags.includes('faithful')) {
    return resultFail(intent, year, 'religion_requires_faithful');
  }

  if (actor.m_wealth < FOUND_GROUP_TREASURY_SEED) {
    return resultFail(intent, year, 'wealth_insufficient');
  }

  // world_id + name come from the upfront load — no per-intent findUnique.
  // Cap engine-formed groups at GROUP_PER_YEAR_CAP per kind per year.
  // God-mode summons go through summonFounderAndFaction / summonFounderAndReligion
  // which bypass this executor, so they remain exempt by design.
  const formedSoFar = await tx.group.count({
    where: { world_id: actor.world_id, founded_year: year, kind },
  });
  if (formedSoFar >= GROUP_PER_YEAR_CAP) {
    return resultFail(intent, year, 'per_year_cap_reached');
  }

  const desc = planFoundGroup(actor, kind, FOUND_GROUP_TREASURY_SEED, year);
  const groupName = `${actor.name}'s ${desc.name_template_suffix}`;

  // Debit treasury seed in-context.
  actor.m_wealth -= desc.treasury_seed;
  ctx.dirty.add(actor.id);

  // Create group (different table — inline).
  const group = await createGroupTx(
    {
      world_id: actor.world_id,
      kind,
      name: groupName,
      founder_id: actor.id,
      leader_id: actor.id,
      founded_year: year,
      wanted_tags: desc.wanted_tags as PersonalityTag[],
      type_affinities: {},
      stat_floors: {},
      cost_per_year: desc.faction_config?.cost_per_year ?? 0,
      // Religions charge a default fraction of wealth annually (§ R1).
      cost_pct_of_wealth: kind === 'religion' ? RELIGION_DEFAULT_COST_PCT : null,
      tax_rate: kind === 'faction' ? 0 : undefined,
      army_size: kind === 'faction' ? 0 : undefined,
      territory_cities: kind === 'faction' ? [] : undefined,
      leader_dues_cut: desc.faction_config?.leader_dues_cut,
      prize_shares: desc.faction_config?.prize_shares,
      competition_metric: desc.faction_config?.competition_metric,
      intelligence_target: desc.faction_config?.intelligence_target,
    },
    tx,
  );

  // Treasury seed lands on the new group.
  await tx.group.update({
    where: { id: group.id },
    data: { treasury: desc.treasury_seed },
  });

  // Set actor's FK + joined_year + memory in-context.
  if (kind === 'faction') {
    actor.m_faction_id = group.id;
    actor.m_faction_joined_year = year;
  } else {
    actor.m_religion_id = group.id;
    actor.m_religion_joined_year = year;
  }
  ctxAppendMemory(ctx, actor.id, desc.actor_memory);

  if (intent.source === 'queued') {
    ctxMarkQueueStatus(ctx, actor.id, intent.scheduled_year, 'fired');
  }

  return {
    year,
    source: intent.source,
    action_type: 'found-group',
    actor_id: actor.id,
    status: 'fired',
  };
}

// ─── gift executor ──────────────────────────────────────────────────────────

async function executeGiftTx(
  actor: PersonMutable,
  intent: AgenticIntent,
  ctx: ApplyCtx,
  rng: Rng,
  // tx unused — gift is fully in-context now.
  _tx: TxClient,
): Promise<AgenticActionResult> {
  const year = ctx.year;
  const targetId = intent.target_id;
  if (!targetId) return resultFail(intent, year, 'no_target');

  const target = ctxGetAlive(ctx, targetId);
  if (!target) return resultFail(intent, year, 'target_unavailable');
  if (actor.m_wealth < 100) return resultFail(intent, year, 'actor_poor');
  if (target.m_wealth >= actor.m_wealth) return resultFail(intent, year, 'target_richer');

  const desc = planGift(actor, target, year, rng);
  if (desc.amount <= 0) return resultFail(intent, year, 'amount_zero');

  actor.m_wealth -= desc.amount;
  target.m_wealth += desc.amount;
  ctx.dirty.add(actor.id);
  ctx.dirty.add(target.id);
  ctxAppendMemory(ctx, actor.id, desc.actor_memory);
  ctxAppendMemory(ctx, target.id, desc.target_memory);

  if (intent.source === 'queued') {
    ctxMarkQueueStatus(ctx, actor.id, intent.scheduled_year, 'fired');
  }

  return {
    year,
    source: intent.source,
    action_type: 'gift',
    actor_id: actor.id,
    target_id: target.id,
    status: 'fired',
  };
}

// ─── donate executor (§8.3) ─────────────────────────────────────────────────

async function executeDonateTx(
  actor: PersonMutable,
  intent: AgenticIntent,
  ctx: ApplyCtx,
  tx: TxClient,
): Promise<AgenticActionResult> {
  const year = ctx.year;
  // For donate, target_id encodes the religion (group) id, not a person id.
  const religionId = intent.target_id ?? actor.m_religion_id;
  if (!religionId) return resultFail(intent, year, 'no_religion_target');
  if (!actor.m_religion_id) return resultFail(intent, year, 'actor_unaffiliated');
  if (actor.m_religion_id !== religionId) {
    return resultFail(intent, year, 'wrong_religion');
  }
  if (actor.m_wealth < 100) return resultFail(intent, year, 'actor_poor');

  const religion = await tx.group.findUnique({
    where: { id: religionId },
    select: { id: true, kind: true, is_active: true },
  });
  if (!religion || religion.kind !== 'religion' || !religion.is_active) {
    return resultFail(intent, year, 'religion_unavailable');
  }

  const desc = planDonate(actor, religion.id, year);
  if (desc.amount <= 0) return resultFail(intent, year, 'amount_zero');

  // Wealth move + happiness bump in-context; treasury credit hits Group inline.
  actor.m_wealth -= desc.amount;
  actor.m_happiness = Math.max(0, Math.min(100, actor.m_happiness + desc.happiness_bump));
  ctx.dirty.add(actor.id);
  await tx.group.update({
    where: { id: religion.id },
    data: { treasury: { increment: desc.amount } },
  });
  ctxAppendMemory(ctx, actor.id, desc.actor_memory);

  if (intent.source === 'queued') {
    ctxMarkQueueStatus(ctx, actor.id, intent.scheduled_year, 'fired');
  }

  return {
    year,
    source: intent.source,
    action_type: 'donate',
    actor_id: actor.id,
    target_id: religion.id,
    status: 'fired',
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function resultFail(
  intent: AgenticIntent,
  year: number,
  reason: string,
): AgenticActionResult {
  return {
    year,
    source: intent.source,
    action_type: intent.action_type,
    actor_id: intent.actor_id,
    target_id: intent.target_id,
    status: 'failed',
    failure_reason: reason,
  };
}

// ─── Public: pinned-only queue management ──────────────────────────────────

export interface EnqueueActionInput {
  person_id: string;
  entry: Omit<ActionQueueEntry, 'status'> & { status?: 'queued' };
}

export async function enqueueActionTx(
  input: EnqueueActionInput,
  tx: TxClient,
): Promise<ActionQueueEntry[]> {
  const p = await tx.person.findUnique({
    where: { id: input.person_id },
    select: { is_pinned: true, action_queue: true },
  });
  if (!p) throw new Error('person_not_found');
  if (!p.is_pinned) throw new Error('person_not_pinned');
  if (!isAgenticActionType(input.entry.action_type)) {
    throw new Error('invalid_action_type');
  }
  const q = (Array.isArray(p.action_queue)
    ? p.action_queue
    : []) as unknown as ActionQueueEntry[];
  const next: ActionQueueEntry[] = [
    ...q,
    {
      action_type: input.entry.action_type,
      target_id: input.entry.target_id,
      params: input.entry.params,
      scheduled_year: input.entry.scheduled_year,
      status: 'queued',
    },
  ];
  await tx.person.update({
    where: { id: input.person_id },
    data: { action_queue: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export async function enqueueAction(
  input: EnqueueActionInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<ActionQueueEntry[]> {
  return prisma.$transaction((tx) => enqueueActionTx(input, tx));
}

export async function removeQueuedActionTx(
  personId: string,
  scheduledYear: number,
  tx: TxClient,
): Promise<ActionQueueEntry[]> {
  const p = await tx.person.findUnique({
    where: { id: personId },
    select: { action_queue: true },
  });
  if (!p) throw new Error('person_not_found');
  const q = (Array.isArray(p.action_queue)
    ? p.action_queue
    : []) as unknown as ActionQueueEntry[];
  const next = q.filter(
    (e) => !(e.scheduled_year === scheduledYear && e.status === 'queued'),
  );
  await tx.person.update({
    where: { id: personId },
    data: { action_queue: next as unknown as Prisma.InputJsonValue },
  });
  return next;
}

export async function removeQueuedAction(
  personId: string,
  scheduledYear: number,
  prisma: PrismaClient = defaultPrisma,
): Promise<ActionQueueEntry[]> {
  return prisma.$transaction((tx) => removeQueuedActionTx(personId, scheduledYear, tx));
}

export async function listPersonQueue(
  personId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<ActionQueueEntry[] | null> {
  const p = await prisma.person.findUnique({
    where: { id: personId },
    select: { action_queue: true, id: true },
  });
  if (!p) return null;
  return (Array.isArray(p.action_queue)
    ? p.action_queue
    : []) as unknown as ActionQueueEntry[];
}

function isAgenticActionType(s: unknown): s is AgenticActionType {
  return typeof s === 'string' && (AGENTIC_ACTION_TYPES as readonly string[]).includes(s);
}
