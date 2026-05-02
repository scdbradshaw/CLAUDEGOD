// Phase 13a.11 — Demo seed.
//
// Run with `npm run db:seed` from packages/backend.
//
// Builds a deterministic, ready-to-poke demo world:
//   - World "Demo World", random_seed_root = DEMO_SEED_ROOT (fixed)
//   - One city ("Yourmomshouse"). The original plan asked for two
//     ("Gaysville" + "Yourmomshouse"); engine v1 advances only `cities[0]`
//     in runYearPhase, so the seed honors the engine assumption and leaves
//     the second-city demo to a follow-up that refactors the year pipeline.
//   - 20 real persons (mix of types), all pinned so they survive churn
//   - 1 faction ("Pink Triangle Brigade"), founder = first Soldier
//   - 1 religion ("Cathedral of the Red Door"), founder = first Priest
//   - 10 years pre-advanced via direct runYearPhase calls (no pg-boss)
//
// The script wipes any prior world matching DEMO_WORLD_NAME so reruns
// are idempotent.

import { prisma } from '../src/lib/prisma';
import { createWorld } from '../src/services/world.service';
import {
  materializeFromBucketTx,
  pinPerson,
} from '../src/services/person.service';
import { createGroupTx } from '../src/services/group.service';
import { runYearPhase } from '../src/services/year.service';
import { makeRng } from '../src/lib/rng';
import type { PersonType } from '@claude-god/shared';

const DEMO_WORLD_NAME = 'Demo World';
const DEMO_CITY_NAME = 'Yourmomshouse';
const DEMO_SEED_ROOT = 1234567890123n;
const DEMO_YEARS = 10;

// 20 real-person spawns by type. Tuned to give group recruitment something
// to chew on (a few Soldiers for the faction, a few Priests for the religion).
const SPAWN_PLAN: PersonType[] = [
  'Farmer', 'Farmer', 'Farmer', 'Farmer',
  'Laborer', 'Laborer', 'Laborer',
  'Artisan', 'Artisan',
  'Merchant', 'Merchant',
  'Soldier', 'Soldier',
  'Priest', 'Priest',
  'Scholar', 'Scholar',
  'Noble',
  'Outlaw',
  'Healer',
];

async function wipeExisting(): Promise<void> {
  const prior = await prisma.world.findMany({
    where: { name: DEMO_WORLD_NAME },
    select: { id: true },
  });
  if (prior.length === 0) return;
  // Cascade rules on World drop everything underneath.
  await prisma.world.deleteMany({
    where: { id: { in: prior.map((w) => w.id) } },
  });
  console.log(`  • wiped ${prior.length} prior demo world(s)`);
}

async function main(): Promise<void> {
  console.log(`Seeding "${DEMO_WORLD_NAME}" (seed=${DEMO_SEED_ROOT})…`);

  await wipeExisting();

  // 1. World + city + buckets.
  const { world, city } = await createWorld({
    name: DEMO_WORLD_NAME,
    city_name: DEMO_CITY_NAME,
    region_resource: 'farmland',
    seed_population: 10_000,
    random_seed_root: DEMO_SEED_ROOT,
  });
  console.log(`  • world ${world.id.slice(0, 8)} · city ${city.name}`);

  // 2. Materialize 20 real persons. Reuses the spawn helper used by churn.
  // We use a derived rng so the seed is fully deterministic.
  const spawnRng = makeRng(DEMO_SEED_ROOT ^ 0xa11n);
  const spawnedIds: string[] = [];
  for (const type of SPAWN_PLAN) {
    const created = await prisma.$transaction(async (tx) => {
      return materializeFromBucketTx(
        {
          world_id: world.id,
          city_id: city.id,
          type,
          year: 0,
          rng: spawnRng,
        },
        tx,
      );
    });
    spawnedIds.push(created.id);
  }
  console.log(`  • ${spawnedIds.length} real persons spawned`);

  // 3. Pin everyone so they survive demotion-overflow and stay visible.
  for (const id of spawnedIds) await pinPerson(id);
  console.log(`  • ${spawnedIds.length} persons pinned`);

  // 4. One faction + one religion. Founders = first matching type.
  const firstSoldier = await prisma.person.findFirst({
    where: { world_id: world.id, type: 'Soldier' },
    select: { id: true },
  });
  const firstPriest = await prisma.person.findFirst({
    where: { world_id: world.id, type: 'Priest' },
    select: { id: true },
  });

  await prisma.$transaction(async (tx) => {
    await createGroupTx(
      {
        world_id: world.id,
        kind: 'faction',
        name: 'Pink Triangle Brigade',
        founder_id: firstSoldier?.id ?? null,
        founded_year: 0,
        wanted_tags: ['ambitious', 'loyal', 'charismatic'],
        type_affinities: { Soldier: 1.6, Outlaw: 1.2, Noble: 1.1 },
        stat_floors: { combat_min: 40 },
        cost_per_year: 5,
        territory_cities: [city.id],
        tax_rate: 5,
        army_size: 0,
      },
      tx,
    );
    await createGroupTx(
      {
        world_id: world.id,
        kind: 'religion',
        name: 'Cathedral of the Red Door',
        founder_id: firstPriest?.id ?? null,
        founded_year: 0,
        wanted_tags: ['faithful', 'kind', 'loyal'],
        type_affinities: { Priest: 1.8, Healer: 1.3, Scholar: 1.1 },
        stat_floors: { intelligence_min: 40 },
        cost_per_year: 3,
      },
      tx,
    );
  });
  console.log('  • 1 faction + 1 religion founded');

  // 5. Advance 10 years. Skip pg-boss; create YearRun rows directly and
  // invoke runYearPhase for each. Each call manages its own transaction.
  console.log(`  • advancing ${DEMO_YEARS} years…`);
  for (let i = 1; i <= DEMO_YEARS; i++) {
    // Mix DEMO_SEED_ROOT with the year so each year's RNG context is stable.
    // Mask to signed int64 (Postgres BIGINT) — golden-ratio multiply overflows otherwise.
    const INT64_MAX = 0x7fffffffffffffffn;
    const yearSeed = (DEMO_SEED_ROOT ^ (BigInt(i) * 0x9e3779b97f4a7c15n)) & INT64_MAX;
    const run = await prisma.yearRun.create({
      data: {
        world_id: world.id,
        year: i,
        random_seed: yearSeed,
        status: 'pending',
      },
    });
    await runYearPhase(run.id);
    if (i % 5 === 0 || i === DEMO_YEARS) {
      const live = await prisma.person.count({
        where: { world_id: world.id, is_alive: true },
      });
      console.log(`    – year ${i} done · ${live} alive`);
    }
  }

  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
