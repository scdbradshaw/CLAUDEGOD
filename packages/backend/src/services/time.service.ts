// ============================================================
// TIME SERVICE
// Manages the world calendar — advance, rewind, and aging
// ============================================================

import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { writeMemory } from './memory.service';
import { DEFAULT_GLOBAL_TRAITS, DEFAULT_GLOBAL_TRAIT_MULTIPLIERS } from '@civ-sim/shared';
import { getOrCreateDefaultCity } from './cities.service';

// ── Active-world helper ────────────────────────────────────────────────────

/**
 * Returns the currently active World. Creates a default one if none exists.
 * This is the single source of truth used by every route that needs world state.
 */
export async function getActiveWorld() {
  let world = await prisma.world.findFirst({ where: { is_active: true } });
  if (!world) {
    // Find any ruleset to attach, or leave null
    const ruleset = await prisma.ruleset.findFirst({ where: { is_active: true } })
      ?? await prisma.ruleset.findFirst();

    world = await prisma.world.create({
      data: {
        name:                     'Default World',
        is_active:                true,
        population_tier:          'intimate',
        ruleset_id:               ruleset?.id ?? null,
        current_year:             1,
        active_trait_categories:  [],
        global_traits:            DEFAULT_GLOBAL_TRAITS,
        global_trait_multipliers: DEFAULT_GLOBAL_TRAIT_MULTIPLIERS,
        tick_count:               0,
        total_deaths:             0,
        market_index:             100.0,
        market_trend:             0.015,
        market_volatility:        0.03,
      },
    });
  }
  // Idempotent: guarantees a City exists for any world surfaced by the API.
  // Cheap — a PK lookup on the already-indexed world_id. Keeps legacy worlds
  // created before Phase 7 auto-hydrated the first time they're touched.
  await getOrCreateDefaultCity(world.id);
  return world;
}

/** Convenience alias — returns just the id string */
export async function getActiveWorldId(): Promise<string> {
  return (await getActiveWorld()).id;
}

// ── Advance time ───────────────────────────────────────────────────────────

export async function advanceTime(years: number) {
  if (years < 1) throw new Error('Must advance at least 1 year');
  if (years > 500) throw new Error('Cannot advance more than 500 years at once');

  const world = await getActiveWorld();
  const worldId = world.id;
  const startYear = world.current_year;
  const startPopulation = await prisma.person.count({
    where: { world_id: worldId, health: { gt: 0 } },
  });
  const startMarket = world.market_index;

  // 1. Age all characters in this world (capped at death_age)
  await prisma.$executeRaw`
    UPDATE persons
    SET age = LEAST(age + ${years}, death_age),
        updated_at = NOW()
    WHERE world_id = ${worldId}::uuid
  `;

  // 2. Detect and record deaths (age reached death_age, health still > 0)
  const dying: Array<{ id: string; name: string; age: number; death_age: number }> =
    await prisma.$queryRaw`
      SELECT id, name, age, death_age
      FROM persons
      WHERE world_id = ${worldId}::uuid
        AND age >= death_age
        AND health > 0
    `;

  for (const char of dying) {
    await prisma.$transaction(async (tx) => {
      await tx.person.update({
        where: { id: char.id },
        data:  { health: 0 },
      });
      await writeMemory(tx, {
        personId:        char.id,
        eventSummary:    `${char.name} passed away at age ${char.age}, having lived the full span of their years.`,
        emotionalImpact: 'traumatic',
        deltaApplied:    { health: -char.age },
        magnitude:       1.0,
        tone:            'literary',
        worldYear:       startYear + years - 1,
        eventKind:       'death',
        ageAtEvent:      char.age,
      });
    });
  }

  // 3. Trigger birthday-driven life-decade compressions. For every person
  //    who crossed a multiple-of-10 age during this advance, compress their
  //    just-completed life decade. One row/summary per crossed decade.
  await compressBirthdayCrossings(worldId, startYear, years, world.population_tier);

  // 4. Advance world year
  const updated = await prisma.world.update({
    where: { id: worldId },
    data:  { current_year: startYear + years },
  });

  // 5. Write one YearlyReport per year advanced. Deterministic, no Claude.
  //    Headlines are opt-in via /api/time/headlines/generate (queued).
  const endPopulation = await prisma.person.count({
    where: { world_id: worldId, health: { gt: 0 } },
  });
  const deathsByCause = { old_age: dying.length };

  // We only have start + end snapshots across the whole advance, so every
  // year-row in this batch gets the same aggregate split evenly.
  const yearsAdvanced = years;
  const avgPopStart   = Math.round(startPopulation - ((startPopulation - endPopulation) * 0) / yearsAdvanced);
  const deathsPerYear = Math.ceil(dying.length / yearsAdvanced);

  const reports = [];
  for (let y = startYear; y < startYear + yearsAdvanced; y++) {
    // Skip if a richer report already exists (e.g. written by the tick
    // engine at /api/interactions/tick year-boundary).
    const existing = await prisma.yearlyReport.findUnique({
      where: { world_id_year: { world_id: worldId, year: y } },
    });
    if (existing) { reports.push(existing); continue; }

    const row = await prisma.yearlyReport.create({
      data: {
        world_id:            worldId,
        year:                y,
        population_start:    avgPopStart,
        population_end:      endPopulation,
        births:              0,
        deaths:              deathsPerYear,
        deaths_by_cause:     deathsByCause,
        market_index_start:  startMarket,
        market_index_end:    updated.market_index,
        force_scores:        (updated.global_traits as object),
      },
    });
    reports.push(row);
  }

  return {
    previous_year:  startYear,
    current_year:   updated.current_year,
    deaths:         dying.map(d => d.name),
    yearly_reports: reports,
  };
}

