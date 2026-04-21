// ============================================================
// CITIES SERVICE — Phase 7 Wave 1
// Every world has exactly one City. This service ensures one
// exists for a given world and supplies stat reads.
// ============================================================

import prisma from '../db/client';

/**
 * Name generator for the default city when a world is first created.
 * Keeps the feel consistent with the name-data in character-gen.service —
 * flavour over realism. Falls back to the world name if everything misfires.
 */
const CITY_PREFIXES = [
  'New', 'Old', 'High', 'Low', 'Fort', 'Port',
  'West', 'East', 'South', 'North', 'Upper', 'Lower',
];
const CITY_STEMS = [
  'Hallow', 'Ember', 'Ash', 'Hollow', 'Grim', 'Gale', 'Thorn',
  'Gloom', 'Mere', 'Stone', 'Iron', 'Silver', 'Oak', 'Raven',
  'Wolf', 'Briar', 'Dusk', 'Frost', 'Storm', 'Tide',
];
const CITY_SUFFIXES = [
  'hold', 'gate', 'haven', 'reach', 'crest', 'fell',
  'moor', 'wick', 'ford', 'burgh', 'mere', 'crag',
];

function randomCityName(): string {
  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
  // 50/50 between "Prefix Stemsuffix" and "Stemsuffix" — the latter reads
  // more like a singular capital, the former like a colony town.
  if (Math.random() < 0.5) {
    return `${pick(CITY_PREFIXES)} ${pick(CITY_STEMS)}${pick(CITY_SUFFIXES)}`;
  }
  return `${pick(CITY_STEMS)}${pick(CITY_SUFFIXES)}`;
}

/**
 * Returns the single City attached to a world, creating one on first call.
 * Used anywhere the UI or backend needs the world's geographic anchor.
 *
 * We treat this as the "default city" for the world; when multi-city ships,
 * this is the one Person rows will be auto-assigned to on creation.
 */
export async function getOrCreateDefaultCity(worldId: string) {
  const existing = await prisma.city.findUnique({ where: { world_id: worldId } });
  if (existing) return existing;

  const world = await prisma.world.findUniqueOrThrow({ where: { id: worldId } });
  return prisma.city.create({
    data: {
      name:         randomCityName(),
      founded_year: Math.max(1, world.current_year),
      world_id:     worldId,
    },
  });
}

/**
 * Read-only stat pull for the Dashboard "City" card and the Rip page badge.
 * `dead_total` counts the DeceasedPerson archive since the world's inception —
 * Phase 7 obituary view wants a running tombstone count, not just the archive
 * page limit.
 */
export async function getCityWithStats(worldId: string) {
  const city = await getOrCreateDefaultCity(worldId);
  const [population, dead_total] = await Promise.all([
    prisma.person.count({ where: { world_id: worldId, health: { gt: 0 } } }),
    prisma.deceasedPerson.count({ where: { world_id: worldId } }),
  ]);
  return {
    ...city,
    population,
    dead_total,
  };
}
