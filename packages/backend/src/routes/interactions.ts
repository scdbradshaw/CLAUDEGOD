// ============================================================
// /api/interactions — Tick engine (2 ticks per year)
// ============================================================

import { Router, Request, Response } from 'express';
import { Prisma, Tone } from '@prisma/client';
import prisma from '../db/client';
import { toneForOutcomeBand } from '../services/tone.service';
import {
  IDENTITY_ATTRIBUTES,
  ALL_IDENTITY_KEYS,
  DEFAULT_GLOBAL_TRAIT_MULTIPLIERS,
  type GlobalTraitSet,
  type RulesetDef,
  type InteractionTypeDef,
  type OutcomeBand,
  type EffectPacket,
  type TraitSet,
} from '@civ-sim/shared';
import { generateGlobalScores } from '../services/character-gen.service';
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
  type FactionSplitResult,
} from '../services/group-lifecycle.service';

const router = Router();

// ── Tick lock (Node is single-threaded, this is safe) ───────
let tickRunning = false;

/** Scalar 0-100 core stats that the engine is allowed to write to.
 *  Deltas targeting any key outside this set are silently dropped —
 *  this is the single point of "known stat" knowledge in the engine. */
const WRITABLE_STATS = [
  'health', 'morality', 'happiness', 'reputation', 'influence', 'intelligence',
] as const;

// Phase 1 tunables ────────────────────────────────────────────
/** Antagonizer hybrid weight — 60% inner-circle picks, 40% random wild card. */
const CONNECTION_PICK_PROB = 0.60;
/** Cap on grudge-weighted score adjustment from accumulated memories
 *  between subject ↔ antagonist. Keeps one bad day from poisoning forever. */
const MAX_GRUDGE_BONUS = 80;
/** Relationship-memory lookback limit per subject-counterparty pair. */
const GRUDGE_MEMORY_LIMIT = 8;

// ── Pure helpers ─────────────────────────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickInteractionType(types: InteractionTypeDef[]): InteractionTypeDef {
  const total = types.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * total;
  for (const t of types) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return types[types.length - 1];
}

/**
 * Core scoring function — fully data-driven.
 *  - Global amplifiers: each `force.child` value times its multiplier (scaled by force mult).
 *  - Trait weights: each identity attribute contribution from the protagonist.
 *    Unknown keys are silently skipped so old/mismatched rulesets don't crash.
 *  - Grudge bonus: aggregate memory weight between subject and antagonist,
 *    clamped to ±MAX_GRUDGE_BONUS. Positive memory → help, negative → harm.
 */
function computeScore(
  type: InteractionTypeDef,
  protagonistTraits: TraitSet,
  globalTraits: GlobalTraitSet,
  multipliers: Record<string, number>,
  grudgeBonus: number,
): number {
  let score = 0;

  for (const amp of type.global_amplifiers) {
    const forceKey = amp.key.split('.')[0];
    const raw      = globalTraits[amp.key] ?? 0;
    const mult     = multipliers[forceKey] ?? 1.0;
    score += raw * amp.multiplier * mult;
  }

  for (const tw of type.trait_weights) {
    const val = protagonistTraits[tw.trait];
    if (val === undefined) continue; // silently skip unknown traits
    score += val * tw.sign * (tw.multiplier ?? 1);
  }

  score += grudgeBonus;

  return Math.round(score);
}

function findBand(score: number, bands: OutcomeBand[]): OutcomeBand {
  for (const band of bands) {
    if (score >= band.min_score) return band;
  }
  return bands[bands.length - 1];
}

/**
 * Resolve a band's subject/antagonist effect packets.
 * Legacy v2 rulesets (single stat_delta/affects_stats) are upgraded on the
 * fly — subject gets the packet as-is, antagonist gets the inverse — so
 * old rulesets loaded from the DB still work.
 */
