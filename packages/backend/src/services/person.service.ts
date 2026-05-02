// Person service (Phase 5).
//
// Persistence layer for real persons. Pin/unpin, list, get, materialize
// (sample + create), archive (write BiographyArchive + delete Person).
//
// All cap enforcement and pin-overflow happen here, so the route handler
// can stay thin. Two-tier sync rules from DESIGN.md §19:
//   - Materialize:    bucket.count UNCHANGED (just changes layer)
//   - Real death:     bucket.count − 1 (decedent leaves the population)
//   - Demote (alive): bucket.count UNCHANGED

import { randomUUID } from 'node:crypto';
import type { Person, Prisma, PrismaClient } from '@prisma/client';
import {
  REAL_PERSON_CAP,
  type PersonalityTag,
  type Race,
  type RaceShares,
  type PersonalityTagFreqs,
  type DeathCause,
  type GroupShares,
} from '@claude-god/shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { samplePerson } from '../engine/materialization';
import { executeInheritanceTx } from './inheritance.service';
import { makeRng, type Rng } from '../lib/rng';
import type { PersonType } from '@claude-god/shared';
import type { BucketState } from '../engine/bucket-dynamics/types';
import {
  generateBackstory,
  type BackstoryPeer,
} from '../engine/promotion-backstory';
import { sampleAffiliation } from '../engine/groups/sample-affiliation';

export interface MaterializeFromBucketInput {
  world_id: string;
  city_id: string;
  type: PersonType;
  year: number;
  rng: Rng;
}

/**
 * Materialize a real person from a bucket. Reads the bucket row, samples
 * fields, inserts the Person row. Bucket.count is NOT changed (§19).
 *
 * Throws if the bucket is empty or if the cap would be exceeded. Caller
 * (the churn orchestrator + the pin route) is responsible for upstream
 * cap-overflow handling.
 */
export async function materializeFromBucket(
  input: MaterializeFromBucketInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<Person> {
  return materializeFromBucketTx(input, prisma);
}

/**
 * Inner version that runs against any Prisma client OR transaction client.
 * Use from within an outer `prisma.$transaction` to compose with the year
 * pipeline.
 */
export async function materializeFromBucketTx(
  input: MaterializeFromBucketInput,
  tx: PrismaClient | Prisma.TransactionClient,
): Promise<Person> {
  const bucket = await tx.bucket.findUnique({
    where: { city_id_type: { city_id: input.city_id, type: input.type } },
  });
  if (!bucket) throw new Error(`bucket_not_found: ${input.city_id} ${input.type}`);
  if (bucket.count <= 0) throw new Error(`bucket_empty: ${input.city_id} ${input.type}`);

  const aliveCount = await tx.person.count({
    where: { world_id: input.world_id, is_alive: true },
  });
  if (aliveCount >= REAL_PERSON_CAP) {
    throw new RealPersonCapError(aliveCount, REAL_PERSON_CAP);
  }

  const sampled = samplePerson({
    bucket: bucketRowToState(bucket),
    race_shares: (bucket.race_shares as RaceShares) ?? {},
    personality_tag_freqs: (bucket.personality_tag_freqs as PersonalityTagFreqs) ?? defaultTagFreqs(),
    year: input.year,
    rng: input.rng,
  });

  // Phase 6: backstory + bonds. Pick up to 20 same-city alive peers.
  const peerRows = await tx.person.findMany({
    where: {
      world_id: input.world_id,
      city_id: input.city_id,
      is_alive: true,
    },
    select: { id: true, age: true, gender: true, sexuality: true },
    take: 20,
  });
  const peers: BackstoryPeer[] = peerRows
    .filter((p): p is typeof p & { gender: 'male' | 'female' } =>
      p.gender === 'male' || p.gender === 'female')
    .map((p) => ({ id: p.id, age: p.age, gender: p.gender, sexuality: p.sexuality }));

  const cityRow = await tx.city.findUnique({
    where: { id: input.city_id },
    select: { name: true },
  });
  const cityName = cityRow?.name ?? 'the city';

  // Phase 7: sample group affiliation from bucket's shares (residual = unaffiliated).
  const factionId = sampleAffiliation(
    (bucket.faction_shares ?? {}) as GroupShares,
    input.rng,
  );
  const religionId = sampleAffiliation(
    (bucket.religion_shares ?? {}) as GroupShares,
    input.rng,
  );

  // Backstory + memories must be generated BEFORE the create so they can be
  // baked into the initial INSERT (saves a follow-up UPDATE round-trip per
  // promotion). The Person.id we need for `owner_id` on the bonds is set by
  // Postgres on insert — generate it client-side via uuid v4-equivalent so
  // we can pre-build the bond rows without a second DB hop. Prisma's default
  // `@default(uuid())` is server-side, but we can set the id explicitly.
  const newPersonId = randomUUID();
  const backstory = generateBackstory(
    {
      id: newPersonId,
      city_name: cityName,
      type: sampled.type,
      name: sampled.name,
      age: sampled.age,
      gender: sampled.gender,
      sexuality: sampled.sexuality,
    },
    peers,
    input.year,
    input.rng,
  );

  const created = await tx.person.create({
    data: {
      id: newPersonId,
      world_id: input.world_id,
      city_id: input.city_id,
      type: sampled.type,
      faction_id: factionId,
      religion_id: religionId,
      faction_joined_year: factionId != null ? input.year : null,
      religion_joined_year: religionId != null ? input.year : null,
      name: sampled.name,
      age: sampled.age,
      gender: sampled.gender,
      race: sampled.race,
      sexuality: sampled.sexuality,
      combat: sampled.combat,
      intelligence: sampled.intelligence,
      happiness: sampled.happiness,
      wealth: sampled.wealth,
      current_health: sampled.current_health,
      personality_tags: sampled.personality_tags,
      state_tags: [],
      is_alive: true,
      is_pinned: false,
      created_year: sampled.created_year,
      recent_memories: backstory.memories as unknown as Prisma.InputJsonValue,
      action_queue: [],
    },
  });

  if (backstory.bonds.length > 0) {
    await tx.relationship.createMany({
      data: backstory.bonds.map((b) => ({
        owner_id: created.id,
        target_id: b.target_id,
        kind: b.kind,
        strength: b.strength,
        set_year: b.set_year,
      })),
    });
  }
  return created;
}

export type DemotionReason = 'death' | 'demoted' | 'overflow';

export interface ArchiveAndDeleteInput {
  person_id: string;
  reason: DemotionReason;
  year: number;
  /** Optional cause-of-death (only meaningful when reason === 'death'). */
  death_cause?: DeathCause;
}

/**
 * Write a BiographyArchive row, decrement the bucket count if the reason
 * is `death` (only deaths affect the population total), and delete the
 * Person row. Inheritance distribution is deferred (Phase 6/7).
 */
export async function archiveAndDelete(
  input: ArchiveAndDeleteInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await archiveAndDeleteTx(input, tx);
  });
}

