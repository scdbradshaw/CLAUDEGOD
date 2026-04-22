// ============================================================
// /api/interactions — Tick engine (2 ticks per year)
// ============================================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { toneForOutcomeBand } from '../services/tone.service';
import {
  ALL_IDENTITY_KEYS,
  DEFAULT_GLOBAL_TRAIT_MULTIPLIERS,
  PREGNANCY_DURATION_TICKS,
  TRAUMA_SCORE_PENALTY,
  TRAUMA_ANNUAL_DECAY,
  type GlobalTraitSet,
  type RulesetDef,
  type TraitSet,
} from '@civ-sim/shared';
import {
  computeScore,
  findBand,
  getEffects,
  applyEffectPacket,
  emotionalImpactForMagnitude,
  invertImpact,
  computeGrudgeBonus,
} from '../tick/scoring';
import { resolveInteractionsPhase } from '../tick/resolve-interactions';
import { withTiming, timingsEnabled, type PhaseTimings } from '../tick/timing';
import { updateMarketPhase, type MarketEvent } from '../tick/market';
import { processBirths, type BirthEvent } from '../services/births.service';
import { getActiveWorld } from '../services/time.service';
import {
  loadActiveGroups,
  loadMembershipIndex,
  viralJoinsForPair,
  runMembershipDropoff,
  type PersonSnapshot,
  type JoinCandidate,
} from '../services/membership.service';
import {
  tryEmergentSpawn,
  tryEventSpawn,
  spawnGroup,
  type SpawnIntent,
  type SpawnResult,
} from '../services/group-formation.service';
import {
  handlePersonDeath,
  runFactionSplitCheck,
  type ReligionDissolveResult,
  type FactionDissolveResult,
  type SuccessionResult,
  type FactionSplitResult,
} from '../services/group-lifecycle.service';
import { writeMemoriesBatch } from '../services/memory.service';
import {
  applyRelationshipDeltas,
  decayAndPruneForWorld,
  classifyImpactForRelationship,
  type RelationshipDelta,
} from '../services/relationships.service';
import {
  runAgenticTurn,
  type AgentPersonSnapshot,
  type OwnedEdge,
  type AgenticActionLog,
} from '../services/agentic.service';
import {
  applyOccupationIncome,
  distributeInheritance,
  type InheritanceResult,
} from '../services/economy-occupation.service';
import {
  runReligionConversionPass,
  type ConversionEvent,
} from '../services/religion-dynamics.service';
import type { CriminalRecord } from '@civ-sim/shared';

const router = Router();

// ── Tick lock (Node is single-threaded, this is safe) ───────
let tickRunning = false;

/** Data-driven passive drifts — computed from ruleset.passive_drifts.
 *  Missing global trait keys fall back to 0. */
function computePassiveDrifts(
  rules: RulesetDef,
  gt: GlobalTraitSet,
): Record<string, number> {
  const drifts: Record<string, number> = {};
  for (const rule of rules.passive_drifts ?? []) {
    let v = rule.base ?? 0;
    for (const inp of rule.inputs) {
      v += (gt[inp.key] ?? 0) * inp.multiplier;
    }
    drifts[rule.stat] = Math.max(rule.min, Math.min(rule.max, Math.round(v)));
  }
  return drifts;
}

// ── Person row shape for tick + /force ──────────────────────

type LivingPerson = {
  id:    string;
  name:  string;
  age:   number;
  death_age:           number;
  wealth:              number;
  traits:              Prisma.JsonValue;
  global_scores:       Prisma.JsonValue;
  /** Life/death column — synced from traits.health. */
  health:              number;
  /** Round 3 — emotional scar tissue; subtracted from interaction score. */
  trauma_score:        number;
  relationship_status: string;
  criminal_record:     Prisma.JsonValue;
};

// ── POST /api/interactions/tick ──────────────────────────────