function getEffects(band: OutcomeBand): {
  subject:    EffectPacket;
  antagonist: EffectPacket;
} {
  if (band.subject_effect) {
    const subject = band.subject_effect;
    const antagonist = band.antagonist_effect ?? {
      stat_delta:    [-subject.stat_delta[1], -subject.stat_delta[0]],
      affects_stats: subject.affects_stats,
    };
    return { subject, antagonist };
  }
  // Legacy shape
  const statDelta    = band.stat_delta    ?? [0, 0];
  const affectsStats = band.affects_stats ?? [];
  return {
    subject:    { stat_delta: statDelta, affects_stats: affectsStats },
    antagonist: {
      stat_delta:    [-statDelta[1], -statDelta[0]],
      affects_stats: affectsStats,
    },
  };
}

/** Apply one EffectPacket to a person's pending delta accumulator.
 *  Unknown stat/trait keys are silently tolerated — the persist step
 *  filters by the writable whitelist (stats) and by ALL_IDENTITY_KEYS (traits). */
function applyEffectPacket(
  statAcc:   Record<string, Record<string, number>>,
  traitAcc:  Record<string, Record<string, number>>,
  personId:  string,
  packet:    EffectPacket,
) {
  if (packet.affects_stats.length > 0) {
    const mag = randInt(packet.stat_delta[0], packet.stat_delta[1]);
    statAcc[personId] ??= {};
    for (const stat of packet.affects_stats) {
      statAcc[personId][stat] = (statAcc[personId][stat] ?? 0) + mag;
    }
  }
  if (packet.trait_deltas) {
    traitAcc[personId] ??= {};
    for (const [trait, d] of Object.entries(packet.trait_deltas)) {
      traitAcc[personId][trait] = (traitAcc[personId][trait] ?? 0) + d;
    }
  }
}

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

// ── Antagonizer picker (60/40 hybrid) ────────────────────────

type LivingPerson = {
  id:    string;
  name:  string;
  age:   number;
  death_age: number;
  wealth: number;
  traits: Prisma.JsonValue;
  global_scores: Prisma.JsonValue;
  health: number;
  morality: number;
  happiness: number;
  reputation: number;
  influence: number;
  intelligence: number;
};

/**
 * Pick an antagonizer for the subject.
 *   - 60%: weighted draw from subject's inner-circle links by bond_strength
 *   - 40%: uniform random living person (wild card)
 * Falls back to random when the subject has no links.
 */
