// Phase 8 — Event service (DESIGN.md §9).
//
// Persistence layer for the WorldEvent table. Pure logic lives under
// `engine/events/`. Year-pipeline calls `tickActiveEventsTx` (step 7),
// `evaluateCascadesTx` (step 8), and `pushStateHistoryTx` (tail) inside the
// outer year-run transaction.

import type { Prisma, PrismaClient, WorldEvent } from '@prisma/client';
import {
  EVENT_ACTIVE_CAP,
  STATE_HISTORY_CAP,
  type CascadeKey,
  type EndConditionDescriptor,
  type EventDef,
  type EventType,
  type EventEndReason,
  type Memory,
  type PersonalityTag,
  type RealPersonTargetRule,
  type StateTag,
  type StateTagEntry,
  type WorldStateSnapshot,
} from '@claude-god/shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { getEventDef } from '../engine/events/catalog';
import {
  applyEventModifiers,
  type ActiveEventScoped,
  type BucketLite,
} from '../engine/events/apply-modifiers';
import {
  evaluateEndCondition,
  type EndConditionContext,
} from '../engine/events/end-conditions';
import {
  evaluateCascades,
  type CascadeFire,
} from '../engine/events/cascade-triggers';
import {
  planActivation,
  type ActivationDecision,
  type ActiveEventLite,
  type PlannedDrop,
} from '../engine/events/activation';
import { pickEventVictims } from '../engine/events/target-victims';
import { addStateTag } from '../engine/state-tags';
import { addMemory } from '../engine/memory';
import { evaluateWarEnd } from '../engine/war-resolver';
import { archiveAndDeleteTx } from './person.service';
import { handleLeaderDeathTx } from './group.service';
import { appendMemoryTx } from './memory.service';
import type { Rng } from '../lib/rng';

type TxClient = Prisma.TransactionClient | PrismaClient;

// ─── Drop ────────────────────────────────────────────────────────────────────

export interface DropEventInput {
  world_id: string;
  event_def_id: EventType;
  city_id?: string;
  faction_id?: string;
  year: number;
  source: 'player' | 'cascade';
}

export type DropEventResult =
  | { status: 'fired'; event: WorldEvent }
  | { status: 'replaced'; event: WorldEvent; replaced_id: string }
  | { status: 'rejected'; reason: 'cap-full' | 'no-target' | 'invalid-scope' }
  | { status: 'queued' };

