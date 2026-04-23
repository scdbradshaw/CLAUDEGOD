// ============================================================
// TIME SERVICE
// Owns the active-world helper, manual rewind, and headline reads.
// Year advancement is owned by services/year.service.ts (async
// pg-boss pipeline). The legacy synchronous advanceTime() was
// removed in Phase 7 cleanup.
// ============================================================

import prisma from '../db/client';
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
        total_deaths:             0,
        market_index:             1.0,
        market_trend:             0.018,
        market_volatility:        0.05,
        market_stable_index:      1.0,
        market_stable_trend:      0.012,
        market_stable_volatility: 0.015,
        market_volatile_index:    1.0,
        market_volatile_trend:    0.04,
        market_volatile_volatility: 0.20,
        market_history:           [],
        market_highlights:        {},
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
