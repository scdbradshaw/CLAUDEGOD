// ============================================================
// TIME SERVICE
// Manages the world calendar — advance, rewind, and aging
// ============================================================

import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { generateHeadlinesForYear, compressOldDecades } from './headlines.service';
import { DEFAULT_GLOBAL_TRAITS, DEFAULT_GLOBAL_TRAIT_MULTIPLIERS } from '@civ-sim/shared';

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
    await prisma.$transaction([
      prisma.person.update({
        where: { id: char.id },
        data:  { health: 0 },
      }),
      prisma.memoryBank.create({
        data: {
          person_id:       char.id,
          event_summary:   `${char.name} passed away at age ${char.age}, having lived the full span of their years.`,
          emotional_impact: 'traumatic',
          delta_applied:   { health: -char.age },
          world_year:      startYear + years - 1,
          tone:            'literary',
        },
      }),
    ]);
  }

  // 3. Advance world year
  const updated = await prisma.world.update({
    where: { id: worldId },
    data:  { current_year: startYear + years },
  });

  // 4. Generate headlines for each year just completed (cap 10)
  const yearsToChronicle = Math.min(years, 10);
  const headlines: Awaited<ReturnType<typeof generateHeadlinesForYear>>[] = [];

  for (let y = startYear; y < startYear + yearsToChronicle; y++) {
    const yh = await generateHeadlinesForYear(y, worldId);
    headlines.push(yh);
  }

  // 5. Compress decades older than 10 years
  await compressOldDecades(updated.current_year, worldId);

  return {
    previous_year:       startYear,
    current_year:        updated.current_year,
    deaths:              dying.map(d => d.name),
    headlines_generated: headlines.flat().length,
  };
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
