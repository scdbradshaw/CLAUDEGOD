// World seeding service (Phase 2).
//
// Mirrors DESIGN.md §3 (geography), §4.2 (NPC types), §12 (buckets),
// §13 (city), and §15.2.1 (random_seed_root).
//
// Two layers:
//   1. `buildWorldSeed(input)` — pure function. Computes the world + city +
//      buckets data structure from the input, deterministic on
//      `random_seed_root`. No DB. Unit-tested in isolation.
//   2. `createWorld(input)` — persists the seed via Prisma in a single
//      transaction. Returns the saved rows.

import {
  PERSON_TYPES,
  RACES,
  type PersonType,
  type Race,
  type RegionResource,
  type RaceShares,
  type PersonalityTagFreqs,
  type BucketStateTagFreqs,
} from '@claude-god/shared';
import { prisma } from '../lib/prisma';
import { makeRng, randomSeedRoot, type Rng } from '../lib/rng';

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_SEED_POPULATION = 10_000;
export const DEFAULT_REGION_RESOURCE: RegionResource = 'farmland';
export const DEFAULT_CITY_X = 50;
export const DEFAULT_CITY_Y = 50;

// ─── Type seeding profiles ───────────────────────────────────────────────────

/** Base population share per type. Sums to 1.0. */
const TYPE_POPULATION_RATIOS: Record<PersonType, number> = {
  Farmer: 0.38,
  Laborer: 0.22,
  Artisan: 0.12,
  Soldier: 0.08,
  Merchant: 0.07,
  Priest: 0.04,
  Noble: 0.03,
  Outlaw: 0.03,
  Scholar: 0.02,
  Healer: 0.01,
};

/** Per-type stat baselines. Jittered ±5% at seed time. */
interface TypeStatBase {
  wealth: number;
  intelligence: number;
  combat: number;
  health: number;
  happiness: number;
  sexuality: number;
  age: number;
  birthRate: number;
  deathRate: number;
}

const TYPE_STAT_BASES: Record<PersonType, TypeStatBase> = {
  // Differentiated per role: Farmers dumb+strong+poor, Scholars brilliant+frail,
  // Nobles wealthy+long-lived, Outlaws short-lived+unhappy, Healers smart+healthy.
  Farmer:   { wealth: 25,  intelligence: 28, combat: 30, health: 60, happiness: 45, sexuality: 70, age: 32, birthRate: 0.035, deathRate: 0.020 },
  Laborer:  { wealth: 35,  intelligence: 38, combat: 48, health: 55, happiness: 38, sexuality: 70, age: 30, birthRate: 0.028, deathRate: 0.022 },
  Artisan:  { wealth: 70,  intelligence: 55, combat: 25, health: 60, happiness: 58, sexuality: 70, age: 33, birthRate: 0.022, deathRate: 0.018 },
  Merchant: { wealth: 120, intelligence: 68, combat: 18, health: 65, happiness: 65, sexuality: 70, age: 35, birthRate: 0.018, deathRate: 0.015 },
  Soldier:  { wealth: 45,  intelligence: 42, combat: 75, health: 65, happiness: 48, sexuality: 70, age: 26, birthRate: 0.016, deathRate: 0.032 },
  Priest:   { wealth: 40,  intelligence: 58, combat: 12, health: 68, happiness: 72, sexuality: 55, age: 40, birthRate: 0.010, deathRate: 0.014 },
  Scholar:  { wealth: 55,  intelligence: 80, combat: 12, health: 62, happiness: 62, sexuality: 65, age: 38, birthRate: 0.012, deathRate: 0.016 },
  Noble:    { wealth: 350, intelligence: 62, combat: 55, health: 75, happiness: 62, sexuality: 70, age: 42, birthRate: 0.016, deathRate: 0.012 },
  Outlaw:   { wealth: 18,  intelligence: 48, combat: 62, health: 42, happiness: 28, sexuality: 70, age: 27, birthRate: 0.028, deathRate: 0.045 },
  Healer:   { wealth: 65,  intelligence: 72, combat: 10, health: 78, happiness: 68, sexuality: 65, age: 36, birthRate: 0.014, deathRate: 0.012 },
};

// ─── Region resource biases (§3.1) ───────────────────────────────────────────

/** Multipliers applied to TYPE_POPULATION_RATIOS, then re-normalized. */
const REGION_BIAS: Record<RegionResource, Partial<Record<PersonType, number>>> = {
  farmland:   { Farmer: 1.8, Laborer: 0.8, Healer: 1.2 },
  coast:      { Merchant: 1.8, Laborer: 1.4, Soldier: 1.3 },
  mountains:  { Soldier: 1.6, Artisan: 1.4, Laborer: 1.4, Scholar: 1.4 },
  forest:     { Laborer: 1.4, Outlaw: 1.4, Farmer: 1.3 },
  desert:     { Merchant: 1.6, Healer: 1.3, Priest: 1.4 },
  crossroads: { Merchant: 1.6, Artisan: 1.4, Laborer: 1.3, Noble: 1.3 },
};

