// ============================================================
// /api/interactions — Tick engine (2 ticks per year)
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import {
  TRAIT_CATEGORIES,
  DEFAULT_GLOBAL_TRAIT_MULTIPLIERS,
  type GlobalTraitSet,
  type RulesetDef,
  type InteractionTypeDef,
  type OutcomeBand,
} from '@civ-sim/shared';
import { generateGlobalScores } from '../services/character-gen.service';
import { getWorldState } from '../services/time.service';

const router = Router();

// ── Tick lock (Node is single-threaded, this is safe) ───────
let tickRunning = false;

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

function computeScore(
  type: InteractionTypeDef,
  globalTraits: GlobalTraitSet,
  multipliers: Record<string, number>,
): number {
  let score = 0;
  for (const amp of type.global_amplifiers) {
    const traitKey = amp.key.split('.')[0];
    const raw = (globalTraits as Record<string, number>)[amp.key] ?? 0;
    const mult = multipliers[traitKey] ?? 1.0;
    score += raw * amp.multiplier * mult;
  }
  return Math.round(score);
}

function findBand(score: number, bands: OutcomeBand[]): OutcomeBand {
  for (const band of bands) {
    if (score >= band.min_score) return band;
  }
  return bands[bands.length - 1];
}

function applyBandDelta(
  acc: Record<string, { health: number; happiness: number; reputation: number }>,
  personId: string,
  band: OutcomeBand,
) {
  if (!acc[personId]) acc[personId] = { health: 0, happiness: 0, reputation: 0 };
  if (band.affects_stats.length === 0) return;
  const mag = randInt(band.stat_delta[0], band.stat_delta[1]);
  for (const stat of band.affects_stats) {
    if (stat in acc[personId]) {
      (acc[personId] as Record<string, number>)[stat] += mag;
    }
  }
}

function computeHealthDrift(gt: GlobalTraitSet): number {
  const infection = (gt as Record<string, number>)['plague.infection_rate'] ?? 0;
  const food      = (gt as Record<string, number>)['scarcity.food_supply'] ?? 50;
  return Math.max(-5, Math.min(2, Math.round(infection * 0.05 + food * 0.01)));
}

