// ============================================================
// YEAR SERVICE — §0.5 Phase 2: Async Year Pipeline
// ------------------------------------------------------------
// Replaces the synchronous /api/interactions/tick with a
// pg-boss–driven pipeline. One "Advance Year" = 3 phases:
//
//   1. Bi-annual A  — interactions, events, deaths, births, market
//   2. Bi-annual B  — same passes, second half of the year
//   3. Year-end     — aging, agentic turn, conversions, splits,
//                     memory/trauma decay, occupation income,
//                     relationship decay, leader extraction,
//                     group treasury, yearly report
//
// Each phase writes a WorldSnapshot on completion. The SSE
// endpoint streams YearRun row updates to the frontend so the
// player has a live progress heartbeat.
//
// Player-direct actions (steal/gift/force) remain synchronous
// and immediate — they do not go through this pipeline.
// ============================================================

import { EventEmitter } from 'node:events';
import type { Job } from 'pg-boss';
import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import {
  PREGNANCY_DURATION_TICKS,
  TRAUMA_ANNUAL_DECAY,
  type RulesetDef,
} from '@civ-sim/shared';
import { withTiming, type PhaseTimings } from '../tick/timing';
import { resolveInteractionsPhase } from '../tick/resolve-interactions';
import { updateThreeMarkets, type MarketHistoryEntry } from '../tick/market';
import { deriveHardStats, type DeriveStatsInput } from '../tick/derive-stats';
import { processBirths } from '../services/births.service';
import {
  loadActiveGroups,
  loadMembershipIndex,
  runMembershipDropoff,
  type PersonSnapshot,
} from '../services/membership.service';
import { spawnGroup } from '../services/group-formation.service';
import {
  handlePersonDeath,
  runFactionSplitCheck,
} from '../services/group-lifecycle.service';
import {
  extractLeaderCuts,
  checkSmallGroupDisbands,
} from '../services/leadership.service';
import { writeMemoriesBatch } from '../services/memory.service';
import {
  applyRelationshipDeltas,
  decayAndPruneForWorld,
  classifyImpactForRelationship,
} from '../services/relationships.service';
import {
  runAgenticTurn,
  type AgentPersonSnapshot,
  type OwnedEdge,
} from '../services/agentic.service';
import {
  applyOccupationIncome,
  distributeInheritance,
} from '../services/economy-occupation.service';
import {
  processEconomyTick,
  type EconomyPerson,
} from '../services/economy.service';
import {
  runReligionConversionPass,
} from '../services/religion-dynamics.service';
import {
  processEventsTick,
  applyHappinessDrift,
  fundGroupTreasuries,
  decrementEventTimers,
} from '../services/events.service';
import type { CriminalRecord } from '@civ-sim/shared';

// ── SSE bus ──────────────────────────────────────────────────
// yearRunBus.emit(yearRunId, payload) — SSE route subscribes per request.
// In-process pub/sub; no polling required.
export const yearRunBus = new EventEmitter();

// ── Year-run helpers ─────────────────────────────────────────

export interface YearRunUpdate {
  year_run_id: string;
  phase:        string;
  progress_pct: number;
  status:       string;
  message?:     string;
}

async function updateYearRun(
  yearRunId:   string,
  phase:       string,
  progressPct: number,
  status = 'running',
  message?: string,
): Promise<void> {
  await prisma.yearRun.update({
    where: { id: yearRunId },
    data:  {
      phase,
      progress_pct: progressPct,
      status,
      ...(message ? { message } : {}),
    },
  });
  const update: YearRunUpdate = { year_run_id: yearRunId, phase, progress_pct: progressPct, status, message };
  yearRunBus.emit(yearRunId, update);
}

// ── Effective-tick helper ─────────────────────────────────────
// Pregnancy.due_tick uses 2 ticks-per-year units.
// year_count=5, biAnnualIndex=0 → effectiveTick=10
// year_count=5, biAnnualIndex=1 → effectiveTick=11
function effectiveTick(yearCount: number, biAnnualIndex: number): number {
  return yearCount * 2 + biAnnualIndex;
}