router.post('/tick', async (_req: Request, res: Response) => {
  if (tickRunning) {
    res.status(409).json({ error: 'A tick is already in progress' });
    return;
  }
  tickRunning = true;

  const timings: PhaseTimings = {};

  try {
    // 1. World state + ruleset
    const world = await getActiveWorld();
    const globalTraits   = world.global_traits as GlobalTraitSet;
    const traitMults     = Object.keys((world.global_trait_multipliers as object) ?? {}).length
      ? world.global_trait_multipliers as Record<string, number>
      : DEFAULT_GLOBAL_TRAIT_MULTIPLIERS;

    const rulesetRow = await prisma.ruleset.findFirst({ where: { is_active: true } });
    if (!rulesetRow) { res.status(400).json({ error: 'No active ruleset' }); return; }
    const rules = rulesetRow.rules as unknown as RulesetDef;

    // 2. All living characters in this world
    const living = await prisma.person.findMany({
      where: { world_id: world.id, health: { gt: 0 } },
      select: {
        id: true, name: true, wealth: true, age: true, death_age: true,
        traits: true, global_scores: true, health: true,
        trauma_score: true,
        // agentic turn reads relationship_status and criminal_record
        relationship_status: true, criminal_record: true,
      },
    }) as LivingPerson[];

    if (living.length < 2) {
      res.json({ message: 'Not enough living characters', interactions_processed: 0 });
      tickRunning = false;
      return;
    }

    const byId = new Map(living.map(p => [p.id, p]));

    // 2a. Inner-circle link lookup — grouped by owner_id for O(1) access.
    // relation_type is pulled too so Wave 3's agentic turn can read the
    // owner's full outgoing graph without a second fetch.
    const livingIds = living.map(p => p.id);
    const allLinks = await prisma.innerCircleLink.findMany({
      where: { owner_id: { in: livingIds } },
      select: { owner_id: true, target_id: true, bond_strength: true, relation_type: true },
    });
    const linksOf = new Map<string, OwnedEdge[]>();
    for (const l of allLinks) {
      const arr = linksOf.get(l.owner_id) ?? [];
      arr.push({
        target_id:     l.target_id,
        bond_strength: l.bond_strength,
        relation_type: l.relation_type as OwnedEdge['relation_type'],
      });
      linksOf.set(l.owner_id, arr);
    }

    // 2b. Group snapshot — active religions + factions + membership index.
    // Used for viral join checks during each interaction and for the
    // year-boundary drop-off pass.
    const groups       = await loadActiveGroups(prisma);
    const memberships  = await loadMembershipIndex(prisma);

    // Build PersonSnapshot map once — reused for joins + dropoff.
    const personSnaps = new Map<string, PersonSnapshot>();
    for (const p of living) {
      personSnaps.set(p.id, {
        id:            p.id,
        traits:        (p.traits        ?? {}) as Record<string, number>,
        global_scores: (p.global_scores ?? {}) as Record<string, number>,
        health:        p.health,
      });
    }

    // 3. Run interactions — delegated to the Round 5 phase module. Returns
    //    accumulator maps only; no DB writes happen until the txn below.
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
        globalTraits,
        traitMults,
      }),
    );
    const {
      traitDeltas,
      topScores,
      pendingMemories,
      pendingJoinsByKey,
      pendingSpawnsByFounder,
      pendingPregnanciesByPair,
      interactionsProcessed,
    } = phaseResult;

    // 4. Passive drifts (data-driven from ruleset, applied to everyone)
    await withTiming(timings, 'applyDrifts', () => {
      const drifts = computePassiveDrifts(rules, globalTraits);
      for (const p of living) {
        traitDeltas[p.id] ??= {};
        for (const [key, d] of Object.entries(drifts)) {
          traitDeltas[p.id][key] = (traitDeltas[p.id][key] ?? 0) + d;
        }
      }
    });

    // 5. Apply all trait deltas — single bulk UPDATE per tick.
    //    Every row: { id, traits: {merged}, health?: number (if traits.health changed) }
    //    The SQL merges traits JSONB via || and syncs the health column.
    const finalHealth: Record<string, number> = {};
    const spawnResults: SpawnResult[] = [];
    type BulkUpdateRow = { id: string; traits: Record<string, number>; health?: number };
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
        if (next !== cur) {
          newTraits[key] = next;
          changed = true;
        }
      }

      if (changed) {
        const row: BulkUpdateRow = { id: p.id, traits: newTraits };
        // Sync health column if traits.health changed
        if (td.health !== undefined) row.health = newTraits.health ?? p.health;
        finalHealth[p.id] = row.health ?? p.health;
        bulkUpdates.push(row);
      } else {
        finalHealth[p.id] = p.health;
      }
    }

    await withTiming(timings, 'persistInteractions', () => prisma.$transaction(async (tx) => {
      if (bulkUpdates.length > 0) {
        // One round-trip regardless of N. Merges traits JSONB and optionally syncs health column.
        await tx.$executeRaw`
          UPDATE persons p SET
            traits     = p.traits || (u.updates->'traits')::jsonb,
            health     = COALESCE((u.updates->>'health')::int, p.health),
            updated_at = NOW()
          FROM jsonb_array_elements(${JSON.stringify(bulkUpdates)}::jsonb) AS u(updates)
          WHERE p.id = (u.updates->>'id')::uuid
        `;
      }

      // 5a. Memory writes — batched through the memory service so weight
      // and decade_of_life are set consistently.
      if (pendingMemories.length > 0) {
        await writeMemoriesBatch(tx, pendingMemories.map((m) => ({
          personId:        m.person_id,
          eventSummary:    m.event_summary,
          emotionalImpact: m.emotional_impact,
          deltaApplied:    { score: m.event_summary },
          magnitude:       m.magnitude,
          counterpartyId:  m.counterparty_id,
          worldYear:       world.current_year,
          tone:            m.tone,
          ageAtEvent:      m.age_at_event,
          eventKind:       'interaction',
        })));

        // 5a.i. Phase 7 Wave 2 — feed the relationship graph.
        // Each memory with a counterparty and a non-neutral impact produces
        // a directed edge bump; applyRelationshipDeltas aggregates duplicates
        // and upserts InnerCircleLink rows in a single round-trip.
        const relDeltas: RelationshipDelta[] = [];
        for (const m of pendingMemories) {
          if (!m.counterparty_id) continue;
          const classified = classifyImpactForRelationship(m.emotional_impact);
          if (!classified) continue;
          relDeltas.push({
            ownerId:       m.person_id,
            targetId:      m.counterparty_id,
            kind:          classified.kind,
            strengthDelta: classified.delta,
          });
        }
        await applyRelationshipDeltas(tx, relDeltas);
      }

      // 5b. Viral membership joins — split by kind, skipDuplicates catches
      // any race against the unique (group_id, person_id) constraint.
      if (pendingJoinsByKey.size > 0) {
        const religionJoins = [];
        const factionJoins  = [];
        for (const c of pendingJoinsByKey.values()) {
          const row = {
            person_id:   c.subject.id,
            joined_year: world.current_year,
            alignment:   c.alignment,
          };
          if (c.groupKind === 'religion') {
            religionJoins.push({ ...row, religion_id: c.groupId });
          } else {
            factionJoins.push({ ...row, faction_id: c.groupId });
          }
        }
        if (religionJoins.length > 0) {
          await tx.religionMembership.createMany({
            data: religionJoins,
            skipDuplicates: true,
          });
        }
        if (factionJoins.length > 0) {
          await tx.factionMembership.createMany({
            data: factionJoins,
            skipDuplicates: true,
          });
        }
      }

      // 5c. Group formation — spawn new religions / factions. Founder is
      // auto-enrolled as the first member (and leader, for factions).
      for (const intent of pendingSpawnsByFounder.values()) {
        const result = await spawnGroup(tx, intent, world.current_year, world.id);
        spawnResults.push(result);
      }

      // 5d. Pregnancies queued by `creates_pregnancy` outcome bands. Filter
      // out any pair where either party died this tick (their row has been
      // deleted downstream) or already carries an unresolved pregnancy.
      // Both guards live here because we need the tx to see consistent state.
      for (const pair of pendingPregnanciesByPair.values()) {
        const existing = await tx.pregnancy.findFirst({
          where: {
            world_id: world.id,
            resolved: false,
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
            parent_a_id:  pair.parent_a_id,
            parent_b_id:  pair.parent_b_id,
            world_id:     world.id,
            started_tick: world.tick_count,
            due_tick:     world.tick_count + PREGNANCY_DURATION_TICKS,
          },
        });
      }
    }));

    // 6. Process interaction deaths — each death runs religion-dissolve
    //    BEFORE the person is deleted so we can still write faith-lost
    //    memories keyed off the founder relation.
    let deathsThisTick = 0;
    const oldTotalDeaths = world.total_deaths;
    const religionDissolves:   ReligionDissolveResult[] = [];
    const factionDissolves:    FactionDissolveResult[]  = [];
    const religionSuccessions: SuccessionResult[]       = [];
    const factionSuccessions:  SuccessionResult[]       = [];
    const inheritances: InheritanceResult[] = [];

    await withTiming(timings, 'processInteractionDeaths', async () => {
    for (const p of living) {
      if (finalHealth[p.id] <= 0) {
        await prisma.$transaction(async (tx) => {
          const groupOutcome = await handlePersonDeath(tx, p.id, p.name, world.current_year, world.id);
          religionDissolves.push(...groupOutcome.religion_dissolves);
          factionDissolves.push(...groupOutcome.faction_dissolves);
          religionSuccessions.push(...groupOutcome.religion_successions);
          factionSuccessions.push(...groupOutcome.faction_successions);
          // Phase 7 Wave 4 — distribute wealth to top kin/spouse/lover
          // before deletion cascades away the edges.
          const inh = await distributeInheritance(tx, p.id, p.name, p.wealth, world.current_year);
          if (inh.heirs.length > 0) inheritances.push(inh);
          await tx.deceasedPerson.create({
            data: {
              name:         p.name,
              age_at_death: p.age,
              world_year:   world.current_year,
              cause:        'interaction',
              final_health: 0,
              final_wealth: p.wealth,
              world_id:     world.id,
            },
          });
          await tx.person.delete({ where: { id: p.id } });
        });
        deathsThisTick++;
      }
    }
    });

    // 7. Age every 2nd tick
    const newTickCount = world.tick_count + 1;
    let newYear = world.current_year;
    let religionDrops = 0;
    let factionDrops  = 0;
    let factionSplits: FactionSplitResult[] = [];
    let agenticActions: AgenticActionLog[] = [];
    let conversions: ConversionEvent[] = [];

    if (newTickCount % 2 === 0) {
      await prisma.$executeRaw`
        UPDATE persons SET age = LEAST(age + 1, death_age), updated_at = NOW()
        WHERE world_id = ${world.id}::uuid
      `;
      newYear = world.current_year + 1;

      // Natural deaths (reached death_age)
      const naturallyDying = await prisma.$queryRaw<
        Array<{ id: string; name: string; age: number; wealth: number }>
      >`SELECT id, name, age, wealth FROM persons WHERE world_id = ${world.id}::uuid AND age >= death_age AND health > 0`;

      for (const dead of naturallyDying) {
        await prisma.$transaction(async (tx) => {
          const groupOutcome = await handlePersonDeath(tx, dead.id, dead.name, newYear, world.id);
          religionDissolves.push(...groupOutcome.religion_dissolves);
          factionDissolves.push(...groupOutcome.faction_dissolves);
          religionSuccessions.push(...groupOutcome.religion_successions);
          factionSuccessions.push(...groupOutcome.faction_successions);
          // Phase 7 Wave 4 — same inheritance path as interaction deaths.
          const inh = await distributeInheritance(tx, dead.id, dead.name, dead.wealth, newYear);
          if (inh.heirs.length > 0) inheritances.push(inh);
          await tx.deceasedPerson.create({
            data: {
              name:         dead.name,
              age_at_death: dead.age,
              world_year:   newYear,
              cause:        'old_age',
              final_health: 0,
              final_wealth: dead.wealth,
              world_id:     world.id,
            },
          });
          await tx.person.delete({ where: { id: dead.id } });
        });
        deathsThisTick++;
      }

      // 7a. Memory decay — mid-magnitude memories fade; extremes persist.
      // Formula: drop memories older than (magnitude * 40 ticks + 5 ticks).
      // magnitude=1.0 → ~45 ticks (~22 yrs); magnitude=0.35 → ~19 ticks.
      await prisma.$executeRaw`
        DELETE FROM memory_bank
        WHERE world_year IS NOT NULL
          AND person_id IN (SELECT id FROM persons WHERE world_id = ${world.id}::uuid)
          AND (${newYear}::int - world_year) > (magnitude * 20 + 3)::int
      `;

      // 7a.i. Round 3 — annual trauma decay. Scar tissue fades with time.
      // Stops at 0; reinforcement comes from new negative memory writes.
      await prisma.$executeRaw`
        UPDATE persons SET trauma_score = GREATEST(0, trauma_score * ${TRAUMA_ANNUAL_DECAY})
        WHERE world_id = ${world.id}::uuid AND trauma_score > 0
      `;

      // 7b. Membership drop-off — anyone whose alignment has drifted below
      // MIN_ALIGNMENT_RETAIN leaves their group. Runs only on year-boundary
      // ticks so churn is annual, not per-tick.
      const dropoff = await prisma.$transaction(async (tx) =>
        runMembershipDropoff(tx, personSnaps, groups),
      );
      religionDrops = dropoff.religion_drops;
      factionDrops  = dropoff.faction_drops;

      // 7c. Faction splits — track per-member alignment and fire splits
      // when sustained lead over the leader exceeds the buffer for
      // SPLIT_PRESSURE_THRESHOLD consecutive year-boundaries.
      factionSplits = await prisma.$transaction(async (tx) =>
        runFactionSplitCheck(tx, personSnaps, newYear, world.id),
      );

      // 7d. Phase 7 Wave 2 — relationship decay.
      // Pulls all bond strengths one step toward neutral (50) and prunes
      // rows that have fully decayed. Runs outside the txn by design; it's
      // two cheap bulk statements that don't need the per-world isolation
      // of the membership pass above.
      await decayAndPruneForWorld(world.id);

      // 7e. Phase 7 Wave 3 — agentic annual turn.
      // Top-K by influence + |morality-50|*2 + max|bond-50|*2 each take a
      // single deliberate action: befriend / betray / marry / murder.
      // Uses the pre-tick linksOf (relationships haven't been re-fetched
      // since step 2a). Filters out anyone already killed this tick —
      // both interaction deaths and natural old-age deaths.
      const alreadyDead = new Set<string>();
      for (const p of living) {
        if (finalHealth[p.id] !== undefined && finalHealth[p.id] <= 0) alreadyDead.add(p.id);
      }
      for (const d of naturallyDying) alreadyDead.add(d.id);

      const agentSnapshots: AgentPersonSnapshot[] = living
        .filter(p => !alreadyDead.has(p.id))
        .map(p => ({
          id:     p.id,
          name:   p.name,
          age:    p.age + 1, // post-aging, since we just advanced years
          traits: (p.traits ?? {}) as Record<string, number>,
          wealth: p.wealth,
          relationship_status: p.relationship_status,
          criminal_record:     (p.criminal_record as unknown as CriminalRecord[]) ?? [],
        }));

      // Rebuild linksOf from DB so agentic turn plans off post-interaction state.
      const postInteractionLinks = await prisma.innerCircleLink.findMany({
        where:  { owner_id: { in: agentSnapshots.map(a => a.id) } },
        select: { owner_id: true, target_id: true, bond_strength: true, relation_type: true },
      });
      const agentLinksOf = new Map<string, OwnedEdge[]>();
      for (const l of postInteractionLinks) {
        const arr = agentLinksOf.get(l.owner_id) ?? [];
        arr.push({ target_id: l.target_id, bond_strength: l.bond_strength, relation_type: l.relation_type as OwnedEdge['relation_type'] });
        agentLinksOf.set(l.owner_id, arr);
      }

      const agenticResult = await withTiming(timings, 'runAgenticTurn', () =>
        prisma.$transaction(async (tx) =>
          runAgenticTurn(tx, agentSnapshots, agentLinksOf, newYear, world.id, {
            startedTick:            newTickCount,
            pregnancyDurationTicks: PREGNANCY_DURATION_TICKS,
            conceive:               rules.capability_gates?.agentic_conceive,
          }),
        ),
      );
      agenticActions = agenticResult.actions;
      religionDissolves.push(...agenticResult.religion_dissolves);
      factionDissolves.push(...agenticResult.faction_dissolves);
      religionSuccessions.push(...agenticResult.religion_successions);
      factionSuccessions.push(...agenticResult.faction_successions);
      inheritances.push(...agenticResult.inheritances);
      deathsThisTick += agenticResult.actions.filter(a => a.killed_target).length;

      // 7f. Phase 7 Wave 4 — annual occupation income.
      // Scales by current market index (pre-tick-9 value — tick 9 will
      // repopulate it from the new fundamentals). Floor/ceiling live
      // inside the service so we don't leak domain knowledge here.
      await applyOccupationIncome(world.id, world.market_index);

      // 7g. Phase 7 Wave 5 — annual religion conversion pass.
      // Non-members in doubt (low happiness or low faith.devotion) scan
      // all active religions and convert to the one they best align with.
      // Complements the viral join path — this is internal doubt finding
      // faith, not faith spreading through contact.
      const conversionResult = await prisma.$transaction(async (tx) =>
        runReligionConversionPass(tx, [...personSnaps.values()], groups.religions, memberships, newYear),
      );
      conversions = conversionResult.conversions;
    }

    // 8. Births — resolve any pregnancies whose due_tick has arrived. This
    //    replaces the legacy "12 births per 10 deaths" population-upkeep
    //    loop with the interaction-driven model described in DESIGN §9.
    const newTotalDeaths = oldTotalDeaths + deathsThisTick;
    const birthEvents: BirthEvent[] = await withTiming(timings, 'processBirths', () =>
      processBirths(
        world.id,
        newTickCount,
        newYear,
        globalTraits as Record<string, number>,
      ),
    );
    const birthsThisTick = birthEvents.length;

    // 9. Market engine — Round 8: phase module handles drift + trait-
    //    weighted wealth drift + crash/boom/bubble/depression detection.
    const { newMarketIdx, marketReturn, marketEvent } = await withTiming(timings, 'updateMarket', () =>
      updateMarketPhase({
        prisma,
        worldId:          world.id,
        marketIndex:      world.market_index,
        marketTrend:      world.market_trend,
        marketVolatility: world.market_volatility,
      }),
    );

    // 10. Persist world state
    await prisma.world.update({
      where: { id: world.id },
      data:  {
        tick_count:    newTickCount,
        total_deaths:  newTotalDeaths,
        market_index:  newMarketIdx,
        current_year:  newYear,
      },
    });

    res.json({
      tick_number:            newTickCount,
      world_year:             newYear,
      interactions_processed: interactionsProcessed,
      deaths_this_tick:       deathsThisTick,
      births_this_tick:       birthsThisTick,
      births:                 birthEvents,
      market_return_pct:      Math.round(marketReturn * 1000) / 10,
      new_market_index:       Math.round(newMarketIdx * 100) / 100,
      // Round 8 — crash/boom/bubble/depression detected this tick (null otherwise)
      market_event:           marketEvent,
      top_scores:             topScores,
      memories_created:       pendingMemories.length,
      memberships_joined:     pendingJoinsByKey.size,
      religion_drops:         religionDrops,
      faction_drops:          factionDrops,
      groups_formed:          spawnResults.map(r => ({
        kind: r.kind, name: r.name, group_id: r.groupId, founder_id: r.founderId,
      })),
      religions_dissolved:    religionDissolves.map(r => ({
        religion_id: r.religion_id, name: r.religion_name, members_lost: r.members_lost,
      })),
      // Round 4 — leader-death successions + faction dissolutions
      factions_dissolved:     factionDissolves.map(f => ({
        faction_id: f.faction_id, name: f.faction_name, members_lost: f.members_lost,
      })),
      religion_successions:   religionSuccessions.map(s => ({
        religion_id:     s.group_id,
        religion_name:   s.group_name,
        predecessor_id:  s.predecessor_id,
        heir_id:         s.heir_id,
        heir_name:       s.heir_name,
        composite_score: s.composite_score,
      })),
      faction_successions:    factionSuccessions.map(s => ({
        faction_id:      s.group_id,
        faction_name:    s.group_name,
        predecessor_id:  s.predecessor_id,
        heir_id:         s.heir_id,
        heir_name:       s.heir_name,
        composite_score: s.composite_score,
      })),
      faction_splits:         factionSplits.map(s => ({
        new_faction_id: s.new_faction_id,
        name:           s.new_faction_name,
        split_from_id:  s.split_from_id,
        new_leader_id:  s.new_leader_id,
      })),
      // Phase 7 Wave 3 — one row per agentic action that fired this year
      agentic_actions: agenticActions,
      // Phase 7 Wave 4 — inheritance distributions from this tick's deaths
      inheritances: inheritances.map(i => ({
        deceased_name: i.deceased_name,
        estate:        i.estate,
        heirs: i.heirs.map(h => ({
          name:     h.heir_name,
          relation: h.relation,
          share:    h.share,
        })),
      })),
      // Phase 7 Wave 5 — doubt-driven religion conversions on year boundary
      conversions: conversions.map(c => ({
        person_id:     c.person_id,
        religion_id:   c.religion_id,
        religion_name: c.religion_name,
        alignment:     c.alignment,
      })),
      // Round 5 — per-phase timings, only emitted when DEBUG_TICK_TIMING=1
      ...(timingsEnabled() ? { timings_ms: timings } : {}),
    });

  } finally {
    tickRunning = false;
  }
});