/**
 * Inner version that runs against an existing transaction client. Use this
 * from within `runYearPhase`'s tx so cap/bucket bookkeeping stays atomic
 * with the year-run row update.
 */
export async function archiveAndDeleteTx(
  input: ArchiveAndDeleteInput,
  tx: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const p = await tx.person.findUnique({ where: { id: input.person_id } });
  if (!p) return;

  // §7.4 — distribute inheritance BEFORE the row goes away. Only on death
  // (demoted/overflow demotions return the wealth to the bucket via existing
  // bucket-dynamics; no real-person heirs). After this returns, decedent's
  // wealth is zero (executeInheritanceTx zeroes it as the last step).
  let archiveWealth = p.wealth;
  if (input.reason === 'death' && p.wealth > 0) {
    await executeInheritanceTx(p.id, input.year, tx);
    // Don't re-read — inheritance always zeroes decedent.wealth on completion.
    archiveWealth = 0;
  }

  const memories = Array.isArray(p.recent_memories) ? p.recent_memories : [];
  const topMemories = (memories as Array<{ magnitude?: number }>)
    .slice()
    .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
    .slice(0, 5);

  await tx.biographyArchive.upsert({
    where: { person_id: p.id },
    update: {},
    create: {
      world_id: p.world_id,
      person_id: p.id,
      name: p.name,
      race: p.race,
      age_at_demote: p.age,
      type: p.type,
      personality_tags: p.personality_tags as PersonalityTag[],
      state_tags: (p.state_tags ?? []) as Prisma.InputJsonValue,
      wealth_at_demote: archiveWealth,
      mother_id: p.mother_id,
      father_id: p.father_id,
      spouse_id: p.spouse_id,
      faction_id: p.faction_id,
      religion_id: p.religion_id,
      top_memories: topMemories,
      was_criminal: false, // Phase 9 will track this
      demotion_reason: input.reason,
      demote_year: input.year,
    },
  });

  if (input.reason === 'death') {
    // §19: real-death decrements the bucket count. Use GREATEST(0, count-1)
    // to clamp at zero — churn-promoted persons that die later in the same
    // year pipeline would otherwise push count negative (§19 two-tier bug).
    await tx.$executeRaw`
      UPDATE "Bucket"
      SET count = GREATEST(0, count - 1)
      WHERE city_id = ${p.city_id}::text
        AND type = ${p.type}::"PersonType"
    `;
  }

  // For all reasons (death/demoted/overflow), drop the live row + its
  // decade summaries. The Relationship FK has onDelete: Cascade for both
  // owner_id and target_id, so the DB drops the bond rows when the Person
  // is deleted — saves an explicit deleteMany round-trip.
  await tx.lifeDecadeSummary.deleteMany({ where: { person_id: p.id } });
  await tx.person.delete({ where: { id: p.id } });
}

