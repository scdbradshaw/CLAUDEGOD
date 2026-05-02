// Year-advance service (Phase 3).
//
// Phase 3 is the *shell* — `runYearPhase` only increments `World.current_year`.
// Phases 4–11 will plug in interactions, bucket dynamics, events, etc., per
// DESIGN.md §15.3.
//
// Single-flight per world: at most one YearRun in (pending|running) at a
// time. A second `enqueueYearAdvance` while one is active returns the
// existing run id instead of creating a duplicate.

import { Prisma, type PrismaClient, type YearRun } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';
import { ensureQueue, startBoss, YEAR_ADVANCE_QUEUE } from '../lib/queue';
import { randomSeedRoot } from '../lib/rng';
import { makeYearRng } from '../engine/rng-context';
import {
  runBucketDynamics,
  type BucketState,
} from '../engine/bucket-dynamics';
import { rollRealDeaths } from '../engine/real-deaths';
import { planChurn } from '../engine/churn';
import { archiveAndDeleteTx, materializeFromBucketTx } from './person.service';
import { pruneExpiredStateTags, addStateTag } from '../engine/state-tags';
import { addMemory } from '../engine/memory';
import { runDecadeCompressionTx } from './memory.service';
import {
  handleLeaderDeathTx,
  runGroupLifecyclePhaseTx,
} from './group.service';
import {
  evaluateCascadesTx,
  pushStateHistoryTx,
  tickActiveEventsTx,
} from './event.service';
import { runAgenticPhaseTx } from './action.service';
import { runRealPersonEconomyPhaseTx } from './economy.service';
import { runFactionAwardsTx } from './faction-awards.service';
import { runYearEndInvariants } from '../engine/invariants';
import { runInteractionsPhaseTx } from './interaction.service';
import {
  computeDefenseRating,
  type DefensePopulation,
} from '../engine/civic-defense';
import type { ActiveEventTags, GroupForDues } from '../engine/economy';
import type { PersonType } from '@claude-god/shared';
import type { MarketSignalsEntry, Memory, StateTagEntry } from '@claude-god/shared';
import { Stopwatch, type StepTiming } from '../lib/stopwatch';

export interface EnqueueYearAdvanceInput {
  world_id: string;
  /** Optional supplied seed (replay). Otherwise generated. */
  random_seed?: bigint;
}

export type EnqueueYearAdvanceResult =
  | { status: 'enqueued'; run: YearRun }
  | { status: 'already_active'; run: YearRun };

/**
 * Create a YearRun for the next year and enqueue a pg-boss job. Single-flight
 * guard: if there's already a pending|running run for this world, returns
 * `already_active` with that existing run.
 */