// ── Snapshot writer ───────────────────────────────────────────

async function writeSnapshot(worldId: string, year: number, biAnnualIndex: number): Promise<void> {
  const [world, population, avgStats, religionRows, factionRows, activeEvents, recentDeaths, infectionCounts] = await Promise.all([
    prisma.world.findUniqueOrThrow({ where: { id: worldId } }),
    prisma.person.count({ where: { world_id: worldId, current_health: { gt: 0 } } }),
    prisma.person.aggregate({
      where: { world_id: worldId, current_health: { gt: 0 } },
      _avg:  { current_health: true, happiness: true, money: true },
    }),
    prisma.religion.findMany({
      where:   { world_id: worldId, is_active: true },
      include: { memberships: { select: { id: true } }, leader: { select: { id: true, name: true, money: true } } },
      orderBy: { balance: 'desc' },
    }),
    prisma.faction.findMany({
      where:   { world_id: worldId, is_active: true },
      include: { memberships: { select: { id: true } }, leader: { select: { id: true, name: true, money: true } } },
      orderBy: { balance: 'desc' },
    }),
    prisma.worldEvent.findMany({ where: { world_id: worldId, is_active: true } }),
    // Recent deaths in the current world year, grouped by cause.
    prisma.deceasedPerson.groupBy({
      by:    ['cause'],
      where: { world_id: worldId, world_year: year },
      _count: { _all: true },
    }),
    // Per-event infection counts (covers plague-style events; 0 for everything else).
    prisma.personEventStatus.groupBy({
      by:     ['event_id'],
      where:  { event: { world_id: worldId, is_active: true }, status: 'infected' },
      _count: { _all: true },
    }),
  ]);

  const relByCount = [...religionRows].sort((a, b) => b.memberships.length - a.memberships.length);

  const recentDeathsTotal = recentDeaths.reduce((sum, row) => sum + row._count._all, 0);
  const recentDeathsByCause = Object.fromEntries(
    recentDeaths.map(row => [row.cause, row._count._all]),
  );

  const infectionByEventId = new Map(
    infectionCounts.map(row => [row.event_id, row._count._all]),
  );

  const payload = {
    year,
    bi_annual_index: biAnnualIndex,
    population,
    total_deaths: world.total_deaths,
    recent_deaths_year: {
      year,
      total:    recentDeathsTotal,
      by_cause: recentDeathsByCause as Record<string, number>,
    },
    averages: {
      health:    Math.round(avgStats._avg.current_health ?? 0),
      happiness: Math.round(avgStats._avg.happiness ?? 0),
      money:     Math.round(avgStats._avg.money ?? 0),
    },
    markets: {
      stable:   { index: world.market_stable_index,  trend: world.market_stable_trend  },
      standard: { index: world.market_index,          trend: world.market_trend          },
      volatile: { index: world.market_volatile_index, trend: world.market_volatile_trend },
    },
    religions: {
      top_by_count:   relByCount.slice(0, 3).map(r => ({ id: r.id, name: r.name, value: r.memberships.length })),
      top_by_balance: religionRows.slice(0, 3).map(r => ({ id: r.id, name: r.name, value: r.balance })),
      richest_leader: religionRows
        .filter(r => r.leader)
        .sort((a, b) => (b.leader?.money ?? 0) - (a.leader?.money ?? 0))[0]
        ? (() => { const r = religionRows.filter(x => x.leader).sort((a, b) => (b.leader?.money ?? 0) - (a.leader?.money ?? 0))[0]; return { id: r.id, name: r.name, leader_name: r.leader!.name, leader_money: r.leader!.money }; })()
        : null,
    },
    factions: {
      top_by_count:   [...factionRows].sort((a, b) => b.memberships.length - a.memberships.length).slice(0, 3).map(f => ({ id: f.id, name: f.name, value: f.memberships.length })),
      top_by_balance: factionRows.slice(0, 3).map(f => ({ id: f.id, name: f.name, value: f.balance })),
      richest_leader: factionRows
        .filter(f => f.leader)
        .sort((a, b) => (b.leader?.money ?? 0) - (a.leader?.money ?? 0))[0]
        ? (() => { const f = factionRows.filter(x => x.leader).sort((a, b) => (b.leader?.money ?? 0) - (a.leader?.money ?? 0))[0]; return { id: f.id, name: f.name, leader_name: f.leader!.name, leader_money: f.leader!.money }; })()
        : null,
    },
    active_events: activeEvents.map(e => ({
      id:              e.id,
      def_id:          e.event_def_id,
      params:          e.params,
      started_year:    e.started_year,
      duration_years:  e.duration_years,
      years_remaining: e.years_remaining,
      stats: {
        infected_count: infectionByEventId.get(e.id) ?? 0,
      },
    })),
    updated_at: new Date().toISOString(),
  };

  await prisma.worldSnapshot.upsert({
    where:  { world_id: worldId },
    create: { world_id: worldId, payload: payload as unknown as Prisma.InputJsonValue },
    update: { payload: payload as unknown as Prisma.InputJsonValue },
  });
}