// ─── Personality tag base frequencies (per type) ─────────────────────────────
// Each tag is independent (1–3 per person, §5.1), so these don't sum to 1.
// Per-type frequencies replace the old flat global base — Farmers are humble
// and faithful, Outlaws are cruel and reckless, Nobles are proud and ambitious,
// etc. Each value is the probability that a freshly-materialized member of the
// type carries that tag; ±10% jitter applied at seed time.

const TYPE_PERSONALITY_FREQS: Record<PersonType, PersonalityTagFreqs> = {
  Farmer:   { ambitious: 0.05, cruel: 0.06, kind: 0.28, greedy: 0.08, loyal: 0.30, vengeful: 0.10, charismatic: 0.10, faithful: 0.28, cunning: 0.06, stoic: 0.18, paranoid: 0.08, lazy: 0.18, brave: 0.16, reckless: 0.06, proud: 0.08, diligent: 0.32 },
  Laborer:  { ambitious: 0.12, cruel: 0.12, kind: 0.18, greedy: 0.14, loyal: 0.22, vengeful: 0.14, charismatic: 0.10, faithful: 0.12, cunning: 0.10, stoic: 0.16, paranoid: 0.10, lazy: 0.20, brave: 0.18, reckless: 0.14, proud: 0.10, diligent: 0.24 },
  Artisan:  { ambitious: 0.18, cruel: 0.06, kind: 0.18, greedy: 0.18, loyal: 0.22, vengeful: 0.08, charismatic: 0.14, faithful: 0.12, cunning: 0.14, stoic: 0.16, paranoid: 0.08, lazy: 0.10, brave: 0.12, reckless: 0.06, proud: 0.22, diligent: 0.30 },
  Merchant: { ambitious: 0.28, cruel: 0.08, kind: 0.08, greedy: 0.35, loyal: 0.14, vengeful: 0.08, charismatic: 0.20, faithful: 0.06, cunning: 0.30, stoic: 0.10, paranoid: 0.18, lazy: 0.06, brave: 0.10, reckless: 0.10, proud: 0.18, diligent: 0.18 },
  Soldier:  { ambitious: 0.22, cruel: 0.22, kind: 0.06, greedy: 0.08, loyal: 0.30, vengeful: 0.16, charismatic: 0.08, faithful: 0.08, cunning: 0.10, stoic: 0.22, paranoid: 0.16, lazy: 0.08, brave: 0.35, reckless: 0.22, proud: 0.20, diligent: 0.20 },
  Priest:   { ambitious: 0.08, cruel: 0.03, kind: 0.28, greedy: 0.06, loyal: 0.18, vengeful: 0.06, charismatic: 0.22, faithful: 0.38, cunning: 0.06, stoic: 0.20, paranoid: 0.06, lazy: 0.10, brave: 0.08, reckless: 0.04, proud: 0.10, diligent: 0.22 },
  Scholar:  { ambitious: 0.22, cruel: 0.04, kind: 0.16, greedy: 0.10, loyal: 0.12, vengeful: 0.06, charismatic: 0.14, faithful: 0.22, cunning: 0.20, stoic: 0.18, paranoid: 0.14, lazy: 0.12, brave: 0.06, reckless: 0.04, proud: 0.18, diligent: 0.28 },
  Noble:    { ambitious: 0.30, cruel: 0.18, kind: 0.06, greedy: 0.24, loyal: 0.16, vengeful: 0.12, charismatic: 0.18, faithful: 0.04, cunning: 0.28, stoic: 0.16, paranoid: 0.22, lazy: 0.14, brave: 0.18, reckless: 0.16, proud: 0.40, diligent: 0.10 },
  Outlaw:   { ambitious: 0.16, cruel: 0.30, kind: 0.04, greedy: 0.30, loyal: 0.10, vengeful: 0.26, charismatic: 0.08, faithful: 0.04, cunning: 0.30, stoic: 0.08, paranoid: 0.20, lazy: 0.16, brave: 0.28, reckless: 0.32, proud: 0.06, diligent: 0.04 },
  Healer:   { ambitious: 0.06, cruel: 0.01, kind: 0.40, greedy: 0.05, loyal: 0.18, vengeful: 0.04, charismatic: 0.18, faithful: 0.30, cunning: 0.08, stoic: 0.20, paranoid: 0.10, lazy: 0.10, brave: 0.08, reckless: 0.04, proud: 0.08, diligent: 0.26 },
};

// ─── Pure seeding logic ──────────────────────────────────────────────────────

export interface WorldSeedInput {
  name: string;
  city_name: string;
  region_resource?: RegionResource;
  seed_population?: number;
  random_seed_root?: bigint;
}