export async function dropEvent(
  input: DropEventInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<DropEventResult> {
  return prisma.$transaction(async (tx) => dropEventTx(input, tx));
}

export async function dropEventTx(
  input: DropEventInput,
  tx: TxClient,
): Promise<DropEventResult> {
  const def = getEventDef(input.event_def_id);
  if (!def) return { status: 'rejected', reason: 'invalid-scope' };

  // Scope-target validation.
  if (def.scope === 'city' && !input.city_id) {
    return { status: 'rejected', reason: 'no-target' };
  }
  if (def.scope === 'faction' && !input.faction_id) {
    return { status: 'rejected', reason: 'no-target' };
  }

  const active = await tx.worldEvent.findMany({
    where: { world_id: input.world_id, ended_year: null },
    select: { id: true, event_def_id: true },
  });
  const intentId = `drop-${input.event_def_id}-${input.year}`;
  const planned: PlannedDrop[] = [
    {
      intent_id: intentId,
      source: input.source,
      event_def_id: input.event_def_id,
      city_id: input.city_id,
      faction_id: input.faction_id,
      cooldown_key: def.cascade_key,
    },
  ];
  const plan = planActivation(planned, active as ActiveEventLite[]);
  const decision = plan.decisions[0];

  if (decision.action === 'reject') {
    return { status: 'rejected', reason: decision.reason };
  }
  if (decision.action === 'queue') {
    return { status: 'queued' };
  }

  // Fire (possibly with replacement).
  let replacedId: string | undefined;
  if (decision.replaces_event_id) {
    replacedId = decision.replaces_event_id;
    await tx.worldEvent.update({
      where: { id: decision.replaces_event_id },
      data: { ended_year: input.year, end_reason: 'overridden' },
    });
  }

  const created = await tx.worldEvent.create({
    data: {
      world_id: input.world_id,
      event_def_id: input.event_def_id,
      city_id: input.city_id ?? null,
      faction_id: input.faction_id ?? null,
      started_year: input.year,
      duration_years: def.default_duration ?? null,
      end_condition: def.end_condition as unknown as Prisma.InputJsonValue,
      bucket_modifiers: def.bucket_modifiers as unknown as Prisma.InputJsonValue,
      real_person_target_rules: def.real_person_target_rules as unknown as Prisma.InputJsonValue,
      cooldown_key: def.cascade_key ?? null,
    },
  });

  if (replacedId) {
    return { status: 'replaced', event: created, replaced_id: replacedId };
  }
  return { status: 'fired', event: created };
}

// ─── End ─────────────────────────────────────────────────────────────────────

export async function endEventTx(
  args: { event_id: string; year: number; end_reason: EventEndReason },
  tx: TxClient,
): Promise<void> {
  await tx.worldEvent.update({
    where: { id: args.event_id },
    data: { ended_year: args.year, end_reason: args.end_reason },
  });
}

// ─── Tick ────────────────────────────────────────────────────────────────────

/**
 * Apply each active event's bucket modifiers + target rules, evaluate end
 * conditions, archive expired/resolved events. Caller passes year + rng.
 */
export async function tickActiveEventsTx(
  worldId: string,
  year: number,
  rng: Rng,
  tx: TxClient,
): Promise<{ ended: number; victim_kills: number }> {
  const active = await tx.worldEvent.findMany({
    where: { world_id: worldId, ended_year: null },
  });
  if (active.length === 0) return { ended: 0, victim_kills: 0 };

  const cities = await tx.city.findMany({
    where: { world_id: worldId },
    include: { buckets: true },
  });
  if (cities.length === 0) return { ended: 0, victim_kills: 0 };

  const world = await tx.world.findUnique({ where: { id: worldId } });
  if (!world) return { ended: 0, victim_kills: 0 };

  let ended = 0;
  let victimKills = 0;

  // Build active-event scope buckets per city.
  for (const city of cities) {
    const scopedActive: ActiveEventScoped[] = active
      .filter((e) => e.event_def_id !== 'GreatCrash' &&
                     e.event_def_id !== 'GoldenAge' &&
                     e.event_def_id !== 'Discovery'
        ? // city-scoped or faction-scoped: must match city for city-scoped,
          // or faction events affect all cities (faction territory in v2; v1 single-city)
          e.city_id == null || e.city_id === city.id
        : true) // global events affect every city
      .map((e) => ({
        bucket_modifiers: (Array.isArray(e.bucket_modifiers)
          ? e.bucket_modifiers
          : []) as unknown as ActiveEventScoped['bucket_modifiers'],
      }));

    const bucketLites: BucketLite[] = city.buckets.map((b) => ({ type: b.type }));
    const deltas = applyEventModifiers(bucketLites, scopedActive);

    for (const b of city.buckets) {
      const d = deltas[b.type];
      if (!d) continue;
      // Skip rows where stacking left identity (cheap fast-path).
      const noop =
        d.income_multiplier === 1 &&
        d.birth_rate_multiplier === 1 &&
        d.mortality_delta === 0 &&
        d.happiness_delta === 0;
      if (noop) continue;
      const newCount = Math.max(
        0,
        Math.round(b.count - b.count * d.mortality_delta),
      );
      const newWealth = Math.max(0, Math.round(b.avg_wealth * d.income_multiplier));
      const newHappiness = clamp01(b.avg_happiness + d.happiness_delta, 0, 100);
      const newBirthRate = Math.max(0, b.birth_rate * d.birth_rate_multiplier);
      await tx.bucket.update({
        where: { city_id_type: { city_id: city.id, type: b.type } },
        data: {
          count: newCount,
          avg_wealth: newWealth,
          avg_happiness: newHappiness,
          birth_rate: newBirthRate,
        },
      });
    }
  }

  // Real-person target rules — for each active event, draw victims from the
  // alive real persons matching the rule's pool, then apply effects.
  for (const ev of active) {
    const rules = (Array.isArray(ev.real_person_target_rules)
      ? ev.real_person_target_rules
      : []) as unknown as RealPersonTargetRule[];
    if (rules.length === 0) continue;

    // Build candidate pool: alive persons in this event's scope.
    const candidates = await tx.person.findMany({
      where: {
        world_id: worldId,
        is_alive: true,
        ...(ev.city_id ? { city_id: ev.city_id } : {}),
        ...(ev.faction_id ? { faction_id: ev.faction_id } : {}),
      },
      select: {
        id: true,
        city_id: true,
        type: true,
        faction_id: true,
        state_tags: true,
        recent_memories: true,
        current_health: true,
        name: true,
      },
    });

    for (const rule of rules) {
      const picks = pickEventVictims(rule, candidates, rng);
      for (const id of picks) {
        const target = candidates.find((c) => c.id === id);
        if (!target) continue;

        if (rule.apply.kill) {
          await handleLeaderDeathTx(id, year, tx);
          await archiveAndDeleteTx(
            { person_id: id, reason: 'death', year, death_cause: 'event' },
            tx,
          );
          victimKills += 1;
          continue;
        }
        // Tag-or-health effects: load fresh, mutate, persist.
        const tags = (Array.isArray(target.state_tags)
          ? target.state_tags
          : []) as unknown as StateTagEntry[];
        const mems = (Array.isArray(target.recent_memories)
          ? target.recent_memories
          : []) as unknown as Memory[];

        let nextTags = tags;
        if (rule.apply.state_tag) {
          nextTags = addStateTag(tags, rule.apply.state_tag as StateTag, year);
        }
        const newHealth =
          rule.apply.health_delta !== undefined
            ? Math.max(0, target.current_health + rule.apply.health_delta)
            : target.current_health;
        const nextMems = addMemory(mems, {
          year,
          kind: `event-${ev.event_def_id.toLowerCase()}`,
          summary: `affected by ${ev.event_def_id}`,
          magnitude: 0.5,
          tone: getEventDef(ev.event_def_id).headline_tone,
        });
        await tx.person.update({
          where: { id },
          data: {
            state_tags: nextTags as unknown as Prisma.InputJsonValue,
            current_health: newHealth,
            recent_memories: nextMems as unknown as Prisma.InputJsonValue,
            last_event_year: year,
          },
        });
      }
    }
  }

  // §8.5 — Phase 13a: FactionWar resolver. Intercepts before generic end
  // condition eval so the spec'd "either side hits zero" semantics fire even
  // if the catalog's `war-resolved` descriptor would still pass.
  const factionWarsEnded = new Set<string>();
  for (const ev of active) {
    if (ev.event_def_id !== 'FactionWar' || ev.ended_year != null) continue;
    if (!ev.faction_id) continue;
    const ended = await resolveFactionWarTx(ev.id, ev.faction_id, year, tx);
    if (ended) {
      factionWarsEnded.add(ev.id);
    }
  }

  // Evaluate end conditions and archive resolved events.
  for (const ev of active) {
    if (factionWarsEnded.has(ev.id)) {
      ended += 1;
      continue;
    }
    const def = getEventDef(ev.event_def_id);
    if (!def) continue;
    const ctx = await buildEndContext(ev, year, world.market_index, tx);
    const result = evaluateEndCondition(
      ev.end_condition as unknown as EndConditionDescriptor,
      ctx,
    );
    if (result === 'continue') continue;
    const reason: EventEndReason = result === 'expired' ? 'expired' : 'condition_met';
    await endEventTx({ event_id: ev.id, year, end_reason: reason }, tx);
    ended += 1;
  }

  return { ended, victim_kills: victimKills };
}

/**
 * §8.5 — Phase 13a war resolver. Reads both sides, applies the engine
 * predicate, and on end: clears at_war_with on both factions, writes "war
 * ended" memories on both leaders, and ends the WorldEvent. Returns true
 * if the event was ended by this call.
 */
async function resolveFactionWarTx(
  eventId: string,
  factionAId: string,
  year: number,
  tx: TxClient,
): Promise<boolean> {
  const a = await tx.group.findUnique({ where: { id: factionAId } });
  if (!a) return false;
  const opponentIds = (Array.isArray(a.at_war_with) ? a.at_war_with : []) as string[];
  if (opponentIds.length === 0) return false;
  // We resolve against the first listed opponent — v1 single-pair wars.
  const factionBId = opponentIds[0];
  const b = await tx.group.findUnique({ where: { id: factionBId } });
  if (!b) return false;

  const ev = evaluateWarEnd(
    {
      id: a.id,
      name: a.name,
      army_size: a.army_size,
      treasury: a.treasury,
      member_count_cached: a.member_count_cached,
      is_active: a.is_active,
    },
    {
      id: b.id,
      name: b.name,
      army_size: b.army_size,
      treasury: b.treasury,
      member_count_cached: b.member_count_cached,
      is_active: b.is_active,
    },
  );
  if (!ev.ended) return false;

  // Clear at_war_with on both sides — only this opponent pair, not all.
  const aRemaining = opponentIds.filter((id) => id !== b.id);
  const bWar = (Array.isArray(b.at_war_with) ? b.at_war_with : []) as string[];
  const bRemaining = bWar.filter((id) => id !== a.id);
  await tx.group.update({
    where: { id: a.id },
    data: { at_war_with: aRemaining as unknown as Prisma.InputJsonValue },
  });
  await tx.group.update({
    where: { id: b.id },
    data: { at_war_with: bRemaining as unknown as Prisma.InputJsonValue },
  });

  // Write "war ended" memory on each living leader (best-effort).
  for (const g of [a, b]) {
    if (!g.leader_id) continue;
    const leader = await tx.person.findFirst({
      where: { id: g.leader_id, is_alive: true },
      select: { id: true },
    });
    if (!leader) continue;
    await appendMemoryTx(
      leader.id,
      {
        year,
        kind: 'war-ended',
        summary: `the war between ${a.name} and ${b.name} ended (${ev.reason ?? 'resolved'})`,
        magnitude: 0.7,
        tone: 'epic',
      },
      tx,
    );
  }

  await endEventTx({ event_id: eventId, year, end_reason: 'condition_met' }, tx);
  return true;
}

async function buildEndContext(
  ev: WorldEvent,
  year: number,
  marketIndex: number,
  tx: TxClient,
): Promise<EndConditionContext> {
  const ctx: EndConditionContext = {
    current_year: year,
    started_year: ev.started_year,
    market_index: marketIndex,
  };
  if (ev.event_def_id === 'Plague' && ev.city_id) {
    // Approximate "infected_pct" as 0; v1 doesn't track infected — Plague
    // ends after a couple ticks via this path. Caller can refine in v2.
    ctx.infected_pct = 0;
  }
  if (ev.event_def_id === 'FactionWar' && ev.faction_id) {
    const g = await tx.group.findUnique({ where: { id: ev.faction_id } });
    ctx.army_size = g?.army_size ?? 0;
  }
  if (ev.event_def_id === 'Siege') {
    // v1: no siege resolver — keep unresolved until duration hard cap; the
    // descriptor reads `siege-resolved` so without ctx flags the event will
    // continue. Phase 9 wires the resolver.
    ctx.siege_unresolved = true;
  }
  return ctx;
}

// ─── Cascades ────────────────────────────────────────────────────────────────

export async function evaluateCascadesTx(
  worldId: string,
  year: number,
  rng: Rng,
  tx: TxClient,
): Promise<{ fires: CascadeFire[]; queued: number; rejected: number }> {
  const world = await tx.world.findUnique({ where: { id: worldId } });
  if (!world) return { fires: [], queued: 0, rejected: 0 };

  const stateHistory = (Array.isArray(world.state_history)
    ? world.state_history
    : []) as unknown as WorldStateSnapshot[];

  // Build per-key cooldown map from prior fires. We use the most recent
  // ended_year (or started_year if still active) per cooldown_key.
  const cooldownRows = await tx.worldEvent.findMany({
    where: { world_id: worldId, cooldown_key: { not: null } },
    select: { cooldown_key: true, started_year: true, ended_year: true },
  });
  const cooldowns: Partial<Record<CascadeKey, number>> = {};
  for (const r of cooldownRows) {
    if (!r.cooldown_key) continue;
    const lastYear = r.ended_year ?? r.started_year;
    const prev = cooldowns[r.cooldown_key as CascadeKey];
    if (prev === undefined || lastYear > prev) {
      cooldowns[r.cooldown_key as CascadeKey] = lastYear;
    }
  }

  const fires = evaluateCascades({
    current_year: year,
    state_history: stateHistory,
    cooldowns,
    rng,
  });

  let queued = 0;
  let rejected = 0;
  for (const f of fires) {
    const result = await dropEventTx(
      {
        world_id: worldId,
        event_def_id: f.event_def_id,
        city_id: f.city_id,
        year,
        source: 'cascade',
      },
      tx,
    );
    if (result.status === 'queued') queued += 1;
    else if (result.status === 'rejected') rejected += 1;
  }
  return { fires, queued, rejected };
}

// ─── State history push ─────────────────────────────────────────────────────

export async function pushStateHistoryTx(
  worldId: string,
  year: number,
  tx: TxClient,
  /** Optional extras to record on the snapshot — currently the food_ratio
   *  computed inside the bucket-dynamics market step. The Famine cascade
   *  reads this off the snapshot rather than recomputing. */
  extra?: { food_ratio?: number },
): Promise<void> {
  const world = await tx.world.findUnique({ where: { id: worldId } });
  if (!world) return;
  const cities = await tx.city.findMany({
    where: { world_id: worldId },
    include: { buckets: { select: { type: true, count: true, avg_health: true, avg_happiness: true } } },
  });

  const snap: WorldStateSnapshot = {
    year,
    market_index: world.market_index,
    food_ratio: extra?.food_ratio,
    cities: {},
  };
  for (const c of cities) {
    const total = c.buckets.reduce((s, b) => s + b.count, 0);
    const farmer = c.buckets.find((b) => b.type === 'Farmer');
    const farmerCount = farmer?.count ?? 0;
    const avgHealth =
      total > 0
        ? c.buckets.reduce((s, b) => s + b.avg_health * b.count, 0) / total
        : 0;
    snap.cities[c.id] = {
      avg_happiness: c.mood_score,
      avg_health: avgHealth,
      farmer_count: farmerCount,
    };
  }

  const prev = (Array.isArray(world.state_history)
    ? world.state_history
    : []) as unknown as WorldStateSnapshot[];
  // Replace any existing snapshot for this year (idempotent re-runs).
  const filtered = prev.filter((s) => s.year !== year);
  const next = [...filtered, snap].slice(-STATE_HISTORY_CAP);
  await tx.world.update({
    where: { id: worldId },
    data: { state_history: next as unknown as Prisma.InputJsonValue },
  });
}

// ─── Read helpers (route layer) ─────────────────────────────────────────────

export async function listEvents(
  args: { world_id: string; active?: boolean; kind?: EventType },
  prisma: PrismaClient = defaultPrisma,
): Promise<WorldEvent[]> {
  return prisma.worldEvent.findMany({
    where: {
      world_id: args.world_id,
      ...(args.active === true ? { ended_year: null } : {}),
      ...(args.active === false ? { ended_year: { not: null } } : {}),
      ...(args.kind ? { event_def_id: args.kind } : {}),
    },
    orderBy: [{ started_year: 'desc' }],
  });
}

export async function getEvent(
  id: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<WorldEvent | null> {
  return prisma.worldEvent.findUnique({ where: { id } });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function clamp01(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// Re-export for tests.
export type { EventDef, ActivationDecision, ActiveEventLite, PlannedDrop };
export { EVENT_ACTIVE_CAP };
