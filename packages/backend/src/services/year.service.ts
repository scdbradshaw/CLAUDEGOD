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
  JOB_BY_ID,
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
  const [
    world,
    personDetails,
    religionRows,
    factionRows,
    activeEvents,
    recentDeaths,
    infectionCounts,
    mostConnectedRow,
    activeRuleset,
  ] = await Promise.all([
    prisma.world.findUniqueOrThrow({ where: { id: worldId } }),
    // Phase 6 extended — one pass pulls every stat we need for the dashboard.
    prisma.person.findMany({
      where:  { world_id: worldId, current_health: { gt: 0 } },
      select: {
        id: true, name: true, age: true, money: true, job_id: true,
        happiness: true, trauma_score: true, moral_score: true, current_health: true,
      },
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
    // Most-connected person (by outgoing inner-circle link count).
    prisma.$queryRaw<{ owner_id: string; cnt: number }[]>`
      SELECT l.owner_id, COUNT(*)::int AS cnt
      FROM inner_circle_links l
      JOIN persons p ON p.id = l.owner_id
      WHERE p.world_id = ${worldId}::uuid AND p.current_health > 0
      GROUP BY l.owner_id
      ORDER BY cnt DESC
      LIMIT 1
    `,
    prisma.ruleset.findFirst({ where: { is_active: true }, select: { id: true, name: true } }),
  ]);

  const population = personDetails.length;

  // ── Averages (computed in JS from the findMany to avoid a second query) ──
  let sumHealth = 0, sumHappiness = 0, sumMoney = 0;
  for (const p of personDetails) { sumHealth += p.current_health; sumHappiness += p.happiness; sumMoney += p.money; }
  const avgHealth    = population > 0 ? Math.round(sumHealth    / population) : 0;
  const avgHappiness = population > 0 ? Math.round(sumHappiness / population) : 0;
  const avgMoney     = population > 0 ? Math.round(sumMoney     / population) : 0;

  // ── Wealth distribution ────────────────────────────────────
  const sortedByMoney = [...personDetails].sort((a, b) => a.money - b.money);
  let median = 0;
  if (population > 0) {
    median = population % 2
      ? sortedByMoney[(population - 1) >> 1].money
      : Math.round((sortedByMoney[population / 2 - 1].money + sortedByMoney[population / 2].money) / 2);
  }
  // Gini coefficient: 0 = perfect equality, 1 = one person holds everything.
  // Standard formula on sorted ascending: G = Σ(2i − n − 1)·xᵢ / (n · Σxᵢ)
  let gini = 0;
  if (population > 0 && sumMoney > 0) {
    let cum = 0;
    for (let i = 0; i < population; i++) {
      cum += (2 * (i + 1) - population - 1) * Math.max(0, sortedByMoney[i].money);
    }
    gini = Math.max(0, Math.min(1, cum / (population * sumMoney)));
  }
  const top1pctCount = population > 0 ? Math.max(1, Math.floor(population * 0.01)) : 0;
  const top1pctSum   = sortedByMoney.slice(population - top1pctCount).reduce((s, p) => s + p.money, 0);
  const top1pctShare = sumMoney > 0 ? top1pctSum / sumMoney : 0;
  const richestRow   = population > 0 ? sortedByMoney[population - 1] : null;

  // ── Employment + avg job pay ───────────────────────────────
  let employedCount = 0;
  let totalJobPay   = 0;
  for (const p of personDetails) {
    if (!p.job_id) continue;
    const job = JOB_BY_ID.get(p.job_id);
    if (!job) continue;
    employedCount++;
    totalJobPay += job.base_pay;
  }
  const employedPct = population > 0 ? employedCount / population : 0;
  const avgJobPay   = employedCount > 0 ? Math.round(totalJobPay / employedCount) : 0;

  // ── Age distribution (user-specified buckets) + oldest ─────
  const buckets = [
    { label: '0–12',  min: 0,  max: 12,  count: 0 },
    { label: '13–20', min: 13, max: 20,  count: 0 },
    { label: '21–35', min: 21, max: 35,  count: 0 },
    { label: '36–50', min: 36, max: 50,  count: 0 },
    { label: '51–65', min: 51, max: 65,  count: 0 },
    { label: '65+',   min: 66, max: 999, count: 0 },
  ];
  let oldestP: typeof personDetails[0] | null = null;
  let newbornCount = 0;
  for (const p of personDetails) {
    if (p.age <= 12)      buckets[0].count++;
    else if (p.age <= 20) buckets[1].count++;
    else if (p.age <= 35) buckets[2].count++;
    else if (p.age <= 50) buckets[3].count++;
    else if (p.age <= 65) buckets[4].count++;
    else                  buckets[5].count++;
    if (p.age === 0) newbornCount++;
    if (!oldestP || p.age > oldestP.age) oldestP = p;
  }

  // ── Top people (vanity leaderboards) ───────────────────────
  // Single pass picks a winner for every axis. O(N) with no intermediate sorts.
  let maxMoneyP: typeof personDetails[0] | null = null;
  let maxTraumaP: typeof personDetails[0] | null = null;
  let maxMoralP: typeof personDetails[0] | null = null;
  let minMoralP: typeof personDetails[0] | null = null;
  let maxHappyP: typeof personDetails[0] | null = null;
  let minHappyP: typeof personDetails[0] | null = null;
  for (const p of personDetails) {
    if (!maxMoneyP  || p.money        > maxMoneyP.money)         maxMoneyP  = p;
    if (!maxTraumaP || p.trauma_score > maxTraumaP.trauma_score) maxTraumaP = p;
    if (!maxMoralP  || p.moral_score  > maxMoralP.moral_score)   maxMoralP  = p;
    if (!minMoralP  || p.moral_score  < minMoralP.moral_score)   minMoralP  = p;
    if (!maxHappyP  || p.happiness    > maxHappyP.happiness)     maxHappyP  = p;
    if (!minHappyP  || p.happiness    < minHappyP.happiness)     minHappyP  = p;
  }
  const nameById = new Map(personDetails.map(p => [p.id, p.name]));
  const topConnected = mostConnectedRow[0]
    ? { id: mostConnectedRow[0].owner_id, name: nameById.get(mostConnectedRow[0].owner_id) ?? '—', value: Number(mostConnectedRow[0].cnt) }
    : null;

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
      health:    avgHealth,
      happiness: avgHappiness,
      money:     avgMoney,
    },
    // ── Phase 6 extended — dashboard stats ─────────────
    wealth: {
      median,
      gini:           Math.round(gini * 1000) / 1000,
      top_1pct_share: Math.round(top1pctShare * 1000) / 1000,
      richest:        richestRow ? { id: richestRow.id, name: richestRow.name, money: richestRow.money } : null,
    },
    employment: {
      employed_count:   employedCount,
      unemployed_count: population - employedCount,
      employed_pct:     Math.round(employedPct * 1000) / 1000,
      avg_job_pay:      avgJobPay,
    },
    age_distribution: {
      buckets,
      oldest:        oldestP ? { id: oldestP.id, name: oldestP.name, age: oldestP.age } : null,
      newborn_count: newbornCount,
    },
    top_people: {
      richest:          maxMoneyP  ? { id: maxMoneyP.id,  name: maxMoneyP.name,  value: maxMoneyP.money }                     : null,
      oldest:           oldestP    ? { id: oldestP.id,    name: oldestP.name,    value: oldestP.age }                         : null,
      most_connected:   topConnected,
      most_traumatized: maxTraumaP ? { id: maxTraumaP.id, name: maxTraumaP.name, value: Math.round(maxTraumaP.trauma_score) } : null,
      most_virtuous:    maxMoralP  ? { id: maxMoralP.id,  name: maxMoralP.name,  value: maxMoralP.moral_score }               : null,
      most_corrupt:     minMoralP  ? { id: minMoralP.id,  name: minMoralP.name,  value: minMoralP.moral_score }               : null,
      happiest:         maxHappyP  ? { id: maxHappyP.id,  name: maxHappyP.name,  value: maxHappyP.happiness }                 : null,
      saddest:          minHappyP  ? { id: minHappyP.id,  name: minHappyP.name,  value: minHappyP.happiness }                 : null,
    },
    ruleset: {
      id:   activeRuleset?.id   ?? null,
      name: activeRuleset?.name ?? null,
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
  // Ruleset is optional — without one, the interactions phase is skipped but
  // economy, market, events, births, and aging all run as normal.

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

  // 5. Resolve interactions — skipped when no ruleset is active.
  const phaseResult = rulesetRow
    ? await withTiming(timings, 'resolveInteractions', () =>
        resolveInteractionsPhase({
          prisma,
          rules: rulesetRow.rules as unknown as RulesetDef,
          living,
          byId,
          linksOf,
          personSnaps,
          groups,
          memberships,
          globalTraits: EMPTY_GLOBAL_TRAITS,
          traitMults:   EMPTY_TRAIT_MULTS,
        }),
      )
    : null;
  const traitDeltas              = phaseResult?.traitDeltas              ?? {};
  const pendingMemories          = phaseResult?.pendingMemories          ?? [];
  const pendingJoinsByKey        = phaseResult?.pendingJoinsByKey        ?? new Map();
  const pendingSpawnsByFounder   = phaseResult?.pendingSpawnsByFounder   ?? new Map();
  const pendingPregnanciesByPair = phaseResult?.pendingPregnanciesByPair ?? new Map();

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
      (world as any).job_income_multiplier ?? 1,
      (world as any).col_pct ?? 0.30,
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

  // 14. Market update — capture output and persist new indices + history + highlights
  const freshWorld = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
  const history    = (freshWorld.market_history as unknown as MarketHistoryEntry[]) ?? [];
  const marketResult = await withTiming(timings, 'updateMarket', () =>
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
  await prisma.world.update({
    where: { id: worldId },
    data: {
      market_stable_index:   marketResult.stable.newIndex,
      market_index:          marketResult.standard.newIndex,
      market_volatile_index: marketResult.volatile.newIndex,
      market_history:        marketResult.marketHistory as unknown as Prisma.InputJsonValue,
      market_highlights:     marketResult.highlights   as unknown as Prisma.InputJsonValue,
    },
  });
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