function pickAntagonizer(
  subject:   LivingPerson,
  allLiving: LivingPerson[],
  byId:      Map<string, LivingPerson>,
  linksOf:   Map<string, { target_id: string; bond_strength: number }[]>,
): LivingPerson | null {
  const pool = allLiving.filter(p => p.id !== subject.id);
  if (pool.length === 0) return null;

  const useConnection = Math.random() < CONNECTION_PICK_PROB;
  const links = linksOf.get(subject.id);

  if (useConnection && links && links.length > 0) {
    // Only count links whose target is still alive
    const alive = links.filter(l => byId.has(l.target_id));
    if (alive.length > 0) {
      const totalWeight = alive.reduce((s, l) => s + Math.max(1, l.bond_strength), 0);
      let roll = Math.random() * totalWeight;
      for (const l of alive) {
        roll -= Math.max(1, l.bond_strength);
        if (roll <= 0) {
          const picked = byId.get(l.target_id);
          if (picked) return picked;
        }
      }
    }
  }
  // Wild-card path
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Random person generator (for births) ────────────────────

const FIRST_NAMES = [
  'Aldric','Mira','Caspian','Lyra','Dorian','Sera','Fenwick','Asha',
  'Brennan','Zoe','Corvus','Isla','Theron','Nyx','Emric','Rowan',
  'Calla','Gareth','Tessa','Magnus','Elara','Sable','Finn','Orion',
  'Wren','Cade','Sylva','Hawk','Dusk','Vex',
];
const LAST_NAMES = [
  'Ashford','Bryne','Crane','Erring','Falk','Grim','Hartwell','Irwin',
  'Jarvis','Kell','Lorne','Mace','Norn','Orin','Pell','Quinn','Ravell',
  'Stone','Thane','Ulric','Vane','Ward','Crow','Drake','Flint','Gale',
  'Marsh','Pike','Rowe','Thorn',
];
const RACES      = ['Human','Elf','Dwarf','Halfling','Orc','Tiefling','Aasimar'];
const RELIGIONS  = ['The Light','The Old Ways','The Void','The Earth Mother','The Storm God','Atheist','Agnostic'];
const SEXUALITIES = ['HETEROSEXUAL','HOMOSEXUAL','BISEXUAL','ASEXUAL','PANSEXUAL','OTHER'] as const;
const GENDERS    = ['Male','Female','Non-binary'];

function generateRandomPerson(worldTraits: Record<string, number> = {}) {
  const traits: Record<string, number> = {};
  for (const list of Object.values(IDENTITY_ATTRIBUTES)) {
    for (const t of list) traits[t] = randInt(20, 80);
  }
  return {
    name:                 `${FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[randInt(0, LAST_NAMES.length - 1)]}`,
    sexuality:            SEXUALITIES[randInt(0, SEXUALITIES.length - 1)],
    gender:               GENDERS[randInt(0, GENDERS.length - 1)],
    race:                 RACES[randInt(0, RACES.length - 1)],
    occupation:           'commoner',
    age:                  0,
    death_age:            randInt(55, 95),
    relationship_status:  'Single',
    religion:             RELIGIONS[randInt(0, RELIGIONS.length - 1)],
    criminal_record:      [],
    health:               100,
    morality:             randInt(20, 80),
    happiness:            randInt(30, 70),
    reputation:           0,
    influence:            0,
    intelligence:         randInt(20, 80),
    physical_appearance:  'Newborn',
    wealth:               0,
    traits,
    global_scores:        generateGlobalScores(worldTraits),
  };
}

// ── POST /api/interactions/tick ──────────────────────────────

router.post('/tick', async (_req: Request, res: Response) => {
  if (tickRunning) {
    res.status(409).json({ error: 'A tick is already in progress' });
    return;
  }
  tickRunning = true;

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
        traits: true, global_scores: true,
        health: true, morality: true, happiness: true,
        reputation: true, influence: true, intelligence: true,
      },
    }) as LivingPerson[];

    if (living.length < 2) {
      res.json({ message: 'Not enough living characters', interactions_processed: 0 });
      tickRunning = false;
      return;
    }

    const byId = new Map(living.map(p => [p.id, p]));

    // 2a. Inner-circle link lookup — grouped by owner_id for O(1) access
    const livingIds = living.map(p => p.id);
    const allLinks = await prisma.innerCircleLink.findMany({
      where: { owner_id: { in: livingIds } },
      select: { owner_id: true, target_id: true, bond_strength: true },
    });
    const linksOf = new Map<string, { target_id: string; bond_strength: number }[]>();
    for (const l of allLinks) {
      const arr = linksOf.get(l.owner_id) ?? [];
      arr.push({ target_id: l.target_id, bond_strength: l.bond_strength });
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
        morality:      p.morality,
        happiness:     p.happiness,
        reputation:    p.reputation,
        influence:     p.influence,
        intelligence:  p.intelligence,
      });
    }

    // 3. Run interactions — each person is protagonist once, picks via 60/40 hybrid
    const statDeltas:  Record<string, Record<string, number>> = {};
    const traitDeltas: Record<string, Record<string, number>> = {};
    const topScores:   Record<string, { protagonist_name: string; score: number; outcome: string }> = {};
    type PendingMemory = {
      person_id:       string;
      event_summary:   string;
      emotional_impact: 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric';
      magnitude:       number;
      counterparty_id: string | null;
      tone:            Tone;
    };
    const pendingMemories: PendingMemory[] = [];

    // Viral-join accumulator — keyed by `${groupId}:${personId}` so that
    // duplicate matches during the same tick collapse to a single insert.
    const pendingJoinsByKey = new Map<string, JoinCandidate>();

    // Group-formation intents — one per founder per tick (emergent or event).
    const pendingSpawnsByFounder = new Map<string, SpawnIntent>();

    const shuffled = [...living].sort(() => Math.random() - 0.5);

    for (const protagonist of shuffled) {
      const antagonist = pickAntagonizer(protagonist, living, byId, linksOf);
      if (!antagonist) continue;

      const iType = pickInteractionType(rules.interaction_types);
      const protagTraits = (protagonist.traits ?? {}) as TraitSet;

      // 3a. Grudge / loyalty weighting — recent memories between these two
      const grudgeBonus = await computeGrudgeBonus(protagonist.id, antagonist.id);

      const score = computeScore(iType, protagTraits, globalTraits, traitMults, grudgeBonus);
      const band  = findBand(score, rules.outcome_bands);

      if (!topScores[iType.id] || score > topScores[iType.id].score) {
        topScores[iType.id] = {
          protagonist_name: protagonist.name,
          score,
          outcome: band.label,
        };
      }

      // Asymmetric outcomes — subject packet + antagonist packet
      const { subject, antagonist: antaPacket } = getEffects(band);
      applyEffectPacket(statDeltas, traitDeltas, protagonist.id, subject);
      applyEffectPacket(statDeltas, traitDeltas, antagonist.id,  antaPacket);

      // Queue memory if the band says so
      if (band.creates_memory) {
        const magnitude = band.magnitude ?? 0.5;
        const emotional = emotionalImpactForMagnitude(score, magnitude);
        const tone      = toneForOutcomeBand(band, iType);
        const summary   = `${iType.label} with ${antagonist.name} — ${band.label} (${score})`;
        pendingMemories.push({
          person_id:       protagonist.id,
          event_summary:   summary,
          emotional_impact: emotional,
          magnitude,
          counterparty_id: antagonist.id,
          tone,
        });
        // Antagonist also remembers (mirrored valence)
        pendingMemories.push({
          person_id:       antagonist.id,
          event_summary:   `${iType.label} with ${protagonist.name} — ${band.label} (${score})`,
          emotional_impact: invertImpact(emotional),
          magnitude,
          counterparty_id: protagonist.id,
          tone,
        });
      }

      // 3b. Viral membership transmission — run in both directions so a
      // carrier can infect either role. Pending joins are deduped by key
      // so repeated matches in the same tick don't spawn duplicate rows.
      const protoSnap = personSnaps.get(protagonist.id);
      const antaSnap  = personSnaps.get(antagonist.id);
      if (protoSnap && antaSnap) {
        const candidates = [
          ...viralJoinsForPair(protoSnap, antaSnap, groups, memberships),
          ...viralJoinsForPair(antaSnap, protoSnap, groups, memberships),
        ];
        for (const c of candidates) {
          const key = `${c.groupId}:${c.subject.id}`;
          const prev = pendingJoinsByKey.get(key);
          if (!prev || c.alignment > prev.alignment) {
            pendingJoinsByKey.set(key, c);
          }
        }

        // 3c. Group formation — event-driven always wins over emergent.
        // One spawn intent per founder per tick (most recent wins if we
        // end up with both — rare in practice).
        const eventSpawn = tryEventSpawn(protoSnap, antaSnap, band);
        const spawn = eventSpawn ?? tryEmergentSpawn(protoSnap, band);
        if (spawn) pendingSpawnsByFounder.set(spawn.founderId, spawn);
      }
    }

    // 4. Passive drifts (data-driven from ruleset, applied to everyone)
    const drifts = computePassiveDrifts(rules, globalTraits);
    for (const p of living) {
      statDeltas[p.id] ??= {};
      for (const [stat, d] of Object.entries(drifts)) {
        statDeltas[p.id][stat] = (statDeltas[p.id][stat] ?? 0) + d;
      }
    }

    // 5. Apply all deltas — stats + traits in one transaction
    const finalHealth: Record<string, number> = {};
    const spawnResults: SpawnResult[] = [];
    await prisma.$transaction(async (tx) => {
      for (const p of living) {
        const sd = statDeltas[p.id] ?? {};
        const td = traitDeltas[p.id] ?? {};
        const updateData: Record<string, unknown> = {};

        for (const stat of WRITABLE_STATS) {
          const delta = sd[stat];
          if (delta === undefined || delta === 0) continue;
          const cur  = (p as unknown as Record<string, number>)[stat] ?? 0;
          updateData[stat] = Math.max(0, Math.min(100, cur + delta));
        }

        finalHealth[p.id] = (updateData.health as number | undefined) ?? p.health;

        // Trait drifts (trauma/triumph modifiers) — clamp 0-100, ignore unknown keys
        const existingTraits = (p.traits ?? {}) as Record<string, number>;
        let traitsChanged = false;
        const newTraits: Record<string, number> = { ...existingTraits };
        for (const [trait, d] of Object.entries(td)) {
          if (!ALL_IDENTITY_KEYS.includes(trait)) continue;
          const cur = newTraits[trait] ?? 50;
          const next = Math.max(0, Math.min(100, cur + d));
          if (next !== cur) {
            newTraits[trait] = next;
            traitsChanged = true;
          }
        }
        if (traitsChanged) {
          updateData.traits = newTraits as unknown as Prisma.InputJsonValue;
        }

        if (Object.keys(updateData).length > 0) {
          await tx.person.update({ where: { id: p.id }, data: updateData });
        }
      }

      // 5a. Memory writes — batched inside the same transaction
      if (pendingMemories.length > 0) {
        await tx.memoryBank.createMany({
          data: pendingMemories.map(m => ({
            person_id:        m.person_id,
            event_summary:    m.event_summary,
            emotional_impact: m.emotional_impact,
            delta_applied:    { score: m.event_summary } as Prisma.InputJsonValue,
            magnitude:        m.magnitude,
            counterparty_id:  m.counterparty_id,
            world_year:       world.current_year,
            tone:             m.tone,
          })),
        });
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
    });

    // 6. Process interaction deaths — each death runs religion-dissolve
    //    BEFORE the person is deleted so we can still write faith-lost
    //    memories keyed off the founder relation.
    let deathsThisTick = 0;
    const oldTotalDeaths = world.total_deaths;
    const religionDissolves: ReligionDissolveResult[] = [];

    for (const p of living) {
      if (finalHealth[p.id] <= 0) {
        await prisma.$transaction(async (tx) => {
          const dissolved = await handlePersonDeath(tx, p.id, p.name, world.current_year);
          religionDissolves.push(...dissolved);
          await tx.deceasedPerson.create({
            data: {
              name:           p.name,
              age_at_death:   p.age,
              world_year:     world.current_year,
              cause:          'interaction',
              final_health:   0,
              final_wealth:   p.wealth,
              final_happiness: p.happiness,
              world_id:       world.id,
            },
          });
          await tx.person.delete({ where: { id: p.id } });
        });
        deathsThisTick++;
      }
    }

    // 7. Age every 2nd tick
    const newTickCount = world.tick_count + 1;
    let newYear = world.current_year;
    let religionDrops = 0;
    let factionDrops  = 0;
    let factionSplits: FactionSplitResult[] = [];

    if (newTickCount % 2 === 0) {
      await prisma.$executeRaw`
        UPDATE persons SET age = LEAST(age + 1, death_age), updated_at = NOW()
        WHERE world_id = ${world.id}::uuid
      `;
      newYear = world.current_year + 1;

      // Natural deaths (reached death_age)
      const naturallyDying = await prisma.$queryRaw<
        Array<{ id: string; name: string; age: number; wealth: number; happiness: number }>
      >`SELECT id, name, age, wealth, happiness FROM persons WHERE world_id = ${world.id}::uuid AND age >= death_age AND health > 0`;

      for (const dead of naturallyDying) {
        await prisma.$transaction(async (tx) => {
          const dissolved = await handlePersonDeath(tx, dead.id, dead.name, newYear);
          religionDissolves.push(...dissolved);
          await tx.deceasedPerson.create({
            data: {
              name:            dead.name,
              age_at_death:    dead.age,
              world_year:      newYear,
              cause:           'old_age',
              final_health:    0,
              final_wealth:    dead.wealth,
              final_happiness: dead.happiness,
              world_id:        world.id,
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
    }

    // 8. Births — every 10 cumulative deaths triggers 12 new births
    const newTotalDeaths   = oldTotalDeaths + deathsThisTick;
    const birthBatchesPrev = Math.floor(oldTotalDeaths / 10);
    const birthBatchesNow  = Math.floor(newTotalDeaths / 10);
    const birthsThisTick   = (birthBatchesNow - birthBatchesPrev) * 12;

    for (let i = 0; i < birthsThisTick; i++) {
      const newborn = generateRandomPerson(globalTraits as Record<string, number>);
      await prisma.person.create({
        data: {
          ...newborn,
          world_id:        world.id,
          criminal_record: newborn.criminal_record as never,
          traits:          newborn.traits          as never,
          global_scores:   newborn.global_scores   as never,
        },
      });
    }

    // 9. Market engine
    const noise        = randFloat(-world.market_volatility, world.market_volatility);
    const marketReturn = world.market_trend + noise;
    const newMarketIdx = Math.max(1.0, world.market_index * (1 + marketReturn));

    // Wealth drift proportional to market return
    if (Math.abs(marketReturn) > 0.0005) {
      const multiplier = 1 + marketReturn;
      await prisma.$executeRaw`
        UPDATE persons SET wealth = wealth * ${multiplier}, updated_at = NOW()
        WHERE world_id = ${world.id}::uuid AND health > 0 AND wealth > 0
      `;
    }

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
      interactions_processed: shuffled.length,
      deaths_this_tick:       deathsThisTick,
      births_this_tick:       birthsThisTick,
      market_return_pct:      Math.round(marketReturn * 1000) / 10,
      new_market_index:       Math.round(newMarketIdx * 100) / 100,
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
      faction_splits:         factionSplits.map(s => ({
        new_faction_id: s.new_faction_id,
        name:           s.new_faction_name,
        split_from_id:  s.split_from_id,
        new_leader_id:  s.new_leader_id,
      })),
    });

  } finally {
    tickRunning = false;
  }
});

// ── Grudge / loyalty weighting ──────────────────────────────
//
// Looks up the most recent memories between `personId` and `counterpartyId`
// and returns a signed bonus in the score space. Positive emotional impact
// bank memories boost the score; negative memories drag it down. Magnitude
// scales each memory's contribution so trauma weighs more than minor events.

const IMPACT_VALENCE: Record<string, number> = {
  traumatic:  -2,
  negative:   -1,
  neutral:     0,
  positive:    1,
  euphoric:    2,
};

async function computeGrudgeBonus(
  personId:         string,
  counterpartyId:   string,
): Promise<number> {
  const memories = await prisma.memoryBank.findMany({
    where: { person_id: personId, counterparty_id: counterpartyId },
    orderBy: { timestamp: 'desc' },
    take: GRUDGE_MEMORY_LIMIT,
    select: { emotional_impact: true, magnitude: true },
  });
  if (memories.length === 0) return 0;
  let total = 0;
  for (const m of memories) {
    const valence = IMPACT_VALENCE[m.emotional_impact] ?? 0;
    total += valence * m.magnitude * 25; // ~25 per extreme memory
  }
  return Math.max(-MAX_GRUDGE_BONUS, Math.min(MAX_GRUDGE_BONUS, total));
}

function emotionalImpactForMagnitude(
  score:     number,
  magnitude: number,
): 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric' {
  if (score >= 0) {
    if (magnitude >= 0.9) return 'euphoric';
    if (magnitude >= 0.4) return 'positive';
    return 'neutral';
  }
  if (magnitude >= 0.9) return 'traumatic';
  if (magnitude >= 0.4) return 'negative';
  return 'neutral';
}

function invertImpact(
  impact: 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric',
): 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric' {
  switch (impact) {
    case 'euphoric':  return 'traumatic';
    case 'positive':  return 'negative';
    case 'negative':  return 'positive';
    case 'traumatic': return 'euphoric';
    default:          return 'neutral';
  }
}

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
        traits: true, global_scores: true,
        health: true, morality: true, happiness: true,
        reputation: true, influence: true, intelligence: true,
      },
    }),
    prisma.person.findUnique({
      where: { id: antagonist_id },
      select: {
        id: true, name: true, wealth: true, age: true, death_age: true,
        traits: true, global_scores: true,
        health: true, morality: true, happiness: true,
        reputation: true, influence: true, intelligence: true,
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
  const grudgeBonus  = await computeGrudgeBonus(subject.id, antagonist.id);
  const subjectTraits = (subject.traits ?? {}) as TraitSet;
  const score         = computeScore(iType, subjectTraits, globalTraits, traitMults, grudgeBonus);
  const band          = findBand(score, rules.outcome_bands);

  // Effects
  const statDeltas:  Record<string, Record<string, number>> = {};
  const traitDeltas: Record<string, Record<string, number>> = {};
  const { subject: subjectPacket, antagonist: antaPacket } = getEffects(band);
  applyEffectPacket(statDeltas, traitDeltas, subject.id,    subjectPacket);
  applyEffectPacket(statDeltas, traitDeltas, antagonist.id, antaPacket);

  // Persist delta + memory in one transaction
  const summary     = `Forced: ${iType.label} between ${subject.name} and ${antagonist.name} — ${band.label} (${score})`;
  const emotional   = emotionalImpactForMagnitude(score, band.magnitude ?? 0.5);
  const magnitude   = band.magnitude ?? 0.5;

  await prisma.$transaction(async (tx) => {
    for (const [pid, sd] of Object.entries(statDeltas)) {
      const person = pid === subject.id ? subject : antagonist;
      const updateData: Record<string, unknown> = {};

      for (const stat of WRITABLE_STATS) {
        const delta = sd[stat];
        if (delta === undefined || delta === 0) continue;
        const cur = (person as unknown as Record<string, number>)[stat] ?? 0;
        updateData[stat] = Math.max(0, Math.min(100, cur + delta));
      }

      // Trait deltas
      const td = traitDeltas[pid] ?? {};
      const existingTraits = (person.traits ?? {}) as Record<string, number>;
      const newTraits: Record<string, number> = { ...existingTraits };
      let traitsChanged = false;
      for (const [trait, d] of Object.entries(td)) {
        if (!ALL_IDENTITY_KEYS.includes(trait)) continue;
        const cur  = newTraits[trait] ?? 50;
        const next = Math.max(0, Math.min(100, cur + d));
        if (next !== cur) { newTraits[trait] = next; traitsChanged = true; }
      }
      if (traitsChanged) updateData.traits = newTraits as unknown as Prisma.InputJsonValue;

      if (Object.keys(updateData).length > 0) {
        await tx.person.update({ where: { id: pid }, data: updateData });
      }
    }

    // Memory entries
    if (band.creates_memory) {
      const tone = toneForOutcomeBand(band, iType);
      await tx.memoryBank.createMany({
        data: [
          {
            person_id:        subject.id,
            event_summary:    summary,
            emotional_impact: emotional,
            delta_applied:    { score, band: band.label } as unknown as Prisma.InputJsonValue,
            magnitude,
            counterparty_id:  antagonist.id,
            world_year:       world.current_year,
            tone,
          },
          {
            person_id:        antagonist.id,
            event_summary:    `Forced: ${iType.label} with ${subject.name} — ${band.label} (${score})`,
            emotional_impact: invertImpact(emotional),
            delta_applied:    { score, band: band.label } as unknown as Prisma.InputJsonValue,
            magnitude,
            counterparty_id:  subject.id,
            world_year:       world.current_year,
            tone,
          },
        ],
      });
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
    subject_stats_changed:    statDeltas[subject.id] ?? {},
    antagonist_stats_changed: statDeltas[antagonist.id] ?? {},
  });
});

export default router;