// ── Living person shape ───────────────────────────────────────

type LivingPerson = {
  id:                  string;
  name:                string;
  age:                 number;
  death_age:           number;
  money:               number;
  job_id:              string | null;
  traits:              Prisma.JsonValue;
  global_scores:       Prisma.JsonValue;
  max_health:          number;
  current_health:      number;
  attack:              number;
  defense:             number;
  speed:               number;
  trauma_score:        number;
  relationship_status: string;
  criminal_record:     Prisma.JsonValue;
};

// ── Bi-annual phase ───────────────────────────────────────────
// Interactions, events, deaths, births, market. Mirrors the
// non-year-boundary section of the old /api/interactions/tick.

async function runBiAnnualPhase(
  worldId:     string,
  tickNum:     number,
  currentYear: number,
  yearRunId:   string,
  timings:     PhaseTimings,
): Promise<void> {
  const EMPTY_GLOBAL_TRAITS = {} as ReturnType<typeof Object.create>;
  const EMPTY_TRAIT_MULTS:   Record<string, number> = {};

  // 1. Load world + ruleset
  const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
  const rulesetRow = await prisma.ruleset.findFirst({ where: { is_active: true } });
  if (!rulesetRow) throw new Error('No active ruleset');
  const rules = rulesetRow.rules as unknown as RulesetDef;

  // 2. Load living persons
  const living = await prisma.person.findMany({
    where:  { world_id: worldId, current_health: { gt: 0 } },
    select: {
      id: true, name: true, money: true, age: true, death_age: true,
      job_id: true, traits: true, global_scores: true,
      max_health: true, current_health: true, attack: true, defense: true, speed: true,
      trauma_score: true, relationship_status: true, criminal_record: true,
    },
  }) as LivingPerson[];

  if (living.length < 2) return;

  const byId = new Map(living.map(p => [p.id, p]));
  const livingIds = living.map(p => p.id);

  // 3. Inner-circle links
  const allLinks = await prisma.innerCircleLink.findMany({
    where:  { owner_id: { in: livingIds } },
    select: { owner_id: true, target_id: true, bond_strength: true, relation_type: true },
  });
  const linksOf = new Map<string, OwnedEdge[]>();
  for (const l of allLinks) {
    const arr = linksOf.get(l.owner_id) ?? [];
    arr.push({ target_id: l.target_id, bond_strength: l.bond_strength, relation_type: l.relation_type as OwnedEdge['relation_type'] });
    linksOf.set(l.owner_id, arr);
  }

  // 4. Groups + membership
  const groups      = await loadActiveGroups(prisma);
  const memberships = await loadMembershipIndex(prisma);

  const personSnaps = new Map<string, PersonSnapshot>();
  for (const p of living) {
    personSnaps.set(p.id, {
      id:             p.id,
      traits:         (p.traits        ?? {}) as Record<string, number>,
      global_scores:  (p.global_scores ?? {}) as Record<string, number>,
      current_health: p.current_health,
    });
  }

  // 5. Resolve interactions
  const phaseResult = await withTiming(timings, 'resolveInteractions', () =>
    resolveInteractionsPhase({
      prisma,
      rules,
      living,
      byId,
      linksOf,
      personSnaps,
      groups,
      memberships,
      globalTraits: EMPTY_GLOBAL_TRAITS,
      traitMults:   EMPTY_TRAIT_MULTS,
    }),
  );
  const { traitDeltas, pendingMemories, pendingJoinsByKey, pendingSpawnsByFounder, pendingPregnanciesByPair } = phaseResult;

  // 6. Compute final health + trait updates
  const finalHealth: Record<string, number> = {};
  type BulkUpdateRow = { id: string; traits: Record<string, number>; current_health?: number };
  const bulkUpdates: BulkUpdateRow[] = [];

  for (const p of living) {
    const td = traitDeltas[p.id] ?? {};
    const existingTraits = (p.traits ?? {}) as Record<string, number>;
    const newTraits: Record<string, number> = { ...existingTraits };
    let changed = false;

    for (const [key, delta] of Object.entries(td)) {
      if (delta === 0) continue;
      const cur  = newTraits[key] ?? 50;
      const next = Math.max(0, Math.min(100, cur + delta));
      if (next !== cur) { newTraits[key] = next; changed = true; }
    }

    if (changed) {
      const row: BulkUpdateRow = { id: p.id, traits: newTraits };
      if (td.current_health !== undefined) row.current_health = Math.max(0, Math.min(100, p.current_health + td.current_health));
      finalHealth[p.id] = row.current_health ?? p.current_health;
      bulkUpdates.push(row);
    } else {
      finalHealth[p.id] = p.current_health;
    }
  }

  // 7. Persist: traits + memories + joins + spawns + pregnancies
  await withTiming(timings, 'persistInteractions', () => prisma.$transaction(async (tx) => {
    if (bulkUpdates.length > 0) {
      await tx.$executeRaw`
        UPDATE persons p SET
          traits         = p.traits || (u.updates->'traits')::jsonb,
          current_health = COALESCE((u.updates->>'current_health')::int, p.current_health),
          updated_at     = NOW()
        FROM jsonb_array_elements(${JSON.stringify(bulkUpdates)}::jsonb) AS u(updates)
        WHERE p.id = (u.updates->>'id')::uuid
      `;
    }

    if (pendingMemories.length > 0) {
      await writeMemoriesBatch(tx, pendingMemories.map(m => ({
        personId:        m.person_id,
        eventSummary:    m.event_summary,
        emotionalImpact: m.emotional_impact,
        deltaApplied:    { score: m.event_summary },
        magnitude:       m.magnitude,
        counterpartyId:  m.counterparty_id,
        worldYear:       currentYear,
        tone:            m.tone,
        ageAtEvent:      m.age_at_event,
        eventKind:       'interaction',
      })));

      const relDeltas = pendingMemories
        .filter(m => m.counterparty_id)
        .map(m => {
          const classified = classifyImpactForRelationship(m.emotional_impact);
          if (!classified) return null;
          return { ownerId: m.person_id, targetId: m.counterparty_id!, kind: classified.kind, strengthDelta: classified.delta };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null);
      if (relDeltas.length > 0) await applyRelationshipDeltas(tx, relDeltas);
    }

    if (pendingJoinsByKey.size > 0) {
      const religionJoins = [];
      const factionJoins  = [];
      for (const c of pendingJoinsByKey.values()) {
        const row = { person_id: c.subject.id, joined_year: currentYear, alignment: c.alignment };
        if (c.groupKind === 'religion') religionJoins.push({ ...row, religion_id: c.groupId });
        else                            factionJoins.push({  ...row, faction_id:  c.groupId });
      }
      if (religionJoins.length > 0) await tx.religionMembership.createMany({ data: religionJoins, skipDuplicates: true });
      if (factionJoins.length  > 0) await tx.factionMembership.createMany({  data: factionJoins,  skipDuplicates: true });
    }

    for (const intent of pendingSpawnsByFounder.values()) {
      await spawnGroup(tx, intent, currentYear, worldId);
    }

    for (const pair of pendingPregnanciesByPair.values()) {
      const existing = await tx.pregnancy.findFirst({
        where: {
          world_id: worldId, resolved: false,
          OR: [
            { parent_a_id: pair.parent_a_id }, { parent_b_id: pair.parent_a_id },
            { parent_a_id: pair.parent_b_id }, { parent_b_id: pair.parent_b_id },
          ],
        },
        select: { id: true },
      });
      if (existing) continue;
      await tx.pregnancy.create({
        data: {
          parent_a_id: pair.parent_a_id, parent_b_id: pair.parent_b_id,
          world_id: worldId, started_tick: tickNum, due_tick: tickNum + PREGNANCY_DURATION_TICKS,
        },
      });
    }
  }));

  // 8. Derive hard stats — only for persons whose traits changed this phase.
  // Full-population re-derive is O(N) with no benefit when traits are constant.
  if (bulkUpdates.length > 0) {
    await withTiming(timings, 'deriveHardStats', async () => {
      const updatedTraitsById = new Map(bulkUpdates.map(u => [u.id, u.traits]));
      const changedIds        = new Set(bulkUpdates.map(u => u.id));
      const deriveInputs: DeriveStatsInput[] = living
        .filter(p => changedIds.has(p.id) && finalHealth[p.id] > 0)
        .map(p => ({
          id:             p.id,
          current_health: finalHealth[p.id],
          max_health:     p.max_health,
          attack:         p.attack,
          defense:        p.defense,
          speed:          p.speed,
          traits:         updatedTraitsById.get(p.id) ?? (p.traits as Record<string, number>) ?? {},
        }));
      if (deriveInputs.length > 0) await deriveHardStats(prisma, deriveInputs);
    });
  }

  // 9. Critical health mortal risk (1–9 HP)
  for (const p of living) {
    const hp = finalHealth[p.id];
    if (hp > 0 && hp < 10) {
      const deathChance = (10 - hp) / 10 * 0.4;
      if (Math.random() < deathChance) finalHealth[p.id] = 0;
    }
  }

  // 10. Interaction deaths — single transaction for all dead this bi-annual.
  const interactionDead = living.filter(p => finalHealth[p.id] <= 0);
  if (interactionDead.length > 0) {
    await withTiming(timings, 'processInteractionDeaths', () =>
      prisma.$transaction(async (tx) => {
        // Distribute inheritance before any rows are deleted (cascade kills inner_circle_links).
        for (const p of interactionDead) {
          await handlePersonDeath(tx, p.id, p.name, currentYear, worldId);
          await distributeInheritance(tx, p.id, p.name, p.money, currentYear);
        }
        // Bulk insert deceased records, bulk delete persons.
        await tx.deceasedPerson.createMany({
          data: interactionDead.map(p => ({
            name: p.name, age_at_death: p.age, world_year: currentYear,
            cause: 'interaction', final_health: 0, final_money: p.money, world_id: worldId,
          })),
        });
        await tx.person.deleteMany({ where: { id: { in: interactionDead.map(p => p.id) } } });
        await tx.world.update({
          where: { id: worldId },
          data:  { total_deaths: { increment: interactionDead.length } },
        });
      }),
    );
  }

  // 11. Economy tick
  const economyAlive: EconomyPerson[] = living
    .filter(p => finalHealth[p.id] > 0)
    .map(p => ({ id: p.id, name: p.name, age: p.age, money: p.money, job_id: p.job_id, traits: (p.traits ?? {}) as Record<string, number> }));

  await withTiming(timings, 'economyTick', () =>
    processEconomyTick(
      prisma, economyAlive,
      linksOf as Map<string, { target_id: string; bond_strength: number }[]>,
      memberships.factionsByPerson, currentYear, worldId,
    ),
  );

  // 12. Events tick + happiness drift + group treasury funding
  await withTiming(timings, 'eventsTick', () =>
    Promise.all([
      processEventsTick(prisma, worldId, tickNum, currentYear),
      applyHappinessDrift(prisma, worldId),
      fundGroupTreasuries(prisma, worldId),
    ]),
  );

  // 12b. Event timer decrement + auto-expiry — Phase 4
  await withTiming(timings, 'eventTimers', () =>
    decrementEventTimers(prisma, worldId, currentYear),
  );

  // 13. Births
  await withTiming(timings, 'processBirths', () =>
    processBirths(worldId, tickNum, currentYear, {}),
  );

  // 13b. Small-group disbands — Phase 5
  await withTiming(timings, 'smallGroupDisbands', () =>
    prisma.$transaction(async (tx) => {
      await checkSmallGroupDisbands(tx, worldId, currentYear);
    }),
  );

  // 14. Market update
  const freshWorld = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
  const history    = (freshWorld.market_history as unknown as MarketHistoryEntry[]) ?? [];
  await withTiming(timings, 'updateMarket', () =>
    updateThreeMarkets({
      prisma, worldId, tickCount: tickNum,
      stableIndex:        freshWorld.market_stable_index,
      stableTrend:        freshWorld.market_stable_trend,
      stableVolatility:   freshWorld.market_stable_volatility,
      standardIndex:      freshWorld.market_index,
      standardTrend:      freshWorld.market_trend,
      standardVolatility: freshWorld.market_volatility,
      volatileIndex:      freshWorld.market_volatile_index,
      volatileTrend:      freshWorld.market_volatile_trend,
      volatileVolatility: freshWorld.market_volatile_volatility,
      marketHistory:      history,
    }),
  );
}

// ── Year-end phase ────────────────────────────────────────────
// Aging, natural deaths, memory/trauma decay, membership dropoff,
// faction splits, relationship decay, agentic turn, occupation
// income, religion conversions, yearly report.

async function runYearEndPhase(
  worldId:    string,
  newYear:    number,
  yearRunId:  string,
  timings:    PhaseTimings,
): Promise<void> {
  const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });

  // 1. Age all living characters
  await prisma.$executeRaw`
    UPDATE persons SET age = LEAST(age + 1, death_age), updated_at = NOW()
    WHERE world_id = ${worldId}::uuid
  `;

  // 2. Natural deaths
  const naturallyDying = await prisma.$queryRaw<
    Array<{ id: string; name: string; age: number; money: number }>
  >`SELECT id, name, age, money FROM persons WHERE world_id = ${worldId}::uuid AND age >= death_age AND current_health > 0`;

  const naturalDeaths = naturallyDying.length;
  if (naturalDeaths > 0) {
    await prisma.$transaction(async (tx) => {
      for (const dead of naturallyDying) {
        await handlePersonDeath(tx, dead.id, dead.name, newYear, worldId);
        await distributeInheritance(tx, dead.id, dead.name, dead.money, newYear);
      }
      await tx.deceasedPerson.createMany({
        data: naturallyDying.map(dead => ({
          name: dead.name, age_at_death: dead.age, world_year: newYear,
          cause: 'old_age', final_health: 0, final_money: dead.money, world_id: worldId,
        })),
      });
      await tx.person.deleteMany({ where: { id: { in: naturallyDying.map(d => d.id) } } });
      await tx.world.update({
        where: { id: worldId },
        data:  { total_deaths: { increment: naturalDeaths } },
      });
    });
  }

  // 3. Memory decay
  await prisma.$executeRaw`
    DELETE FROM memory_bank
    WHERE world_year IS NOT NULL
      AND person_id IN (SELECT id FROM persons WHERE world_id = ${worldId}::uuid)
      AND (${newYear}::int - world_year) > (magnitude * 20 + 3)::int
  `;

  // 4. Trauma decay
  await prisma.$executeRaw`
    UPDATE persons SET trauma_score = GREATEST(0, trauma_score * ${TRAUMA_ANNUAL_DECAY})
    WHERE world_id = ${worldId}::uuid AND trauma_score > 0
  `;

  // 5. Reload living after deaths
  const surviving = await prisma.person.findMany({
    where:  { world_id: worldId, current_health: { gt: 0 } },
    select: { id: true, name: true, age: true, money: true, job_id: true, traits: true, global_scores: true, current_health: true, trauma_score: true, relationship_status: true, criminal_record: true },
  }) as LivingPerson[];

  const personSnaps = new Map<string, PersonSnapshot>();
  for (const p of surviving) {
    personSnaps.set(p.id, {
      id:             p.id,
      traits:         (p.traits        ?? {}) as Record<string, number>,
      global_scores:  (p.global_scores ?? {}) as Record<string, number>,
      current_health: p.current_health,
    });
  }

  const groups = await loadActiveGroups(prisma);
  const memberships = await loadMembershipIndex(prisma);

  // 6. Membership drop-off
  await runMembershipDropoff(prisma, personSnaps, groups);

  // 7. Faction splits
  await prisma.$transaction(async (tx) =>
    runFactionSplitCheck(tx, personSnaps, newYear, worldId),
  );

  // 8. Relationship decay
  await decayAndPruneForWorld(worldId);

  // 9. Agentic turn
  const allLinks = await prisma.innerCircleLink.findMany({
    where:  { owner_id: { in: surviving.map(p => p.id) } },
    select: { owner_id: true, target_id: true, bond_strength: true, relation_type: true },
  });
  const agentLinksOf = new Map<string, OwnedEdge[]>();
  for (const l of allLinks) {
    const arr = agentLinksOf.get(l.owner_id) ?? [];
    arr.push({ target_id: l.target_id, bond_strength: l.bond_strength, relation_type: l.relation_type as OwnedEdge['relation_type'] });
    agentLinksOf.set(l.owner_id, arr);
  }

  const agentSnapshots: AgentPersonSnapshot[] = surviving.map(p => ({
    id: p.id, name: p.name, age: p.age,
    traits:              (p.traits ?? {}) as Record<string, number>,
    money:               p.money,
    relationship_status: p.relationship_status,
    criminal_record:     (p.criminal_record as unknown as CriminalRecord[]) ?? [],
  }));

  const rulesetRow = await prisma.ruleset.findFirst({ where: { is_active: true } });
  if (rulesetRow) {
    const rules = rulesetRow.rules as unknown as RulesetDef;
    const effectiveTk = effectiveTick(world.year_count + 1, 0); // after year advance
    await withTiming(timings, 'agenticTurn', () =>
      prisma.$transaction(async (tx) =>
        runAgenticTurn(tx, agentSnapshots, agentLinksOf, newYear, worldId, {
          startedTick:            effectiveTk,
          pregnancyDurationTicks: PREGNANCY_DURATION_TICKS,
          conceive:               rules.capability_gates?.agentic_conceive,
        }),
      ),
    );
  }

  // 10. Occupation income
  await applyOccupationIncome(worldId, world.market_index);

  // 11. Religion conversion pass
  await prisma.$transaction(async (tx) =>
    runReligionConversionPass(tx, [...personSnaps.values()], groups.religions, memberships, newYear),
  );

  // 11b. Leader extraction — Phase 5
  await withTiming(timings, 'extractLeaderCuts', () =>
    prisma.$transaction(async (tx) => {
      await extractLeaderCuts(tx, worldId);
    }),
  );

  // 12. Yearly report
  const endPop = await prisma.person.count({ where: { world_id: worldId, current_health: { gt: 0 } } });
  const freshWorld = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });

  const existing = await prisma.yearlyReport.findUnique({
    where: { world_id_year: { world_id: worldId, year: newYear - 1 } },
  });
  if (!existing) {
    await prisma.yearlyReport.create({
      data: {
        world_id:          worldId,
        year:              newYear - 1,
        population_start:  endPop + naturalDeaths,
        population_end:    endPop,
        births:            0,
        deaths:            naturalDeaths,
        deaths_by_cause:   { old_age: naturalDeaths },
        market_index_start: freshWorld.market_index,
        market_index_end:   freshWorld.market_index,
        force_scores:       (freshWorld.global_traits as object),
      },
    });
  }
}