function computeHappinessDrift(gt: GlobalTraitSet): number {
  const comfort    = (gt as Record<string, number>)['faith.spiritual_comfort'] ?? 40;
  const oppression = (gt as Record<string, number>)['tyranny.oppression'] ?? -30;
  return Math.max(-3, Math.min(2, Math.round(comfort * 0.02 + oppression * 0.02)));
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
  for (const list of Object.values(TRAIT_CATEGORIES)) {
    for (const t of list) traits[t] = randInt(0, 100);
  }
  return {
    name:                 `${FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)]} ${LAST_NAMES[randInt(0, LAST_NAMES.length - 1)]}`,
    sexuality:            SEXUALITIES[randInt(0, SEXUALITIES.length - 1)],
    gender:               GENDERS[randInt(0, GENDERS.length - 1)],
    race:                 RACES[randInt(0, RACES.length - 1)],
    age:                  0,
    lifespan:             randInt(55, 95),
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
    const world = await getWorldState();
    const globalTraits   = world.global_traits as GlobalTraitSet;
    const traitMults     = Object.keys((world.global_trait_multipliers as object) ?? {}).length
      ? world.global_trait_multipliers as Record<string, number>
      : DEFAULT_GLOBAL_TRAIT_MULTIPLIERS;

    const rulesetRow = await prisma.ruleset.findFirst({ where: { is_active: true } });
    if (!rulesetRow) { res.status(400).json({ error: 'No active ruleset' }); return; }
    const rules = rulesetRow.rules as unknown as RulesetDef;

    // 2. All living characters
    const living = await prisma.person.findMany({
      where: { health: { gt: 0 } },
      select: { id: true, name: true, health: true, happiness: true, reputation: true, wealth: true, age: true, lifespan: true },
    });

    if (living.length < 2) {
      res.json({ message: 'Not enough living characters', interactions_processed: 0 });
      tickRunning = false;
      return;
    }

    // 3. Run interactions — each person is protagonist once, picks a random antagonist
    const deltas: Record<string, { health: number; happiness: number; reputation: number }> = {};
    const topScores: Record<string, { protagonist_name: string; score: number; outcome: string }> = {};

    const shuffled = [...living].sort(() => Math.random() - 0.5);

    for (const protagonist of shuffled) {
      const candidates = living.filter(p => p.id !== protagonist.id);
      if (!candidates.length) continue;
      const antagonist = candidates[Math.floor(Math.random() * candidates.length)];

      const iType = pickInteractionType(rules.interaction_types);
      const score = computeScore(iType, globalTraits, traitMults);

      // Track top score per interaction category
      if (!topScores[iType.id] || score > topScores[iType.id].score) {
        topScores[iType.id] = {
          protagonist_name: protagonist.name,
          score,
          outcome: findBand(score, rules.outcome_bands).label,
        };
      }

      // Protagonist gets the positive band, antagonist gets the inverse
      applyBandDelta(deltas, protagonist.id, findBand(score, rules.outcome_bands));
      applyBandDelta(deltas, antagonist.id, findBand(-score, rules.outcome_bands));
    }

    // 4. Passive drift (applied to everyone)
    const healthDrift    = computeHealthDrift(globalTraits);
    const happinessDrift = computeHappinessDrift(globalTraits);
    for (const p of living) {
      if (!deltas[p.id]) deltas[p.id] = { health: 0, happiness: 0, reputation: 0 };
      deltas[p.id].health    += healthDrift;
      deltas[p.id].happiness += happinessDrift;
    }

    // 5. Apply all deltas
    const finalHealth: Record<string, number> = {};
    await prisma.$transaction(async (tx) => {
      for (const p of living) {
        const d = deltas[p.id] ?? { health: 0, happiness: 0, reputation: 0 };
        const newHealth     = Math.max(0, Math.min(100, p.health     + d.health));
        const newHappiness  = Math.max(0, Math.min(100, p.happiness  + d.happiness));
        const newReputation = Math.max(0, Math.min(100, p.reputation + d.reputation));
        finalHealth[p.id] = newHealth;
        await tx.person.update({
          where: { id: p.id },
          data:  { health: newHealth, happiness: newHappiness, reputation: newReputation },
        });
      }
    });

    // 6. Process interaction deaths
    let deathsThisTick = 0;
    const oldTotalDeaths = world.total_deaths;

    for (const p of living) {
      if (finalHealth[p.id] <= 0) {
        await prisma.deceasedPerson.create({
          data: {
            name:           p.name,
            age_at_death:   p.age,
            world_year:     world.current_year,
            cause:          'interaction',
            final_health:   0,
            final_wealth:   p.wealth,
            final_happiness: p.happiness,
          },
        });
        await prisma.person.delete({ where: { id: p.id } });
        deathsThisTick++;
      }
    }

    // 7. Age every 2nd tick
    const newTickCount = world.tick_count + 1;
    let newYear = world.current_year;

    if (newTickCount % 2 === 0) {
      await prisma.$executeRaw`
        UPDATE persons SET age = LEAST(age + 1, lifespan), updated_at = NOW()
      `;
      newYear = world.current_year + 1;

      // Natural deaths (reached lifespan)
      const naturallyDying = await prisma.$queryRaw<
        Array<{ id: string; name: string; age: number; wealth: number; happiness: number }>
      >`SELECT id, name, age, wealth, happiness FROM persons WHERE age >= lifespan AND health > 0`;

      for (const dead of naturallyDying) {
        await prisma.deceasedPerson.create({
          data: {
            name:            dead.name,
            age_at_death:    dead.age,
            world_year:      newYear,
            cause:           'old_age',
            final_health:    0,
            final_wealth:    dead.wealth,
            final_happiness: dead.happiness,
          },
        });
        await prisma.person.delete({ where: { id: dead.id } });
        deathsThisTick++;
      }
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
        WHERE health > 0 AND wealth > 0
      `;
    }

    // 10. Persist world state
    await prisma.worldState.update({
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
    });

  } finally {
    tickRunning = false;
  }
});

export default router;