export interface WorldSeedData {
  world: {
    name: string;
    current_year: number;
    market_index: number;
    market_trend: number;
    random_seed_root: bigint;
    prejudice_against_same_sex: boolean;
  };
  city: {
    name: string;
    x: number;
    y: number;
    founded_year: number;
    region_resource: RegionResource;
    population_total: number;
    avg_wealth: number;
    mood_score: number;
    defense_rating: number;
    treasury: number;
    tax_rate: number;
    garrison_size: number;
    prejudice_level: number;
  };
  buckets: BucketSeed[];
}

export interface BucketSeed {
  type: PersonType;
  count: number;
  avg_age: number;
  birth_rate: number;
  death_rate: number;
  race_shares: RaceShares;
  avg_wealth: number;
  avg_intelligence: number;
  avg_combat: number;
  avg_health: number;
  avg_happiness: number;
  avg_sexuality: number;
  religion_shares: Record<string, number>;
  faction_shares: Record<string, number>;
  personality_tag_freqs: PersonalityTagFreqs;
  state_tag_freqs: BucketStateTagFreqs;
}

/**
 * Compute the unsaved world + city + buckets data deterministically from the
 * input. Pure function — no DB, no clock, no Math.random outside the rng.
 */
export function buildWorldSeed(input: WorldSeedInput): WorldSeedData {
  const region: RegionResource = input.region_resource ?? DEFAULT_REGION_RESOURCE;
  const totalPop = input.seed_population ?? DEFAULT_SEED_POPULATION;
  const seedRoot = input.random_seed_root ?? randomSeedRoot();
  const rng = makeRng(seedRoot);

  const buckets = seedBuckets(totalPop, region, rng);

  const populationTotal = buckets.reduce((sum, b) => sum + b.count, 0);
  const avgWealth =
    populationTotal === 0
      ? 0
      : Math.round(
          buckets.reduce((sum, b) => sum + b.avg_wealth * b.count, 0) / populationTotal,
        );
  const moodScore =
    populationTotal === 0
      ? 50
      : buckets.reduce((sum, b) => sum + b.avg_happiness * b.count, 0) / populationTotal;

  return {
    world: {
      name: input.name,
      current_year: 0,
      market_index: 1.0,
      market_trend: 0.0,
      random_seed_root: seedRoot,
      prejudice_against_same_sex: false,
    },
    city: {
      name: input.city_name,
      x: DEFAULT_CITY_X,
      y: DEFAULT_CITY_Y,
      founded_year: 0,
      region_resource: region,
      population_total: populationTotal,
      avg_wealth: avgWealth,
      mood_score: Math.round(moodScore * 100) / 100,
      defense_rating: 50,
      treasury: 0,
      tax_rate: 10,
      garrison_size: 0,
      prejudice_level: 0,
    },
    buckets,
  };
}

/** Seed all 10 type buckets for one city. Deterministic on the rng. */
function seedBuckets(totalPop: number, region: RegionResource, rng: Rng): BucketSeed[] {
  // Apply region bias to base ratios, then normalize.
  const bias = REGION_BIAS[region];
  const biasedRatios: Record<PersonType, number> = { ...TYPE_POPULATION_RATIOS };
  for (const t of PERSON_TYPES) {
    biasedRatios[t] = TYPE_POPULATION_RATIOS[t] * (bias[t] ?? 1.0);
  }
  const ratioSum = PERSON_TYPES.reduce((s, t) => s + biasedRatios[t], 0);

  // Allocate counts via largest-remainder rounding so the total matches exactly.
  const exact: Record<PersonType, number> = {} as Record<PersonType, number>;
  const floored: Record<PersonType, number> = {} as Record<PersonType, number>;
  let allocated = 0;
  for (const t of PERSON_TYPES) {
    exact[t] = (biasedRatios[t] / ratioSum) * totalPop;
    floored[t] = Math.floor(exact[t]);
    allocated += floored[t];
  }
  let remainder = totalPop - allocated;
  // Distribute the remainder to the types with the largest fractional parts.
  const byFraction = [...PERSON_TYPES].sort(
    (a, b) => (exact[b] - floored[b]) - (exact[a] - floored[a]),
  );
  for (const t of byFraction) {
    if (remainder <= 0) break;
    floored[t] += 1;
    remainder -= 1;
  }

  return PERSON_TYPES.map((type) => seedBucket(type, floored[type], rng));
}