// ── pg-boss worker ─────────────────────────────────────────────
// Registered in index.ts via boss.work('advance_year', processYearJob).
// Called by pg-boss when a job is dequeued.

type YearJobData = { world_id: string; year_run_id: string };

export async function processYearJob(jobs: Job<YearJobData>[]): Promise<void> {
  // localConcurrency=1 so we always get exactly one job, but pg-boss passes an array
  const job  = jobs[0];
  if (!job) return;
  const { world_id, year_run_id } = job.data;
  const timings: PhaseTimings = {};

  try {
    const world = await prisma.world.findUniqueOrThrow({ where: { id: world_id } });

    // ── Bi-annual A ───────────────────────────────────────────
    await updateYearRun(year_run_id, 'bi_annual_a', 5);
    const tickA = effectiveTick(world.year_count, 0);
    await runBiAnnualPhase(world_id, tickA, world.current_year, year_run_id, timings);
    await prisma.world.update({ where: { id: world_id }, data: { bi_annual_index: 1 } });
    await writeSnapshot(world_id, world.current_year, 1);
    await updateYearRun(year_run_id, 'bi_annual_a', 33, 'running', 'Bi-annual A complete');

    // ── Bi-annual B ───────────────────────────────────────────
    await updateYearRun(year_run_id, 'bi_annual_b', 38);
    const tickB = effectiveTick(world.year_count, 1);
    await runBiAnnualPhase(world_id, tickB, world.current_year, year_run_id, timings);
    // bi_annual_index stays at 1 until year-end advances it back to 0
    await writeSnapshot(world_id, world.current_year, 1);
    await updateYearRun(year_run_id, 'bi_annual_b', 66, 'running', 'Bi-annual B complete');

    // ── Year-end ──────────────────────────────────────────────
    await updateYearRun(year_run_id, 'year_end', 70);
    const newYear = world.current_year + 1;
    await runYearEndPhase(world_id, newYear, year_run_id, timings);

    // Advance the year counter
    await prisma.world.update({
      where: { id: world_id },
      data:  { current_year: newYear, year_count: world.year_count + 1, bi_annual_index: 0 },
    });
    await writeSnapshot(world_id, newYear, 0);

    // ── Done ──────────────────────────────────────────────────
    await prisma.yearRun.update({
      where: { id: year_run_id },
      data:  { status: 'completed', phase: 'completed', progress_pct: 100, completed_at: new Date() },
    });
    yearRunBus.emit(year_run_id, { year_run_id, phase: 'completed', progress_pct: 100, status: 'completed' } satisfies YearRunUpdate);

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.yearRun.update({
      where: { id: year_run_id },
      data:  { status: 'failed', phase: 'failed', error: msg, completed_at: new Date() },
    }).catch(() => {/* swallow — DB may be unavailable */});
    yearRunBus.emit(year_run_id, { year_run_id, phase: 'failed', progress_pct: 0, status: 'failed', message: msg } satisfies YearRunUpdate);
    throw err; // pg-boss will mark the job failed / retry
  }
}

// ── Public helpers consumed by the route ─────────────────────

/** Returns the running year_run for a world, or null. */
export async function getRunningYearRun(worldId: string) {
  return prisma.yearRun.findFirst({
    where:   { world_id: worldId, status: 'running' },
    orderBy: { started_at: 'desc' },
  });
}

/** Returns a year_run by id (any status). */
export async function getYearRun(yearRunId: string) {
  return prisma.yearRun.findUnique({ where: { id: yearRunId } });
}