// ── Birthday-triggered life-decade compression ─────────────────────
// For each person who crosses an age boundary at a multiple of 10 during
// this advance, fire compressLifeDecade so the just-completed decade is
// snapshotted to LifeDecadeSummary and raw memories are trimmed.
//
// Age math: a person starts at age A_0. After advancing Y years they are
// at A_1 = min(death_age, A_0 + Y). They crossed boundary k (where k*10
// > A_0 and k*10 <= A_1) exactly when age passed k*10. We emit one
// compression per crossed boundary, oldest-first so chain continuity is
// preserved for subsequent decades.
async function compressBirthdayCrossings(
  worldId:       string,
  startYear:     number,
  years:         number,
  tier:          import('@prisma/client').PopulationTier,
): Promise<void> {
  // NOTE: this pulls age+death_age per person for everyone who actually
  // crossed any boundary. It doesn't pull bodies. For 5k people that's
  // one ~40kB query.
  const crossers = await prisma.person.findMany({
    where: {
      world_id: worldId,
      age: { gte: 10 },
    },
    select: { id: true, age: true, death_age: true },
  });

  const { compressLifeDecade } = await import('./memory.service');

  for (const p of crossers) {
    const oldAge = Math.max(0, Math.min(p.death_age, p.age - years));
    const newAge = p.age;
    // Boundaries crossed: every multiple of 10 in (oldAge, newAge].
    for (let boundary = Math.floor(oldAge / 10) * 10 + 10; boundary <= newAge; boundary += 10) {
      await compressLifeDecade({
        personId:     p.id,
        decadeEndAge: boundary,
        // Approximate: world-year at the moment this boundary was crossed.
        worldYearEnd: startYear + (boundary - oldAge),
        tier,
      });
    }
  }
}

// ── Rewind time ────────────────────────────────────────────────────────────

export async function rewindTime(years: number) {
  if (years < 1) throw new Error('Must rewind at least 1 year');

  const world = await getActiveWorld();
  const worldId = world.id;
  const newYear = Math.max(1, world.current_year - years);
  const actualRewind = world.current_year - newYear;

  await prisma.$executeRaw`
    UPDATE persons
    SET age = GREATEST(age - ${actualRewind}, 0),
        updated_at = NOW()
    WHERE world_id = ${worldId}::uuid
  `;

  const updated = await prisma.world.update({
    where: { id: worldId },
    data:  { current_year: newYear },
  });

  return {
    previous_year: world.current_year,
    current_year:  updated.current_year,
    rewound_by:    actualRewind,
  };
}

// ── Headlines retrieval ────────────────────────────────────────────────────

export async function getHeadlines(opts: {
  type?:     'ANNUAL' | 'DECADE';
  category?: string;
  yearFrom?: number;
  yearTo?:   number;
}) {
  const worldId = await getActiveWorldId();

  return prisma.yearlyHeadline.findMany({
    where: {
      world_id: worldId,
      ...(opts.type     ? { type:     opts.type as any }     : {}),
      ...(opts.category ? { category: opts.category as any } : {}),
      ...(opts.yearFrom || opts.yearTo
        ? { year: { ...(opts.yearFrom ? { gte: opts.yearFrom } : {}), ...(opts.yearTo ? { lte: opts.yearTo } : {}) } }
        : {}),
    },
    orderBy: [{ year: 'desc' }, { category: 'asc' }],
  });
}
