// ============================================================
// TIME SERVICE
// Manages the world calendar — advance, rewind, and aging
// ============================================================

import prisma from '../db/client';
import { generateHeadlinesForYear, compressOldDecades } from './headlines.service';
import { DEFAULT_ACTIVE_CATEGORIES, DEFAULT_GLOBAL_TRAITS, DEFAULT_GLOBAL_TRAIT_MULTIPLIERS } from '@civ-sim/shared';

// ── World state (singleton) ────────────────────────────────────────────────

export async function getWorldState() {
  let state = await prisma.worldState.findFirst();
  if (!state) {
    state = await prisma.worldState.create({
      data: {
        current_year:             1,
        active_trait_categories:  DEFAULT_ACTIVE_CATEGORIES,
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
  return state;
}

// ── Advance time ───────────────────────────────────────────────────────────

export async function advanceTime(years: number) {
  if (years < 1) throw new Error('Must advance at least 1 year');
  if (years > 500) throw new Error('Cannot advance more than 500 years at once');

  const state = await getWorldState();
  const startYear = state.current_year;

  // 1. Age all characters (capped at lifespan)
  await prisma.$executeRaw`
    UPDATE persons
    SET age = LEAST(age + ${years}, lifespan),
        updated_at = NOW()
  `;

  // 2. Detect and record deaths (age reached lifespan, health still > 0)
  const dying: Array<{ id: string; name: string; age: number; lifespan: number }> =
    await prisma.$queryRaw`
      SELECT id, name, age, lifespan
      FROM persons
      WHERE age >= lifespan AND health > 0
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
        },
      }),
    ]);
  }

  // 3. Advance world year
  const newState = await prisma.worldState.update({
    where: { id: state.id },
    data:  { current_year: startYear + years },
  });

  // 4. Generate headlines for each year just completed
  //    (cap at 10 years to avoid extremely long waits; rest get skipped)
  const yearsToChronicle = Math.min(years, 10);
  const headlines: Awaited<ReturnType<typeof generateHeadlinesForYear>>[] = [];

  for (let y = startYear; y < startYear + yearsToChronicle; y++) {
    const yh = await generateHeadlinesForYear(y);
    headlines.push(yh);
  }

  // 5. Compress decades older than 10 years
  await compressOldDecades(newState.current_year);

  return {
    previous_year: startYear,
    current_year:  newState.current_year,
    deaths:        dying.map(d => d.name),
    headlines_generated: headlines.flat().length,
  };
}

// ── Rewind time ────────────────────────────────────────────────────────────

export async function rewindTime(years: number) {
  if (years < 1) throw new Error('Must rewind at least 1 year');

  const state = await getWorldState();
  const newYear = Math.max(1, state.current_year - years);
  const actualRewind = state.current_year - newYear;

  // De-age all characters (floor at 0)
  await prisma.$executeRaw`
    UPDATE persons
    SET age = GREATEST(age - ${actualRewind}, 0),
        updated_at = NOW()
  `;

  const newState = await prisma.worldState.update({
    where: { id: state.id },
    data:  { current_year: newYear },
  });

  return {
    previous_year: state.current_year,
    current_year:  newState.current_year,
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
  return prisma.yearlyHeadline.findMany({
    where: {
      ...(opts.type     ? { type:     opts.type as any }     : {}),
      ...(opts.category ? { category: opts.category as any } : {}),
      ...(opts.yearFrom || opts.yearTo
        ? { year: { ...(opts.yearFrom ? { gte: opts.yearFrom } : {}), ...(opts.yearTo ? { lte: opts.yearTo } : {}) } }
        : {}),
    },
    orderBy: [{ year: 'desc' }, { category: 'asc' }],
  });
}