function seedBucket(type: PersonType, count: number, rng: Rng): BucketSeed {
  const base = TYPE_STAT_BASES[type];

  return {
    type,
    count,
    avg_age: round2(base.age * rng.jitterFactor(0.05)),
    birth_rate: round4(base.birthRate * rng.jitterFactor(0.05)),
    death_rate: round4(base.deathRate * rng.jitterFactor(0.05)),
    race_shares: seedRaceShares(rng),
    avg_wealth: Math.max(0, Math.round(base.wealth * rng.jitterFactor(0.05))),
    avg_intelligence: round2(clamp(base.intelligence * rng.jitterFactor(0.05), 0, 100)),
    avg_combat: round2(clamp(base.combat * rng.jitterFactor(0.05), 0, 100)),
    avg_health: round2(clamp(base.health * rng.jitterFactor(0.05), 0, 100)),
    avg_happiness: round2(clamp(base.happiness * rng.jitterFactor(0.05), 0, 100)),
    avg_sexuality: round2(clamp(base.sexuality * rng.jitterFactor(0.05), 0, 100)),
    religion_shares: {},
    faction_shares: {},
    personality_tag_freqs: seedPersonalityTagFreqs(rng, type),
    state_tag_freqs: {},
  };
}

/**
 * 10 races × ~10% with seeded jitter, then normalized.
 * Phase-2 test asserts every share is within ±2% of 0.10 — jitter is tuned
 * to stay inside that band.
 */
function seedRaceShares(rng: Rng): RaceShares {
  const weights: Record<Race, number> = {} as Record<Race, number>;
  for (const r of RACES) {
    // Jitter ±10% around 1.0 → after normalization, ±~1% around 0.10.
    weights[r] = rng.jitterFactor(0.10);
  }
  const sum = RACES.reduce((s, r) => s + weights[r], 0);
  const out: RaceShares = {};
  for (const r of RACES) {
    out[r] = round4(weights[r] / sum);
  }
  return out;
}

function seedPersonalityTagFreqs(rng: Rng, type: PersonType): PersonalityTagFreqs {
  const out = { ...TYPE_PERSONALITY_FREQS[type] };
  for (const k of Object.keys(out) as (keyof PersonalityTagFreqs)[]) {
    out[k] = round4(clamp(out[k] * rng.jitterFactor(0.10), 0, 1));
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round2(n: number): number { return Math.round(n * 100) / 100; }
function round4(n: number): number { return Math.round(n * 10000) / 10000; }

// ─── Persistence ─────────────────────────────────────────────────────────────

export async function createWorld(input: WorldSeedInput) {
  const seed = buildWorldSeed(input);

  return prisma.$transaction(async (tx) => {
    const world = await tx.world.create({ data: seed.world });
    const city = await tx.city.create({
      data: { ...seed.city, world_id: world.id },
    });
    await tx.bucket.createMany({
      data: seed.buckets.map((b) => ({
        city_id: city.id,
        type: b.type,
        count: b.count,
        avg_age: b.avg_age,
        birth_rate: b.birth_rate,
        death_rate: b.death_rate,
        race_shares: b.race_shares,
        avg_wealth: b.avg_wealth,
        avg_intelligence: b.avg_intelligence,
        avg_combat: b.avg_combat,
        avg_health: b.avg_health,
        avg_happiness: b.avg_happiness,
        avg_sexuality: b.avg_sexuality,
        religion_shares: b.religion_shares,
        faction_shares: b.faction_shares,
        personality_tag_freqs: b.personality_tag_freqs,
        state_tag_freqs: b.state_tag_freqs,
      })),
    });
    const buckets = await tx.bucket.findMany({ where: { city_id: city.id } });
    return { world, city, buckets };
  });
}

export async function getWorld(id: string) {
  const world = await prisma.world.findUnique({
    where: { id },
    include: {
      cities: { include: { buckets: true } },
    },
  });
  if (!world) return null;
  // v1 has a single city per world; flatten for the response shape.
  const city = world.cities[0] ?? null;
  const buckets = city?.buckets ?? [];
  const { cities: _cities, ...worldFields } = world;
  return { world: worldFields, city, buckets };
}

/**
 * Patch a small set of player-mutable world fields (Phase 12, God Mode).
 * Only `name` and `prejudice_against_same_sex` are mutable here — the rest
 * are engine-managed.
 */
export async function updateWorld(
  id: string,
  patch: { name?: string; prejudice_against_same_sex?: boolean },
) {
  const world = await prisma.world.findUnique({ where: { id } });
  if (!world) return null;
  const updated = await prisma.world.update({
    where: { id },
    data: patch,
    select: {
      id: true,
      name: true,
      current_year: true,
      market_index: true,
      market_trend: true,
      prejudice_against_same_sex: true,
      created_at: true,
    },
  });
  return updated;
}

/**
 * List all worlds (latest first) for the WorldSetup picker. Returns a
 * compact summary — no buckets, no cities. The frontend uses this to
 * decide between "create new" vs "open existing".
 */
export async function listWorlds() {
  const rows = await prisma.world.findMany({
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      name: true,
      current_year: true,
      market_index: true,
      created_at: true,
    },
  });
  return rows;
}