// ── POST /api/interactions/force ────────────────────────────
//
// Run exactly one interaction between two specific people with a
// specific interaction type — all three chosen by the player.
// Bypasses the tick lock and the random antagonizer picker.
//
// Body: { subject_id, antagonist_id, interaction_type_id }
//
// Returns: { subject, antagonist, interaction_type, score, outcome, memories }

router.post('/force', async (req: Request, res: Response) => {
  const { subject_id, antagonist_id, interaction_type_id } = req.body;

  if (!subject_id || !antagonist_id || !interaction_type_id) {
    res.status(400).json({ error: 'subject_id, antagonist_id, and interaction_type_id are required' });
    return;
  }
  if (subject_id === antagonist_id) {
    res.status(400).json({ error: 'Subject and antagonist must be different people' });
    return;
  }

  // Load both persons
  const [subject, antagonist] = await Promise.all([
    prisma.person.findUnique({
      where: { id: subject_id },
      select: {
        id: true, name: true, wealth: true, age: true, death_age: true,
        traits: true, global_scores: true, health: true, trauma_score: true,
      },
    }),
    prisma.person.findUnique({
      where: { id: antagonist_id },
      select: {
        id: true, name: true, wealth: true, age: true, death_age: true,
        traits: true, global_scores: true, health: true, trauma_score: true,
      },
    }),
  ]);

  if (!subject) { res.status(404).json({ error: `Subject ${subject_id} not found` }); return; }
  if (!antagonist) { res.status(404).json({ error: `Antagonist ${antagonist_id} not found` }); return; }

  // Load world state + active ruleset
  const world = await getActiveWorld();
  const rulesetRow = await prisma.ruleset.findFirst({ where: { is_active: true } });
  if (!rulesetRow) { res.status(400).json({ error: 'No active ruleset' }); return; }
  const rules = rulesetRow.rules as unknown as RulesetDef;

  // Find the requested interaction type
  const iType = rules.interaction_types.find((t) => t.id === interaction_type_id);
  if (!iType) {
    res.status(400).json({
      error: `Interaction type "${interaction_type_id}" not found in active ruleset`,
      available: rules.interaction_types.map((t) => ({ id: t.id, label: t.label })),
    });
    return;
  }

  const globalTraits = world.global_traits as GlobalTraitSet;
  const traitMults   = Object.keys((world.global_trait_multipliers as object) ?? {}).length
    ? world.global_trait_multipliers as Record<string, number>
    : DEFAULT_GLOBAL_TRAIT_MULTIPLIERS;

  // Score
  const grudgeBonus   = await computeGrudgeBonus(prisma, subject.id, antagonist.id);
  const subjectTraits = (subject.traits ?? {}) as TraitSet;
  const traumaPenalty = Math.round((subject.trauma_score ?? 0) * TRAUMA_SCORE_PENALTY);
  const score         = computeScore(iType, subjectTraits, globalTraits, traitMults, grudgeBonus) - traumaPenalty;
  const band          = findBand(score, rules.outcome_bands);

  // Effects — unified traitDeltas accumulator
  const traitDeltas: Record<string, Record<string, number>> = {};
  const { subject: subjectPacket, antagonist: antaPacket } = getEffects(band);
  applyEffectPacket(traitDeltas, subject.id,    subjectPacket);
  applyEffectPacket(traitDeltas, antagonist.id, antaPacket);

  // Persist delta + memory in one transaction
  const summary   = `Forced: ${iType.label} between ${subject.name} and ${antagonist.name} — ${band.label} (${score})`;
  const emotional = emotionalImpactForMagnitude(score, band.magnitude ?? 0.5);
  const magnitude = band.magnitude ?? 0.5;

  await prisma.$transaction(async (tx) => {
    for (const [pid, td] of Object.entries(traitDeltas)) {
      const person = pid === subject.id ? subject : antagonist;
      const existingTraits = (person.traits ?? {}) as Record<string, number>;
      const newTraits: Record<string, number> = { ...existingTraits };
      let traitsChanged = false;
      let newHealth: number | undefined;

      for (const [trait, d] of Object.entries(td)) {
        if (trait === 'health') {
          newHealth = Math.max(0, Math.min(100, (person.health ?? 100) + d));
          continue;
        }
        if (!ALL_IDENTITY_KEYS.includes(trait)) continue;
        const cur  = newTraits[trait] ?? 50;
        const next = Math.max(0, Math.min(100, cur + d));
        if (next !== cur) { newTraits[trait] = next; traitsChanged = true; }
      }

      const updateData: Record<string, unknown> = {};
      if (traitsChanged) updateData.traits = newTraits as unknown as Prisma.InputJsonValue;
      if (newHealth !== undefined) updateData.health = newHealth;

      if (Object.keys(updateData).length > 0) {
        await tx.person.update({ where: { id: pid }, data: updateData });
      }
    }

    // Memory entries
    if (band.creates_memory) {
      const tone = toneForOutcomeBand(band, iType);
      await writeMemoriesBatch(tx, [
        {
          personId:        subject.id,
          eventSummary:    summary,
          emotionalImpact: emotional,
          deltaApplied:    { score, band: band.label },
          magnitude,
          counterpartyId:  antagonist.id,
          worldYear:       world.current_year,
          tone,
          ageAtEvent:      subject.age,
          eventKind:       'interaction',
        },
        {
          personId:        antagonist.id,
          eventSummary:    `Forced: ${iType.label} with ${subject.name} — ${band.label} (${score})`,
          emotionalImpact: invertImpact(emotional),
          deltaApplied:    { score, band: band.label },
          magnitude,
          counterpartyId:  subject.id,
          worldYear:       world.current_year,
          tone,
          ageAtEvent:      antagonist.age,
          eventKind:       'interaction',
        },
      ]);
    }
  });

  res.json({
    subject_name:       subject.name,
    antagonist_name:    antagonist.name,
    interaction_type:   { id: iType.id, label: iType.label },
    score,
    grudge_bonus:       grudgeBonus,
    outcome:            band.label,
    magnitude,
    creates_memory:     band.creates_memory,
    subject_traits_changed:    traitDeltas[subject.id] ?? {},
    antagonist_traits_changed: traitDeltas[antagonist.id] ?? {},
  });
});

export default router;