export async function enqueueYearAdvance(
  input: EnqueueYearAdvanceInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<EnqueueYearAdvanceResult> {
  const result = await prisma.$transaction(async (tx) => {
    // Single-flight check
    const active = await tx.yearRun.findFirst({
      where: { world_id: input.world_id, status: { in: ['pending', 'running'] } },
      orderBy: { year: 'desc' },
    });
    if (active) return { status: 'already_active' as const, run: active };

    const world = await tx.world.findUnique({ where: { id: input.world_id } });
    if (!world) throw new Error('world_not_found');

    const targetYear = world.current_year + 1;

    // A prior attempt for this same target year may have failed (the outer tx
    // rolled back current_year, but markYearRunFailed left a row at status
    // 'failed'). Clear it so the retry doesn't trip the (world_id, year)
    // unique constraint.
    await tx.yearRun.deleteMany({
      where: { world_id: world.id, year: targetYear, status: 'failed' },
    });

    const run = await tx.yearRun.create({
      data: {
        world_id: world.id,
        year: targetYear,
        random_seed: input.random_seed ?? randomSeedRoot(),
        status: 'pending',
      },
    });
    return { status: 'enqueued' as const, run };
  });

  if (result.status === 'enqueued') {
    await ensureQueue(YEAR_ADVANCE_QUEUE);
    const boss = await startBoss();
    await boss.send(YEAR_ADVANCE_QUEUE, { year_run_id: result.run.id });
  }
  return result;
}

/**
 * The year-phase pipeline. Phase 3 shell: increments world.current_year by 1
 * and updates the YearRun row. Future phases will replace the body with the
 * full §15.3 step list.
 *
 * Idempotency: re-running for the same YearRun is a no-op once status is
 * `completed`. Workers should still avoid duplicate work, but if pg-boss
 * retries, this guard keeps the year from double-advancing.
 */
export async function runYearPhase(
  yearRunId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ year: number; world_id: string; timings: StepTiming[] }> {
  const sw = new Stopwatch();
  return prisma.$transaction(async (tx) => {
    const run = await tx.yearRun.findUnique({ where: { id: yearRunId } });
    if (!run) throw new Error('year_run_not_found');
    if (run.status === 'completed') {
      return { year: run.year, world_id: run.world_id, timings: sw.result() };
    }
    if (run.status === 'failed') {
      throw new Error('year_run_failed_previously');
    }

    await tx.yearRun.update({
      where: { id: yearRunId },
      data: { status: 'running', started_at: new Date() },
    });

    // ── Phase 4: bucket dynamics + market + births/deaths + drift ──────────
    sw.tick('setup');
    const world = await tx.world.findUnique({
      where: { id: run.world_id },
      include: { cities: { include: { buckets: true } } },
    });
    if (!world) throw new Error('world_not_found');
    if (world.current_year + 1 !== run.year) {
      throw new Error(
        `year_mismatch: world at year ${world.current_year}, run targets ${run.year}`,
      );
    }

    // v1: single city per world (DESIGN.md §3 / CITY_SEED_COUNT = 1).
    const city = world.cities[0];
    if (!city) throw new Error('world_has_no_city');

    const yearRng = makeYearRng(run.random_seed, world.id, run.year);

    // ── Phase 13a.5: §15.3 step 1 — social interactions among real persons. ──
    // Runs before bucket dynamics + economy so memory entries land first and
    // any mid-year cascade triggers see them. Wealth transfers from gifts
    // settle into income reads downstream.
    await runInteractionsPhaseTx(world.id, run.year, yearRng, tx);
    sw.tick('interactions');

    // §6.3 — load active groups for dues math (bucket-side here; real-member
    // dues run after bucket-dynamics in runRealPersonEconomyPhaseTx).
    const groupRows = await tx.group.findMany({
      where: { world_id: world.id, is_active: true },
      select: {
        id: true,
        kind: true,
        cost_per_year: true,
        cost_pct_of_wealth: true,
        is_active: true,
        member_count_cached: true,
      },
    });
    const groups: GroupForDues[] = groupRows.map((g) => ({
      id: g.id,
      kind: g.kind,
      cost_per_year: g.cost_per_year,
      cost_pct_of_wealth: g.cost_pct_of_wealth,
      is_active: g.is_active,
      member_count_cached: g.member_count_cached,
    }));

    // §6.4 v2 — read active events once for the market step (food/drought/
    // bountiful affect farmer output) AND for the §6.1 income modifiers below.
    // boom is derived after runBucketDynamics from the new market_index.
    const activeEvents = await tx.worldEvent.findMany({
      where: { world_id: world.id, ended_year: null },
      select: { event_def_id: true },
    });
    const eventsForMarket: ActiveEventTags = {
      war: activeEvents.some((e) => e.event_def_id === 'FactionWar'),
      plague: activeEvents.some((e) => e.event_def_id === 'Plague'),
      famine: activeEvents.some((e) => e.event_def_id === 'Famine'),
      drought: activeEvents.some((e) => e.event_def_id === 'Drought'),
      bountiful: activeEvents.some((e) => e.event_def_id === 'BountifulHarvest'),
      boom: false, // re-derived after runBucketDynamics from new market_index
    };

    // §19 two-tier accounting: count alive real persons per type so bucket
    // dynamics deaths only apply to the aggregate-NPC slice of each bucket.
    const realPersonRows = await tx.person.groupBy({
      by: ['type'],
      where: { world_id: world.id, city_id: city.id, is_alive: true },
      _count: { id: true },
    });
    const realPersonCounts: Record<string, number> = {};
    for (const r of realPersonRows) {
      realPersonCounts[r.type] = r._count.id;
    }

    const result = runBucketDynamics({
      world: { market_index: world.market_index, market_trend: world.market_trend },
      city: {
        treasury: city.treasury,
        tax_rate: city.tax_rate,
        region_resource: city.region_resource,
      },
      buckets: city.buckets.map(
        (b): BucketState => ({
          type: b.type,
          count: b.count,
          avg_age: b.avg_age,
          birth_rate: b.birth_rate,
          death_rate: b.death_rate,
          avg_wealth: b.avg_wealth,
          avg_intelligence: b.avg_intelligence,
          avg_combat: b.avg_combat,
          avg_health: b.avg_health,
          avg_happiness: b.avg_happiness,
          avg_sexuality: b.avg_sexuality,
          faction_shares: (b.faction_shares ?? {}) as Record<string, number>,
          religion_shares: (b.religion_shares ?? {}) as Record<string, number>,
        }),
      ),
      rng: yearRng,
      groups,
      active_events: eventsForMarket,
      real_person_counts: realPersonCounts,
    });

    sw.tick('bucket_dynamics');

    // Persist the snapshot.
    // Append to World.market_index_history (cap 100). 3-decimal precision
    // is plenty for the chart and keeps the JSON column compact.
    const priorHistory = (Array.isArray(world.market_index_history)
      ? world.market_index_history
      : []) as Array<{ year: number; index: number }>;
    const nextMarketHistory = [
      ...priorHistory,
      { year: run.year, index: Math.round(result.world.market_index * 1000) / 1000 },
    ].slice(-100);

    // §6.4 v2 — append the class-signals entry so the Market page can chart
    // food ratio, the four deltas, and per-class population/wealth over time.
    const priorSignals = (Array.isArray(world.market_signals_history)
      ? world.market_signals_history
      : []) as unknown as MarketSignalsEntry[];
    const nextSignalsHistory = [
      ...priorSignals,
      buildMarketSignalsEntry(run.year, result.diagnostics, result.buckets),
    ].slice(-100);

    await tx.world.update({
      where: { id: world.id },
      data: {
        current_year: run.year,
        market_index: result.world.market_index,
        market_index_history: nextMarketHistory as unknown as object,
        market_signals_history: nextSignalsHistory as unknown as object,
      },
    });
    // Civic defense (role-power): working class + soldier contribute a flat
    // per-capita share to city.defense_rating, capped at 100. Computed across
    // bucket aggregate + real persons so both populations defend the city.
    const defensePopulations: DefensePopulation[] = result.buckets.map((b) => ({
      type: b.type as PersonType,
      total_count: b.count + (realPersonCounts[b.type] ?? 0),
    }));
    const nextDefenseRating = computeDefenseRating(defensePopulations);

    await tx.city.update({
      where: { id: city.id },
      data: {
        treasury: result.city.treasury,
        defense_rating: nextDefenseRating,
        // Snapshot rollups (per §13). Recompute from the new bucket state.
        population_total: result.buckets.reduce((s, b) => s + b.count, 0),
        avg_wealth: snapshotAvgWealth(result.buckets),
        mood_score: snapshotMoodScore(result.buckets),
      },
    });
    for (const b of result.buckets) {
      await tx.bucket.update({
        where: { city_id_type: { city_id: city.id, type: b.type } },
        data: {
          count: b.count,
          avg_wealth: b.avg_wealth,
          avg_intelligence: b.avg_intelligence,
          avg_combat: b.avg_combat,
          avg_health: b.avg_health,
          avg_happiness: b.avg_happiness,
          avg_sexuality: b.avg_sexuality,
          avg_age: b.avg_age,
        },
      });
    }
    // ────────────────────────────────────────────────────────────────────────

    // ── Phase 10: real-person economy — income, dues, investment ────────────
    // Reuse activeEvents read above; derive boom from the new market_index.
    const activeEventTags: ActiveEventTags = {
      ...eventsForMarket,
      boom: result.world.market_index >= 1.6,
    };
    const economyResult = await runRealPersonEconomyPhaseTx(
      {
        world_id: world.id,
        year: run.year,
        prev_index: result.diagnostics.market_index_before,
        next_index: result.diagnostics.market_index_after,
        active_events: activeEventTags,
        bucket_dues_by_group: result.bucket_dues_by_group,
        city_id: city.id,
        tax_collected: result.diagnostics.tax_collected,
      },
      tx,
    );

    // Faction year-end awards: leader cut + top-3 prizes from this year's
    // dues intake. Runs immediately after dues are credited so treasury
    // covers payouts. Religions are skipped (they aren't competitions).
    await runFactionAwardsTx(
      world.id,
      run.year,
      economyResult.dues_by_group_this_year,
      tx,
    );
    sw.tick('economy');
    // ────────────────────────────────────────────────────────────────────────

    // ── Phase 5/6: real-person aging + deaths + churn ──────────────────────
    // 0. Age++ for all alive real persons (Phase 6).
    await tx.person.updateMany({
      where: { world_id: world.id, is_alive: true },
      data: { age: { increment: 1 } },
    });

    const alivePersons = await tx.person.findMany({
      where: { world_id: world.id, is_alive: true },
      select: {
        id: true,
        age: true,
        current_health: true,
        is_pinned: true,
        last_event_year: true,
        created_year: true,
        spouse_id: true,
        mother_id: true,
        father_id: true,
        name: true,
      },
    });

    // 1. Roll real-person deaths.
    const deathRoll = rollRealDeaths(
      alivePersons.map((p) => ({
        id: p.id,
        age: p.age,
        current_health: p.current_health,
      })),
      yearRng,
    );

    // Pre-build a death lookup so we can compute kin grief before deletes.
    const decedentMap = new Map(
      deathRoll.deaths.map((d) => {
        const p = alivePersons.find((x) => x.id === d.id);
        return [d.id, { id: d.id, name: p?.name ?? 'someone' }];
      }),
    );
    // For each surviving kin (spouse/mother/father pointing at a decedent),
    // apply `grieving` + write a memory entry. Bulk: collect grievers, fetch
    // their state_tags + recent_memories in one query, mutate in JS, flush
    // with a single bulk UPDATE FROM VALUES.
    const griefMap = new Map<
      string,
      Array<{ id: string; relation: 'spouse' | 'mother' | 'father' }>
    >();
    for (const survivor of alivePersons) {
      if (decedentMap.has(survivor.id)) continue;
      const lostKin: Array<{ id: string; relation: 'spouse' | 'mother' | 'father' }> = [];
      if (survivor.spouse_id && decedentMap.has(survivor.spouse_id)) {
        lostKin.push({ id: survivor.spouse_id, relation: 'spouse' });
      }
      if (survivor.mother_id && decedentMap.has(survivor.mother_id)) {
        lostKin.push({ id: survivor.mother_id, relation: 'mother' });
      }
      if (survivor.father_id && decedentMap.has(survivor.father_id)) {
        lostKin.push({ id: survivor.father_id, relation: 'father' });
      }
      if (lostKin.length === 0) continue;
      griefMap.set(survivor.id, lostKin);
    }
    if (griefMap.size > 0) {
      await applyKinGriefBulk(tx, griefMap, decedentMap, run.year);
    }

    for (const d of deathRoll.deaths) {
      // Phase 7: if the decedent led a group, elect a successor (or dissolve).
      // Must run BEFORE archiveAndDeleteTx since handleLeaderDeathTx reads the
      // Group.leader_id pointer that still references this Person row.
      await handleLeaderDeathTx(d.id, run.year, tx);
      await archiveAndDeleteTx(
        { person_id: d.id, reason: 'death', year: run.year, death_cause: d.cause },
        tx,
      );
    }
    sw.tick('deaths');

    // 2. Plan + apply churn (demotions + promotions). Use bucket counts that
    //    reflect the real-deaths just applied.
    const survivorMap = new Map(alivePersons.map((p) => [p.id, p]));
    for (const d of deathRoll.deaths) survivorMap.delete(d.id);
    const survivors = [...survivorMap.values()];

    const refreshedBuckets = await tx.bucket.findMany({
      where: { city_id: city.id },
      select: { city_id: true, type: true, count: true, avg_wealth: true },
    });
    const churn = planChurn({
      persons: survivors.map((p) => ({
        id: p.id,
        is_pinned: p.is_pinned,
        last_event_year: p.last_event_year,
        created_year: p.created_year,
      })),
      buckets: refreshedBuckets,
      year: run.year,
      rng: yearRng,
    });

    for (const id of churn.demotion_ids) {
      await archiveAndDeleteTx(
        { person_id: id, reason: 'demoted', year: run.year },
        tx,
      );
    }

    // §19 two-tier accounting: only promote when there is aggregate capacity
    // (bucket.count > real_person_count_for_type). Without this gate,
    // pickPromotions (with-replacement) can generate more promotion picks
    // than the aggregate pool supports. Those new real persons then die in
    // events/agentic later in the pipeline, decrementing count past zero.
    //
    // Fetch real-person counts once after demotions; track in-memory as we
    // promote so we avoid an extra DB round-trip per pick.
    const realCountByTypeRows = await tx.person.groupBy({
      by: ['type'],
      where: { world_id: world.id, city_id: city.id, is_alive: true },
      _count: { id: true },
    });
    const liveRealByType: Record<string, number> = {};
    for (const r of realCountByTypeRows) liveRealByType[r.type] = r._count.id;

    for (const pick of churn.promotion_picks) {
      // Skip if no aggregate NPCs remain for this type.
      const bucketRow = refreshedBuckets.find((b) => b.type === pick.type);
      const currentReal = liveRealByType[pick.type] ?? 0;
      if (!bucketRow || bucketRow.count <= currentReal) continue;

      try {
        await materializeFromBucketTx(
          {
            world_id: world.id,
            city_id: pick.city_id,
            type: pick.type,
            year: run.year,
            rng: yearRng,
          },
          tx,
        );
        liveRealByType[pick.type] = currentReal + 1;
      } catch (err) {
        // Cap-overflow can race past the planner's reservation; skip cleanly.
        if (err instanceof Error && err.message === 'real_person_cap_reached') continue;
        throw err;
      }
    }
    sw.tick('churn');

    // 3. Year-end state-tag prune (drop expired entries).
    await pruneAllStateTags(tx, world.id, run.year);
    sw.tick('state_tags');

    // 4. Decade compression for any person whose new age is a multiple of 10.
    await runDecadeCompressionTx(world.id, run.year, tx);
    sw.tick('decade_compression');

    // 5. Phase 8 step 7: tick active events (apply modifiers + target rules +
    //    end-condition evaluation). Must run before cascades so just-resolved
    //    slots free up first.
    await tickActiveEventsTx(world.id, run.year, yearRng, tx);
    sw.tick('events_tick');

    // 6. Phase 8 step 8: cascade-trigger evaluation. Reads state_history
    //    (populated at end of *previous* year) + per-key cooldowns from
    //    archived WorldEvents.
    await evaluateCascadesTx(world.id, run.year, yearRng, tx);
    sw.tick('cascades');

    // 7. Phase 7 step 9: group lifecycle (membership drift, switching,
    //    schism, dissolution). Per §15.3 must sit after cascades.
    await runGroupLifecyclePhaseTx(world.id, run.year, tx);
    sw.tick('group_lifecycle');

    // 8. Phase 9 step 10: agentic actions (queued first, then engine-rolled).
    //    Mutates state immediately within tx so subsequent intents see
    //    updated state (§11.5).
    await runAgenticPhaseTx(world.id, run.year, yearRng, tx);
    sw.tick('agentic');

    // 9. Phase 8 tail: push this year's snapshot into World.state_history so
    //    next year's cascade evaluation sees it.
    await pushStateHistoryTx(world.id, run.year, tx, {
      food_ratio: result.diagnostics.food_ratio,
    });
    sw.tick('state_history');
    // ────────────────────────────────────────────────────────────────────────

    // ── Phase 13a.4: always-on invariants suite (§20.1). ──────────────────
    // Throws InvariantViolationError on violation → outer tx rolls back →
    // SSE worker emits `failed`. Wealth-conservation is skipped in
    // production (wealth_at_start=0) because plague/death destroys
    // bucket-aggregated wealth by design; tolerance would have to absorb
    // arbitrary event mods. The other four rules cover all real bugs.
    await runYearEndInvariants(
      { world_id: world.id, wealth_at_start: 0, wealth_tolerance: 0 },
      tx,
    );
    sw.tick('invariants');

    const timings = sw.result();
    await tx.yearRun.update({
      where: { id: yearRunId },
      data: {
        status: 'completed',
        completed_at: new Date(),
        log: { timings } as unknown as object,
      },
    });
    return { year: run.year, world_id: world.id, timings };
  }, { timeout: 60_000, maxWait: 10_000 });
}

export async function markYearRunFailed(
  yearRunId: string,
  message: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<void> {
  await prisma.yearRun.update({
    where: { id: yearRunId },
    data: {
      status: 'failed',
      completed_at: new Date(),
      error_message: message.slice(0, 1000),
    },
  });
}

export async function getYearRun(
  id: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<YearRun | null> {
  return prisma.yearRun.findUnique({ where: { id } });
}

// ─── Phase 6 helpers ────────────────────────────────────────────────────────

type TxClient = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

async function applyKinGriefBulk(
  tx: TxClient,
  griefMap: Map<string, Array<{ id: string; relation: 'spouse' | 'mother' | 'father' }>>,
  decedentMap: Map<string, { id: string; name: string }>,
  year: number,
): Promise<void> {
  const survivorIds = [...griefMap.keys()];
  const survivors = await tx.person.findMany({
    where: { id: { in: survivorIds } },
    select: { id: true, state_tags: true, recent_memories: true },
  });
  const updates: { id: string; tagsJson: string; memJson: string }[] = [];
  for (const s of survivors) {
    const lost = griefMap.get(s.id);
    if (!lost) continue;
    let tags = (Array.isArray(s.state_tags) ? s.state_tags : []) as unknown as StateTagEntry[];
    let memories = (Array.isArray(s.recent_memories) ? s.recent_memories : []) as unknown as Memory[];
    for (const lk of lost) {
      const decedent = decedentMap.get(lk.id);
      if (!decedent) continue;
      tags = addStateTag(tags, 'grieving', year);
      memories = addMemory(memories, {
        year,
        kind: 'kin-death',
        summary: `lost their ${lk.relation} ${decedent.name}`,
        magnitude: lk.relation === 'spouse' ? 0.85 : 0.7,
        counterparty_id: decedent.id,
        tone: 'literary',
      });
    }
    updates.push({
      id: s.id,
      tagsJson: JSON.stringify(tags),
      memJson: JSON.stringify(memories),
    });
  }
  if (updates.length === 0) return;
  const rows = updates.map(
    (u) => Prisma.sql`(${u.id}::text, ${u.tagsJson}::jsonb, ${u.memJson}::jsonb)`,
  );
  await tx.$executeRaw`
    UPDATE "Person" AS p
    SET state_tags = v.tags, recent_memories = v.mem
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, tags, mem)
    WHERE p.id = v.id
  `;
}

async function pruneAllStateTags(
  tx: TxClient,
  worldId: string,
  year: number,
): Promise<void> {
  const persons = await tx.person.findMany({
    where: { world_id: worldId, is_alive: true },
    select: { id: true, state_tags: true },
  });
  const updates: { id: string; tagsJson: string }[] = [];
  for (const p of persons) {
    const tags = (Array.isArray(p.state_tags) ? p.state_tags : []) as unknown as StateTagEntry[];
    if (tags.length === 0) continue;
    const pruned = pruneExpiredStateTags(tags, year);
    if (pruned.length === tags.length) continue;
    updates.push({ id: p.id, tagsJson: JSON.stringify(pruned) });
  }
  if (updates.length === 0) return;
  const rows = updates.map(
    (u) => Prisma.sql`(${u.id}::text, ${u.tagsJson}::jsonb)`,
  );
  await tx.$executeRaw`
    UPDATE "Person" AS p
    SET state_tags = v.tags
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, tags)
    WHERE p.id = v.id
  `;
}

// ─── City snapshot helpers (§13 rollups) ───────────────────────────────────

function snapshotAvgWealth(buckets: BucketState[]): number {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return 0;
  const wealthSum = buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
  return Math.round(wealthSum / total);
}

function snapshotMoodScore(buckets: BucketState[]): number {
  const total = buckets.reduce((s, b) => s + b.count, 0);
  if (total === 0) return 50;
  const moodSum = buckets.reduce((s, b) => s + b.count * b.avg_happiness, 0);
  return Math.round((moodSum / total) * 100) / 100;
}

/**
 * §6.4 v2 — assemble one MarketSignalsEntry from the runBucketDynamics output.
 * Pure: no DB. Bumped numbers are rounded to keep the JSON column compact.
 * Exported for unit testing.
 */
export function buildMarketSignalsEntry(
  year: number,
  diag: {
    delta_food: number;
    delta_labor: number;
    delta_craft: number;
    delta_capital: number;
    food_ratio: number;
    food_produced: number;
    food_needed: number;
  },
  buckets: BucketState[],
): MarketSignalsEntry {
  const byType = (t: BucketState['type']): { count: number; avg_wealth: number } => {
    const b = buckets.find((x) => x.type === t);
    return {
      count: b?.count ?? 0,
      avg_wealth: b?.avg_wealth ?? 0,
    };
  };
  const round4 = (n: number): number => Math.round(n * 10000) / 10000;
  const round1 = (n: number): number => Math.round(n * 10) / 10;
  return {
    year,
    food_ratio: round4(diag.food_ratio),
    delta_food: round4(diag.delta_food),
    delta_labor: round4(diag.delta_labor),
    delta_craft: round4(diag.delta_craft),
    delta_capital: round4(diag.delta_capital),
    food_produced: round1(diag.food_produced),
    food_needed: round1(diag.food_needed),
    classes: {
      farmer: byType('Farmer'),
      laborer: byType('Laborer'),
      artisan: byType('Artisan'),
      merchant: byType('Merchant'),
    },
  };
}

/**
 * Decision logic for single-flight (exposed pure for unit testing).
 * If `active` is non-null, advance is rejected.
 */
export function decideAdvance(
  active: Pick<YearRun, 'id' | 'status'> | null,
): { allow: boolean; reason?: 'pending' | 'running' } {
  if (!active) return { allow: true };
  if (active.status === 'pending' || active.status === 'running') {
    return { allow: false, reason: active.status };
  }
  return { allow: true };
}