// ─── God-mode helpers (Phase 13a.12) ────────────────────────────────────────

export interface SummonPersonInput {
  world_id: string;
  city_id: string;
  type: PersonType;
  /** When true (default), the summoned person is auto-pinned. */
  pin?: boolean;
}

export type SummonPersonResult =
  | { kind: 'npc'; type: PersonType }
  | { kind: 'real'; id: string; name: string; type: PersonType; is_pinned: boolean };

/**
 * God-mode summon. Two modes:
 *   - pin=false (default): NPC — bump the bucket aggregate by 1, no Person row.
 *   - pin=true: Real — materialize a Person row, auto-pinned.
 */
export async function summonPerson(
  input: SummonPersonInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SummonPersonResult> {
  const world = await prisma.world.findUnique({
    where: { id: input.world_id },
    select: { current_year: true, random_seed_root: true },
  });
  if (!world) throw new Error('world_not_found');

  const pin = input.pin === true;

  // NPC mode: just bump the bucket aggregate.
  if (!pin) {
    const bucket = await prisma.bucket.findUnique({
      where: { city_id_type: { city_id: input.city_id, type: input.type } },
    });
    if (!bucket) throw new Error(`bucket_not_found: ${input.city_id} ${input.type}`);
    await prisma.bucket.update({
      where: { city_id_type: { city_id: input.city_id, type: input.type } },
      data: { count: { increment: 1 } },
    });
    return { kind: 'npc', type: input.type };
  }

  // Real mode: materialize a Person row, auto-pin.
  // Mix world seed + Date.now so repeated summons of the same type vary.
  const seed = (world.random_seed_root ^ BigInt(Date.now())) & 0x7fffffffffffffffn;
  const rng = makeRng(seed);

  return prisma.$transaction(async (tx) => {
    const bucket = await tx.bucket.findUnique({
      where: { city_id_type: { city_id: input.city_id, type: input.type } },
    });
    if (!bucket) throw new Error(`bucket_not_found: ${input.city_id} ${input.type}`);
    // God-summons add to the population. Bump the bucket count by 1 BEFORE
    // materializing so the new person is reflected in the bucket aggregate
    // (otherwise next year's death/churn could drive count negative).
    await tx.bucket.update({
      where: { city_id_type: { city_id: input.city_id, type: input.type } },
      data: { count: { increment: 1 } },
    });
    const created = await materializeFromBucketTx(
      {
        world_id: input.world_id,
        city_id: input.city_id,
        type: input.type,
        year: world.current_year,
        rng,
      },
      tx,
    );
    await tx.person.update({
      where: { id: created.id },
      data: { is_pinned: true },
    });
    return {
      kind: 'real',
      id: created.id,
      name: created.name,
      type: created.type as PersonType,
      is_pinned: true,
    };
  });
}

/**
 * God-mode: kill a real person. Routes through archiveAndDeleteTx with
 * reason=`death` so inheritance, bucket decrement, and bio archive all
 * fire correctly.
 */
export async function killPerson(
  personId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ id: string; year: number }> {
  return prisma.$transaction(async (tx) => {
    const p = await tx.person.findUnique({
      where: { id: personId },
      select: { id: true, world_id: true, is_alive: true },
    });
    if (!p) throw new Error('person_not_found');
    if (!p.is_alive) throw new Error('person_already_dead');
    const world = await tx.world.findUnique({
      where: { id: p.world_id },
      select: { current_year: true },
    });
    if (!world) throw new Error('world_not_found');
    await archiveAndDeleteTx(
      { person_id: p.id, reason: 'death', year: world.current_year, death_cause: 'event' },
      tx,
    );
    return { id: p.id, year: world.current_year };
  });
}

// ─── Bulk god-mode (Phase 13a.13) ───────────────────────────────────────────
//
// Optimized for 10k-scale operations. Skips per-person backstory bonds and
// inheritance — bulk god intervention conjures and erases en masse, not as
// fully-narrated lives. Caller still sees REAL_PERSON_CAP enforced.

const BULK_SUMMON_HARD_CAP = 10_000;
const BULK_KILL_HARD_CAP = 10_000;
const BULK_CHUNK_SIZE = 500;

export interface BulkSummonInput {
  world_id: string;
  city_id: string;
  type: PersonType;
  count: number;
  pin?: boolean;
}

export interface BulkSummonResult {
  requested: number;
  created: number;
  skipped_for_cap: number;
}

export async function summonManyPersons(
  input: BulkSummonInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<BulkSummonResult> {
  const requested = Math.max(0, Math.min(input.count, BULK_SUMMON_HARD_CAP));

  const world = await prisma.world.findUnique({
    where: { id: input.world_id },
    select: { current_year: true, random_seed_root: true },
  });
  if (!world) throw new Error('world_not_found');

  const bucket = await prisma.bucket.findUnique({
    where: { city_id_type: { city_id: input.city_id, type: input.type } },
  });
  if (!bucket) throw new Error(`bucket_not_found: ${input.city_id} ${input.type}`);

  // NPC mode (pin=false): just inflate the bucket aggregate. No Person rows,
  // so REAL_PERSON_CAP doesn't apply.
  const pin = input.pin === true;
  if (!pin) {
    if (requested === 0) return { requested: 0, created: 0, skipped_for_cap: 0 };
    await prisma.bucket.update({
      where: { city_id_type: { city_id: input.city_id, type: input.type } },
      data: { count: { increment: requested } },
    });
    return { requested, created: requested, skipped_for_cap: 0 };
  }

  const aliveCount = await prisma.person.count({
    where: { world_id: input.world_id, is_alive: true },
  });
  const slotsFree = Math.max(0, REAL_PERSON_CAP - aliveCount);
  const toCreate = Math.min(requested, slotsFree);

  if (toCreate === 0) {
    return { requested, created: 0, skipped_for_cap: requested };
  }

  // Stable per-call seed; mix with index for per-person variance.
  const baseSeed = (world.random_seed_root ^ BigInt(Date.now())) & 0x7fffffffffffffffn;
  const bucketState: BucketState = bucketRowToState(bucket);
  const raceShares = (bucket.race_shares as RaceShares) ?? {};
  const tagFreqs = (bucket.personality_tag_freqs as PersonalityTagFreqs) ?? defaultTagFreqs();
  const factionShares = (bucket.faction_shares ?? {}) as GroupShares;
  const religionShares = (bucket.religion_shares ?? {}) as GroupShares;
  // pin is hoisted from the early NPC branch above; here it is always true.

  let created = 0;
  // Process in chunks so we don't hold one tx open for 10k inserts.
  for (let chunkStart = 0; chunkStart < toCreate; chunkStart += BULK_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + BULK_CHUNK_SIZE, toCreate);
    const rows: Prisma.PersonCreateManyInput[] = [];
    for (let i = chunkStart; i < chunkEnd; i++) {
      const rng = makeRng((baseSeed ^ BigInt(i + 1) * 0x9e3779b97f4a7c15n) & 0x7fffffffffffffffn);
      const sampled = samplePerson({
        bucket: bucketState,
        race_shares: raceShares,
        personality_tag_freqs: tagFreqs,
        year: world.current_year,
        rng,
      });
      const factionId = sampleAffiliation(factionShares, rng);
      const religionId = sampleAffiliation(religionShares, rng);
      rows.push({
        world_id: input.world_id,
        city_id: input.city_id,
        type: sampled.type,
        faction_id: factionId,
        religion_id: religionId,
        faction_joined_year: factionId != null ? world.current_year : null,
        religion_joined_year: religionId != null ? world.current_year : null,
        name: sampled.name,
        age: sampled.age,
        gender: sampled.gender,
        race: sampled.race,
        sexuality: sampled.sexuality,
        combat: sampled.combat,
        intelligence: sampled.intelligence,
        happiness: sampled.happiness,
        wealth: sampled.wealth,
        current_health: sampled.current_health,
        personality_tags: sampled.personality_tags as unknown as Prisma.InputJsonValue,
        state_tags: [] as unknown as Prisma.InputJsonValue,
        is_alive: true,
        is_pinned: pin,
        created_year: sampled.created_year,
        recent_memories: [] as unknown as Prisma.InputJsonValue,
        action_queue: [] as unknown as Prisma.InputJsonValue,
      });
    }
    // God-summons add to the population — increment the bucket count by the
    // chunk size so subsequent year-pipeline death/churn doesn't drive
    // bucket.count negative (caught by §20.1 no_negatives invariant).
    await prisma.$transaction(
      async (tx) => {
        const insRes = await tx.person.createMany({ data: rows });
        created += insRes.count;
        await tx.bucket.update({
          where: { city_id_type: { city_id: input.city_id, type: input.type } },
          data: { count: { increment: insRes.count } },
        });
      },
      { timeout: 30_000 },
    );
  }

  return {
    requested,
    created,
    skipped_for_cap: requested - created,
  };
}

export type BulkKillScope = 'npc' | 'real' | 'both';

export interface BulkKillInput {
  world_id: string;
  /** Optional filter — only kill persons of this type. */
  type?: PersonType;
  /**
   * Optional filter applied to the real-person leg only — npc kills
   * (bucket decrements) have no pin concept.
   */
  is_pinned?: boolean;
  /** Which population to draw from. Default 'npc'. */
  scope?: BulkKillScope;
  /** Hard limit on how many to kill in this call (1..10_000). */
  limit: number;
}

export interface BulkKillResult {
  killed: number;
  killed_npc: number;
  killed_real: number;
}

export interface BulkKillPreviewInput {
  world_id: string;
  type?: PersonType;
  is_pinned?: boolean;
  scope?: BulkKillScope;
}

export interface BulkKillPreviewResult {
  npc: number;
  real: number;
  total: number;
}

/**
 * Sum of (bucket.count − alive_real) per bucket, optionally type-filtered,
 * world-scoped via the city relation.
 */
async function countNpcs(
  worldId: string,
  type: PersonType | undefined,
  prisma: PrismaClient,
): Promise<number> {
  const buckets = await prisma.bucket.findMany({
    where: {
      city: { world_id: worldId },
      ...(type ? { type } : {}),
    },
    select: { city_id: true, type: true, count: true },
  });
  if (buckets.length === 0) return 0;
  const realRows = await prisma.person.groupBy({
    by: ['city_id', 'type'],
    where: {
      world_id: worldId,
      is_alive: true,
      ...(type ? { type } : {}),
    },
    _count: { _all: true },
  });
  const realByKey = new Map<string, number>();
  for (const r of realRows) realByKey.set(`${r.city_id}::${r.type}`, r._count._all);
  let npc = 0;
  for (const b of buckets) {
    const real = realByKey.get(`${b.city_id}::${b.type}`) ?? 0;
    npc += Math.max(0, b.count - real);
  }
  return npc;
}

export async function previewBulkKill(
  input: BulkKillPreviewInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<BulkKillPreviewResult> {
  const scope: BulkKillScope = input.scope ?? 'npc';

  const [npc, real] = await Promise.all([
    scope === 'real'
      ? Promise.resolve(0)
      : countNpcs(input.world_id, input.type, prisma),
    scope === 'npc'
      ? Promise.resolve(0)
      : prisma.person.count({
          where: {
            world_id: input.world_id,
            is_alive: true,
            ...(input.type ? { type: input.type } : {}),
            ...(input.is_pinned !== undefined ? { is_pinned: input.is_pinned } : {}),
          },
        }),
  ]);
  return { npc, real, total: npc + real };
}

export async function killManyPersons(
  input: BulkKillInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<BulkKillResult> {
  const limit = Math.max(0, Math.min(input.limit, BULK_KILL_HARD_CAP));
  if (limit === 0) return { killed: 0, killed_npc: 0, killed_real: 0 };

  const scope: BulkKillScope = input.scope ?? 'npc';

  const world = await prisma.world.findUnique({
    where: { id: input.world_id },
    select: { current_year: true },
  });
  if (!world) throw new Error('world_not_found');

  let remaining = limit;
  let killed_npc = 0;
  let killed_real = 0;

  // ─── NPC leg (scope=npc|both) ──────────────────────────────────────────────
  // NPC kill = decrement bucket count up to (count − real_alive_in_bucket).
  // No archives, no relationships, no inheritance — npcs are aggregate-only.
  if ((scope === 'npc' || scope === 'both') && remaining > 0) {
    const buckets = await prisma.bucket.findMany({
      where: {
        city: { world_id: input.world_id },
        ...(input.type ? { type: input.type } : {}),
      },
      select: { city_id: true, type: true, count: true },
      orderBy: [{ city_id: 'asc' }, { type: 'asc' }],
    });
    if (buckets.length > 0) {
      const realRows = await prisma.person.groupBy({
        by: ['city_id', 'type'],
        where: {
          world_id: input.world_id,
          is_alive: true,
          ...(input.type ? { type: input.type } : {}),
        },
        _count: { _all: true },
      });
      const realByKey = new Map<string, number>();
      for (const r of realRows) realByKey.set(`${r.city_id}::${r.type}`, r._count._all);

      for (const b of buckets) {
        if (remaining <= 0) break;
        const real = realByKey.get(`${b.city_id}::${b.type}`) ?? 0;
        const npcAvail = Math.max(0, b.count - real);
        if (npcAvail <= 0) continue;
        const take = Math.min(npcAvail, remaining);
        await prisma.bucket.update({
          where: { city_id_type: { city_id: b.city_id, type: b.type } },
          data: { count: { decrement: take } },
        });
        remaining -= take;
        killed_npc += take;
      }
    }
  }

  // ─── Real leg (scope=real|both) ────────────────────────────────────────────
  if ((scope === 'real' || scope === 'both') && remaining > 0) {
    // Snapshot the target set up front. Order = oldest first (lowest created_year)
    // so repeated calls cull steadily rather than randomly.
    const targets = await prisma.person.findMany({
      where: {
        world_id: input.world_id,
        is_alive: true,
        ...(input.type ? { type: input.type } : {}),
        ...(input.is_pinned !== undefined ? { is_pinned: input.is_pinned } : {}),
      },
      select: {
        id: true,
        world_id: true,
        city_id: true,
        type: true,
        name: true,
        race: true,
        age: true,
        personality_tags: true,
        state_tags: true,
        wealth: true,
        mother_id: true,
        father_id: true,
        spouse_id: true,
        faction_id: true,
        religion_id: true,
        recent_memories: true,
      },
      orderBy: [{ created_year: 'asc' }, { id: 'asc' }],
      take: remaining,
    });

    if (targets.length > 0) {
      // Group bucket decrements by (city_id, type) so we issue one update per pair.
      const bucketDecrements = new Map<string, { city_id: string; type: PersonType; n: number }>();
      for (const p of targets) {
        const key = `${p.city_id}::${p.type}`;
        const cur = bucketDecrements.get(key);
        if (cur) cur.n += 1;
        else bucketDecrements.set(key, { city_id: p.city_id, type: p.type, n: 1 });
      }

      for (let chunkStart = 0; chunkStart < targets.length; chunkStart += BULK_CHUNK_SIZE) {
        const chunk = targets.slice(chunkStart, chunkStart + BULK_CHUNK_SIZE);
        const ids = chunk.map((p) => p.id);

        await prisma.$transaction(async (tx) => {
          // Build biography archive rows.
          const archives: Prisma.BiographyArchiveCreateManyInput[] = chunk.map((p) => {
            const memories = Array.isArray(p.recent_memories) ? p.recent_memories : [];
            const topMemories = (memories as Array<{ magnitude?: number }>)
              .slice()
              .sort((a, b) => (b.magnitude ?? 0) - (a.magnitude ?? 0))
              .slice(0, 5);
            return {
              world_id: p.world_id,
              person_id: p.id,
              name: p.name,
              race: p.race,
              age_at_demote: p.age,
              type: p.type,
              personality_tags: p.personality_tags as Prisma.InputJsonValue,
              state_tags: (p.state_tags ?? []) as Prisma.InputJsonValue,
              wealth_at_demote: p.wealth,
              mother_id: p.mother_id,
              father_id: p.father_id,
              spouse_id: p.spouse_id,
              faction_id: p.faction_id,
              religion_id: p.religion_id,
              top_memories: topMemories as unknown as Prisma.InputJsonValue,
              was_criminal: false,
              demotion_reason: 'death',
              demote_year: world.current_year,
            };
          });
          await tx.biographyArchive.createMany({ data: archives, skipDuplicates: true });
          await tx.relationship.deleteMany({
            where: { OR: [{ owner_id: { in: ids } }, { target_id: { in: ids } }] },
          });
          await tx.lifeDecadeSummary.deleteMany({ where: { person_id: { in: ids } } });
          const del = await tx.person.deleteMany({ where: { id: { in: ids } } });
          killed_real += del.count;
        });
      }

      // Apply grouped bucket decrements (one row per city/type).
      for (const dec of bucketDecrements.values()) {
        await prisma.bucket.update({
          where: { city_id_type: { city_id: dec.city_id, type: dec.type } },
          data: { count: { decrement: dec.n } },
        });
      }
    }
  }

  return { killed: killed_npc + killed_real, killed_npc, killed_real };
}

/** Pin a person. Throws RealPersonCapError if pinning a bucket-NPC would overflow. */
export async function pinPerson(
  personId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<Person> {
  const p = await prisma.person.findUnique({ where: { id: personId } });
  if (!p) throw new Error('person_not_found');
  if (p.is_pinned) return p;
  // Pinning an existing real person doesn't change the cap.
  return prisma.person.update({
    where: { id: personId },
    data: { is_pinned: true },
  });
}

export async function unpinPerson(
  personId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<Person> {
  return prisma.person.update({
    where: { id: personId },
    data: { is_pinned: false },
  });
}

export interface ListPersonsOpts {
  world_id: string;
  city_id?: string;
  type?: PersonType;
  is_pinned?: boolean;
  /** Optional name search (case-insensitive contains). */
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listPersons(
  opts: ListPersonsOpts,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ rows: Person[]; total: number }> {
  const where: Record<string, unknown> = {
    world_id: opts.world_id,
    is_alive: true,
  };
  if (opts.city_id) where.city_id = opts.city_id;
  if (opts.type) where.type = opts.type;
  if (opts.is_pinned !== undefined) where.is_pinned = opts.is_pinned;
  if (opts.q && opts.q.trim().length > 0) {
    where.name = { contains: opts.q.trim(), mode: 'insensitive' };
  }

  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where,
      take: Math.min(opts.limit ?? 50, 200),
      skip: opts.offset ?? 0,
      orderBy: [{ is_pinned: 'desc' }, { created_year: 'asc' }],
    }),
    prisma.person.count({ where }),
  ]);
  return { rows, total };
}

export async function getPerson(
  id: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<Person | null> {
  return prisma.person.findUnique({ where: { id } });
}

// ─── Rich person search (god-mode picker) ─────────────────────────────────

/** "none" sentinel = match persons with NULL faction/religion. */
export type GroupFilterValue = string | 'none';

export interface PersonSearchFilter {
  world_id: string;
  // Identity
  q?: string;
  race?: string[];
  gender?: string[];
  // Status — undefined = either
  is_alive?: boolean;
  is_pinned?: boolean;
  // Location
  city_ids?: string[];
  // Profession
  types?: PersonType[];
  // Allegiance — empty array = any; include "none" sentinel for unaffiliated
  faction_ids?: GroupFilterValue[];
  religion_ids?: GroupFilterValue[];
  // Personality tags — match mode controls ANY vs ALL
  personality_tags?: PersonalityTag[];
  personality_mode?: 'any' | 'all';
  // Stat ranges (inclusive)
  age_min?: number;
  age_max?: number;
  wealth_min?: number;
  wealth_max?: number;
  intelligence_min?: number;
  intelligence_max?: number;
  combat_min?: number;
  combat_max?: number;
  happiness_min?: number;
  happiness_max?: number;
  health_min?: number;
  health_max?: number;
  // Sort
  sort_by?:
    | 'name'
    | 'age'
    | 'wealth'
    | 'intelligence'
    | 'combat'
    | 'happiness'
    | 'created_year';
  sort_dir?: 'asc' | 'desc';
  // Pagination
  limit?: number;
  offset?: number;
}

export interface PersonSearchRow {
  id: string;
  name: string;
  type: PersonType;
  race: string;
  gender: string;
  age: number;
  city_id: string;
  city_name: string | null;
  faction_id: string | null;
  faction_name: string | null;
  religion_id: string | null;
  religion_name: string | null;
  intelligence: number;
  combat: number;
  happiness: number;
  wealth: number;
  current_health: number;
  personality_tags: PersonalityTag[];
  is_alive: boolean;
  is_pinned: boolean;
  death_year: number | null;
}

export async function searchPersons(
  f: PersonSearchFilter,
  prisma: PrismaClient = defaultPrisma,
): Promise<{ rows: PersonSearchRow[]; total: number }> {
  const where: Prisma.PersonWhereInput = { world_id: f.world_id };

  if (f.is_alive !== undefined) where.is_alive = f.is_alive;
  if (f.is_pinned !== undefined) where.is_pinned = f.is_pinned;
  if (f.q && f.q.trim()) {
    where.name = { contains: f.q.trim(), mode: 'insensitive' };
  }
  if (f.race && f.race.length > 0) where.race = { in: f.race };
  if (f.gender && f.gender.length > 0) where.gender = { in: f.gender };
  if (f.city_ids && f.city_ids.length > 0) where.city_id = { in: f.city_ids };
  if (f.types && f.types.length > 0) where.type = { in: f.types };

  // Allegiance — translate "none" sentinel into NULL filter.
  const allegianceWhere = (
    field: 'faction_id' | 'religion_id',
    values: GroupFilterValue[],
  ): Prisma.PersonWhereInput => {
    const ids = values.filter((v) => v !== 'none') as string[];
    const includeNone = values.includes('none');
    if (ids.length > 0 && includeNone) {
      return { OR: [{ [field]: { in: ids } }, { [field]: null }] };
    }
    if (ids.length > 0) return { [field]: { in: ids } };
    return { [field]: null };
  };

  const andClauses: Prisma.PersonWhereInput[] = [];

  if (f.faction_ids && f.faction_ids.length > 0) {
    andClauses.push(allegianceWhere('faction_id', f.faction_ids));
  }
  if (f.religion_ids && f.religion_ids.length > 0) {
    andClauses.push(allegianceWhere('religion_id', f.religion_ids));
  }

  // Personality tags via JSON array_contains.
  if (f.personality_tags && f.personality_tags.length > 0) {
    const mode = f.personality_mode ?? 'any';
    const tagClauses: Prisma.PersonWhereInput[] = f.personality_tags.map((t) => ({
      personality_tags: { array_contains: t },
    }));
    if (mode === 'all') andClauses.push(...tagClauses);
    else andClauses.push({ OR: tagClauses });
  }

  // Stat range filters.
  const range = (
    col: keyof Prisma.PersonWhereInput,
    min: number | undefined,
    max: number | undefined,
  ) => {
    if (min === undefined && max === undefined) return;
    const r: { gte?: number; lte?: number } = {};
    if (min !== undefined) r.gte = min;
    if (max !== undefined) r.lte = max;
    (where as Record<string, unknown>)[col as string] = r;
  };
  range('age', f.age_min, f.age_max);
  range('wealth', f.wealth_min, f.wealth_max);
  range('intelligence', f.intelligence_min, f.intelligence_max);
  range('combat', f.combat_min, f.combat_max);
  range('happiness', f.happiness_min, f.happiness_max);
  range('current_health', f.health_min, f.health_max);

  if (andClauses.length > 0) where.AND = andClauses;

  // Sort.
  const sortBy = f.sort_by ?? 'name';
  const sortDir = f.sort_dir ?? 'asc';
  const orderBy: Prisma.PersonOrderByWithRelationInput[] = [
    { [sortBy]: sortDir } as Prisma.PersonOrderByWithRelationInput,
  ];
  // Stable secondary key.
  if (sortBy !== 'name') orderBy.push({ name: 'asc' });

  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    prisma.person.findMany({
      where,
      orderBy,
      take: limit,
      skip: offset,
      select: {
        id: true,
        name: true,
        type: true,
        race: true,
        gender: true,
        age: true,
        city_id: true,
        faction_id: true,
        religion_id: true,
        intelligence: true,
        combat: true,
        happiness: true,
        wealth: true,
        current_health: true,
        personality_tags: true,
        is_alive: true,
        is_pinned: true,
        death_year: true,
      },
    }),
    prisma.person.count({ where }),
  ]);

  // Resolve city / group names with three light batch queries.
  const cityIds = Array.from(new Set(rows.map((r) => r.city_id)));
  const groupIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        [r.faction_id, r.religion_id].filter((v): v is string => !!v),
      ),
    ),
  );
  const [cities, groups] = await Promise.all([
    cityIds.length > 0
      ? prisma.city.findMany({
          where: { id: { in: cityIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
    groupIds.length > 0
      ? prisma.group.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const cityName = new Map(cities.map((c) => [c.id, c.name]));
  const groupName = new Map(groups.map((g) => [g.id, g.name]));

  const out: PersonSearchRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type as PersonType,
    race: r.race,
    gender: r.gender,
    age: r.age,
    city_id: r.city_id,
    city_name: cityName.get(r.city_id) ?? null,
    faction_id: r.faction_id,
    faction_name: r.faction_id ? groupName.get(r.faction_id) ?? null : null,
    religion_id: r.religion_id,
    religion_name: r.religion_id ? groupName.get(r.religion_id) ?? null : null,
    intelligence: r.intelligence,
    combat: r.combat,
    happiness: r.happiness,
    wealth: r.wealth,
    current_health: r.current_health,
    personality_tags: (r.personality_tags ?? []) as PersonalityTag[],
    is_alive: r.is_alive,
    is_pinned: r.is_pinned,
    death_year: r.death_year,
  }));

  return { rows: out, total };
}

export async function countAliveReal(
  worldId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<number> {
  return prisma.person.count({ where: { world_id: worldId, is_alive: true } });
}

export class RealPersonCapError extends Error {
  current: number;
  cap: number;
  constructor(current: number, cap: number) {
    super('real_person_cap_reached');
    this.name = 'RealPersonCapError';
    this.current = current;
    this.cap = cap;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bucketRowToState(b: {
  type: PersonType;
  count: number;
  avg_age: number;
  birth_rate: number;
  death_rate: number;
  avg_wealth: number;
  avg_intelligence: number;
  avg_combat: number;
  avg_health: number;
  avg_happiness: number;
  avg_sexuality: number;
}): BucketState {
  return {
    type: b.type,
    count: b.count,
    avg_age: b.avg_age,
    birth_rate: b.birth_rate,
    death_rate: b.death_rate,
    avg_wealth: b.avg_wealth,
    avg_intelligence: b.avg_intelligence,
    avg_combat: b.avg_combat,
    avg_health: b.avg_health,
    avg_happiness: b.avg_happiness,
    avg_sexuality: b.avg_sexuality,
  };
}

function defaultTagFreqs(): PersonalityTagFreqs {
  return {
    ambitious: 0.15,
    cruel: 0.08,
    kind: 0.20,
    greedy: 0.15,
    loyal: 0.20,
    vengeful: 0.10,
    charismatic: 0.12,
    faithful: 0.18,
    cunning: 0.10,
    stoic: 0.15,
    paranoid: 0.10,
    lazy: 0.12,
    brave: 0.12,
    reckless: 0.10,
    proud: 0.12,
    diligent: 0.15,
  };
}

// race typing helper (kept private to lock the import)
type _Race = Race;
