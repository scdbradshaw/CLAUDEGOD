// Group service (Phase 7).
//
// Founding (player-only via UI), dissolution, leader succession, and the
// year-end lifecycle phase: bucket-share drift, real-person switching,
// schism detection, member-count cache refresh.
//
// Pure logic lives under `engine/groups/`. This file only does DB I/O.

import { Prisma, type PrismaClient, type Group } from '@prisma/client';
import {
  FACTION_COMPETITION_METRIC_DEFAULT,
  FACTION_DEFAULT_COST_PER_YEAR,
  FACTION_LEADER_DUES_CUT_DEFAULT,
  FACTION_PRIZE_SHARES_DEFAULT,
  GROUP_DISSOLUTION_GRACE_YEARS,
  GROUP_DISSOLUTION_MIN_MEMBERS,
  GROUP_SEED_AGGREGATE_MEMBERS,
  RELIGION_BUCKET_DRIFT_RATE,
  RELIGION_DEFAULT_COST_PCT,
  type GroupKind,
  type GroupShares,
  type GroupStatFloors,
  type GroupTypeAffinities,
  type Memory,
  type PersonalityTag,
  type PersonType,
} from '@claude-god/shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { makeRng } from '../lib/rng';
import { materializeFromBucketTx } from './person.service';
import {
  scoreFit,
  type FitGroup,
  type FitSubject,
} from '../engine/groups/fit-score';
import { driftBucketShares } from '../engine/groups/bucket-drift';
import { planRealSwitch } from '../engine/groups/real-switch';
import {
  evaluateDissolution,
  pickSuccessor,
  type SuccessorCandidate,
} from '../engine/groups/dissolution';
import { detectSchismCandidate } from '../engine/groups/schism';
import { runUnmatchedTagPurgeTx } from '../engine/groups/purge';
import { appendMemoryTx } from './memory.service';
import { addMemory as addMemoryEngine } from '../engine/memory';

type TxClient = Prisma.TransactionClient | PrismaClient;

// ─── Founding ──────────────────────────────────────────────────────────────

export interface CreateGroupInput {
  world_id: string;
  kind: GroupKind;
  name: string;
  founder_id: string | null;
  leader_id?: string | null;
  founded_year: number;
  wanted_tags: PersonalityTag[];
  type_affinities: GroupTypeAffinities;
  stat_floors: GroupStatFloors;
  cost_per_year: number;
  /** Religion-only — fraction of member wealth charged annually (§ R1). */
  cost_pct_of_wealth?: number | null;
  // Faction-only:
  territory_cities?: string[];
  tax_rate?: number;
  army_size?: number;
  /** Faction-only — fraction of yearly dues skimmed by the leader (0–1). */
  leader_dues_cut?: number;
  /** Faction-only — top-N prize fractions of yearly dues. */
  prize_shares?: number[];
  /** Faction-only — ranking metric. v1 only supports 'income'. */
  competition_metric?: string;
  /** Faction-only — soft fit-score bias toward this intelligence level (0–100). */
  intelligence_target?: number;
}

export async function createGroup(
  input: CreateGroupInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<Group> {
  return createGroupTx(input, prisma);
}

export async function createGroupTx(
  input: CreateGroupInput,
  tx: TxClient,
): Promise<Group> {
  const isFaction = input.kind === 'faction';
  const group = await tx.group.create({
    data: {
      world_id: input.world_id,
      kind: input.kind,
      name: input.name,
      founder_id: input.founder_id,
      leader_id: input.leader_id ?? input.founder_id ?? null,
      founded_year: input.founded_year,
      is_active: true,
      treasury: 0,
      member_count_cached: 0,
      wanted_tags: input.wanted_tags as unknown as Prisma.InputJsonValue,
      type_affinities: input.type_affinities as unknown as Prisma.InputJsonValue,
      stat_floors: input.stat_floors as unknown as Prisma.InputJsonValue,
      cost_per_year: input.cost_per_year,
      cost_pct_of_wealth: isFaction ? null : input.cost_pct_of_wealth ?? null,
      territory_cities: (isFaction
        ? input.territory_cities ?? []
        : []) as unknown as Prisma.InputJsonValue,
      tax_rate: isFaction ? input.tax_rate ?? 0 : null,
      army_size: isFaction ? input.army_size ?? 0 : 0,
      at_war_with: [] as unknown as Prisma.InputJsonValue,
      leader_dues_cut: isFaction ? input.leader_dues_cut ?? null : null,
      prize_shares:
        isFaction && input.prize_shares != null
          ? (input.prize_shares as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      competition_metric: isFaction ? input.competition_metric ?? null : null,
      intelligence_target: isFaction ? input.intelligence_target ?? null : null,
    },
  });

  // Seed GROUP_SEED_AGGREGATE_MEMBERS aggregate (bucket) members from the
  // founding city. Pick the best-fit buckets first so the new group lands
  // with people who actually match its wanted_tags / affinities.
  if (input.founder_id) {
    const founder = await tx.person.findUnique({
      where: { id: input.founder_id },
      select: { city_id: true },
    });
    if (founder) {
      await seedAggregateMembersTx(group, founder.city_id, tx);
    }
  }
  return group;
}

// ─── Aggregate seeding ─────────────────────────────────────────────────────
//
// On group creation, allocate `GROUP_SEED_AGGREGATE_MEMBERS` aggregate
// (bucket-share) members from the founding city, weighted by fit score so
// only buckets that actually match the new group's wanted_tags/affinities
// contribute. Each bucket's share field is read-modify-write JSON; we cap the
// running total at 1.0 across all groups in that bucket.

async function seedAggregateMembersTx(
  group: Group,
  foundingCityId: string,
  tx: TxClient,
): Promise<void> {
  const sharesField = group.kind === 'faction' ? 'faction_shares' : 'religion_shares';
  const buckets = await tx.bucket.findMany({ where: { city_id: foundingCityId } });
  if (buckets.length === 0) return;

  // Score each bucket using its modal personality tags (top-2 by frequency)
  // as the FitSubject's tags. cityShare = 0 (brand-new group).
  const fitGroup: FitGroup = {
    id: group.id,
    wanted_tags: (Array.isArray(group.wanted_tags)
      ? group.wanted_tags
      : []) as unknown as PersonalityTag[],
    type_affinities: (group.type_affinities ?? {}) as unknown as GroupTypeAffinities,
    stat_floors: (group.stat_floors ?? {}) as unknown as GroupStatFloors,
    intelligence_target: group.intelligence_target,
    ambitious_bonus: group.kind === 'faction',
  };

  const scored = buckets
    .map((b) => {
      if (b.count <= 0) return null;
      const freqs = (b.personality_tag_freqs ?? {}) as Record<string, number>;
      const modalTags = Object.entries(freqs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([tag]) => tag as PersonalityTag);
      const subject: FitSubject = {
        type: b.type as PersonType,
        personality_tags: modalTags,
        intelligence: b.avg_intelligence,
        combat: b.avg_combat,
        wealth: b.avg_wealth,
        age: b.avg_age,
      };
      const fit = scoreFit(subject, fitGroup, 0);
      if (fit <= 0) return null;
      return { bucket: b, fit };
    })
    .filter((x): x is { bucket: (typeof buckets)[number]; fit: number } => x !== null)
    .sort((a, b) => b.fit - a.fit);

  if (scored.length === 0) return;

  let remaining = GROUP_SEED_AGGREGATE_MEMBERS;
  let allocated = 0;
  for (const { bucket } of scored) {
    if (remaining <= 0) break;
    const shares = (bucket[sharesField] ?? {}) as GroupShares;
    const existingTotal = Object.values(shares).reduce(
      (acc: number, v) => acc + (typeof v === 'number' ? v : 0),
      0,
    );
    const headroom = Math.max(0, 1 - existingTotal);
    if (headroom <= 0) continue;
    const wantedShare = remaining / bucket.count;
    const addShare = Math.min(wantedShare, headroom);
    if (addShare <= 0) continue;
    const next: GroupShares = { ...shares, [group.id]: addShare };
    await tx.bucket.update({
      where: { city_id_type: { city_id: bucket.city_id, type: bucket.type } },
      data: { [sharesField]: next as unknown as Prisma.InputJsonValue },
    });
    const addedCount = addShare * bucket.count;
    remaining -= addedCount;
    allocated += addedCount;
  }

  // Reflect seeded members in the cache so the dissolution check at the end
  // of the founding year doesn't immediately tear the group down.
  if (allocated > 0) {
    await tx.group.update({
      where: { id: group.id },
      data: { member_count_cached: Math.round(allocated) },
    });
  }
}

// ─── God-mode founder + religion summon ───────────────────────────────────
//
// Atomic flow used by the Religions page "Summon religion" form:
//   1. Bump bucket count (god-summons add to the population).
//   2. Materialize a real Person from the bucket (rolls full backstory).
//   3. Override stats with caller-supplied values; force `faithful` into the
//      personality tags so the §8.3 founder gate passes; auto-pin.
//   4. Create the religion Group with founder_id = new person.
//   5. Set the founder's religion_id so they're a member from year 0.

export interface ReligionSummonInput {
  world_id: string;
  city_id: string;
  founder: {
    type: PersonType;
    name?: string;
    gender?: 'male' | 'female';
    age?: number;
    intelligence?: number;
    combat?: number;
    happiness?: number;
    wealth?: number;
    /** Tags applied to the founder. `faithful` is force-added if absent. */
    personality_tags?: PersonalityTag[];
  };
  religion: {
    name: string;
    wanted_tags: PersonalityTag[];
    type_affinities?: GroupTypeAffinities;
    stat_floors?: GroupStatFloors;
    cost_per_year?: number;
    /** Defaults to RELIGION_DEFAULT_COST_PCT when omitted. */
    cost_pct_of_wealth?: number;
  };
}

export interface ReligionSummonResult {
  group: Group;
  founder: { id: string; name: string };
}

export async function summonFounderAndReligion(
  input: ReligionSummonInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<ReligionSummonResult> {
  const world = await prisma.world.findUnique({
    where: { id: input.world_id },
    select: { current_year: true, random_seed_root: true },
  });
  if (!world) throw new Error('world_not_found');

  const seed = (world.random_seed_root ^ BigInt(Date.now())) & 0x7fffffffffffffffn;
  const rng = makeRng(seed);
  const year = world.current_year;

  return prisma.$transaction(async (tx) => {
    // Bump bucket so materialize finds capacity (mirrors summonPerson).
    const bucket = await tx.bucket.findUnique({
      where: { city_id_type: { city_id: input.city_id, type: input.founder.type } },
    });
    if (!bucket) {
      throw new Error(`bucket_not_found: ${input.city_id} ${input.founder.type}`);
    }
    await tx.bucket.update({
      where: { city_id_type: { city_id: input.city_id, type: input.founder.type } },
      data: { count: { increment: 1 } },
    });

    const created = await materializeFromBucketTx(
      {
        world_id: input.world_id,
        city_id: input.city_id,
        type: input.founder.type,
        year,
        rng,
      },
      tx,
    );

    // Build override patch. `faithful` is mandatory for the §8.3 gate.
    const tagsIn = input.founder.personality_tags ?? [];
    const personality_tags = tagsIn.includes('faithful')
      ? tagsIn
      : (['faithful' as PersonalityTag, ...tagsIn] as PersonalityTag[]);

    const updateData: Prisma.PersonUpdateInput = {
      is_pinned: true,
      personality_tags: personality_tags as unknown as Prisma.InputJsonValue,
    };
    if (input.founder.name && input.founder.name.trim().length > 0) {
      updateData.name = input.founder.name.trim();
    }
    if (input.founder.gender) updateData.gender = input.founder.gender;
    if (typeof input.founder.age === 'number') {
      updateData.age = clamp(input.founder.age, 0, 120);
    }
    if (typeof input.founder.intelligence === 'number') {
      updateData.intelligence = clamp(input.founder.intelligence, 0, 100);
    }
    if (typeof input.founder.combat === 'number') {
      updateData.combat = clamp(input.founder.combat, 0, 100);
    }
    if (typeof input.founder.happiness === 'number') {
      updateData.happiness = clamp(input.founder.happiness, 0, 100);
    }
    if (typeof input.founder.wealth === 'number') {
      updateData.wealth = Math.max(0, Math.floor(input.founder.wealth));
    }
    const founder = await tx.person.update({
      where: { id: created.id },
      data: updateData,
    });

    const group = await createGroupTx(
      {
        world_id: input.world_id,
        kind: 'religion',
        name: input.religion.name,
        founder_id: founder.id,
        leader_id: founder.id,
        founded_year: year,
        wanted_tags: input.religion.wanted_tags,
        type_affinities: input.religion.type_affinities ?? {},
        stat_floors: input.religion.stat_floors ?? {},
        cost_per_year: input.religion.cost_per_year ?? 0,
        cost_pct_of_wealth:
          input.religion.cost_pct_of_wealth ?? RELIGION_DEFAULT_COST_PCT,
      },
      tx,
    );

    // Founder joins their own religion at year 0.
    await tx.person.update({
      where: { id: founder.id },
      data: {
        religion_id: group.id,
        religion_joined_year: year,
      },
    });

    return {
      group,
      founder: { id: founder.id, name: founder.name },
    };
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.floor(n)));
}

// ─── God-mode founder + faction summon ────────────────────────────────────
//
// Mirror of summonFounderAndReligion but for factions. The forced founder
// tag is `ambitious` (the faction analogue of `faithful`) so the leader has a
// stake in the competition mechanic from year 0.

export interface FactionSummonInput {
  world_id: string;
  city_id: string;
  founder: ReligionSummonInput['founder'];
  faction: {
    name: string;
    wanted_tags: PersonalityTag[];
    type_affinities?: GroupTypeAffinities;
    stat_floors?: GroupStatFloors;
    cost_per_year?: number;
    leader_dues_cut?: number;
    prize_shares?: number[];
    competition_metric?: string;
    intelligence_target?: number;
    tax_rate?: number;
    army_size?: number;
  };
}

export interface FactionSummonResult {
  group: Group;
  founder: { id: string; name: string };
}

export async function summonFounderAndFaction(
  input: FactionSummonInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<FactionSummonResult> {
  const world = await prisma.world.findUnique({
    where: { id: input.world_id },
    select: { current_year: true, random_seed_root: true },
  });
  if (!world) throw new Error('world_not_found');

  const seed = (world.random_seed_root ^ BigInt(Date.now())) & 0x7fffffffffffffffn;
  const rng = makeRng(seed);
  const year = world.current_year;

  return prisma.$transaction(async (tx) => {
    const bucket = await tx.bucket.findUnique({
      where: { city_id_type: { city_id: input.city_id, type: input.founder.type } },
    });
    if (!bucket) {
      throw new Error(`bucket_not_found: ${input.city_id} ${input.founder.type}`);
    }
    await tx.bucket.update({
      where: { city_id_type: { city_id: input.city_id, type: input.founder.type } },
      data: { count: { increment: 1 } },
    });

    const created = await materializeFromBucketTx(
      {
        world_id: input.world_id,
        city_id: input.city_id,
        type: input.founder.type,
        year,
        rng,
      },
      tx,
    );

    // Force `ambitious` so the founder benefits from the faction's own
    // ambitious_bonus and their fit-score against the new group is strong.
    const tagsIn = input.founder.personality_tags ?? [];
    const personality_tags = tagsIn.includes('ambitious')
      ? tagsIn
      : (['ambitious' as PersonalityTag, ...tagsIn] as PersonalityTag[]);

    const updateData: Prisma.PersonUpdateInput = {
      is_pinned: true,
      personality_tags: personality_tags as unknown as Prisma.InputJsonValue,
    };
    if (input.founder.name && input.founder.name.trim().length > 0) {
      updateData.name = input.founder.name.trim();
    }
    if (input.founder.gender) updateData.gender = input.founder.gender;
    if (typeof input.founder.age === 'number') {
      updateData.age = clamp(input.founder.age, 0, 120);
    }
    if (typeof input.founder.intelligence === 'number') {
      updateData.intelligence = clamp(input.founder.intelligence, 0, 100);
    }
    if (typeof input.founder.combat === 'number') {
      updateData.combat = clamp(input.founder.combat, 0, 100);
    }
    if (typeof input.founder.happiness === 'number') {
      updateData.happiness = clamp(input.founder.happiness, 0, 100);
    }
    if (typeof input.founder.wealth === 'number') {
      updateData.wealth = Math.max(0, Math.floor(input.founder.wealth));
    }
    const founder = await tx.person.update({
      where: { id: created.id },
      data: updateData,
    });

    const group = await createGroupTx(
      {
        world_id: input.world_id,
        kind: 'faction',
        name: input.faction.name,
        founder_id: founder.id,
        leader_id: founder.id,
        founded_year: year,
        wanted_tags: input.faction.wanted_tags,
        type_affinities: input.faction.type_affinities ?? {},
        stat_floors: input.faction.stat_floors ?? {},
        cost_per_year: input.faction.cost_per_year ?? FACTION_DEFAULT_COST_PER_YEAR,
        territory_cities: [],
        tax_rate: input.faction.tax_rate ?? 0,
        army_size: input.faction.army_size ?? 0,
        leader_dues_cut: input.faction.leader_dues_cut ?? FACTION_LEADER_DUES_CUT_DEFAULT,
        prize_shares:
          input.faction.prize_shares ?? Array.from(FACTION_PRIZE_SHARES_DEFAULT),
        competition_metric:
          input.faction.competition_metric ?? FACTION_COMPETITION_METRIC_DEFAULT,
        intelligence_target:
          input.faction.intelligence_target ?? founder.intelligence,
      },
      tx,
    );

    // Founder joins their own faction at year 0.
    await tx.person.update({
      where: { id: founder.id },
      data: {
        faction_id: group.id,
        faction_joined_year: year,
      },
    });

    return {
      group,
      founder: { id: founder.id, name: founder.name },
    };
  });
}

// ─── Dissolution ───────────────────────────────────────────────────────────

export type DissolutionReason = 'low-membership' | 'leader-loss' | 'manual';

export async function dissolveGroupTx(
  groupId: string,
  year: number,
  reason: DissolutionReason,
  tx: TxClient,
): Promise<Group> {
  const group = await tx.group.findUnique({ where: { id: groupId } });
  if (!group) throw new Error('group_not_found');
  if (!group.is_active) return group;

  const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';
  const joinedField = group.kind === 'faction' ? 'faction_joined_year' : 'religion_joined_year';

  // Find members so we can write a memory entry per ex-member.
  const members = await tx.person.findMany({
    where: { world_id: group.world_id, is_alive: true, [fkField]: groupId },
    select: { id: true },
  });

  // Scrub FK + joined_year on all (including dead) members.
  await tx.person.updateMany({
    where: { world_id: group.world_id, [fkField]: groupId },
    data: { [fkField]: null, [joinedField]: null },
  });

  // Best-effort: scrub bucket shares too. JSON read-modify-write — bucket
  // shares are small (cap 5 entries), so this stays cheap.
  const sharesField = group.kind === 'faction' ? 'faction_shares' : 'religion_shares';
  const cities = await tx.city.findMany({
    where: { world_id: group.world_id },
    select: { id: true },
  });
  if (cities.length > 0) {
    const buckets = await tx.bucket.findMany({
      where: { city_id: { in: cities.map((c) => c.id) } },
    });
    for (const b of buckets) {
      const shares = (b[sharesField] ?? {}) as GroupShares;
      if (groupId in shares) {
        const next = { ...shares };
        delete next[groupId];
        await tx.bucket.update({
          where: { city_id_type: { city_id: b.city_id, type: b.type } },
          data: { [sharesField]: next as unknown as Prisma.InputJsonValue },
        });
      }
    }
  }

  // Memory entry for each living ex-member.
  for (const m of members) {
    await appendMemoryTx(
      m.id,
      {
        year,
        kind: group.kind === 'faction' ? 'faction-dissolved' : 'religion-dissolved',
        summary:
          group.kind === 'faction'
            ? `the ${group.name} faction came apart`
            : `the ${group.name} faith dissolved`,
        magnitude: 0.7,
        tone: 'literary',
        counterparty_id: groupId,
      } satisfies Memory,
      tx,
    );
  }

  return tx.group.update({
    where: { id: groupId },
    data: {
      is_active: false,
      dissolved_year: year,
      // dissolution reason memorialized in last_*; explicit field would be
      // cleaner but adds another schema column for one string.
    },
  });
}

// ─── Leader succession (death pipeline hook) ───────────────────────────────

/**
 * Called when a real person dies. If they led any active group, pick a
 * successor; if none qualify, dissolve the group(s).
 */
export async function handleLeaderDeathTx(
  deceasedPersonId: string,
  year: number,
  tx: TxClient,
): Promise<void> {
  const led = await tx.group.findMany({
    where: { leader_id: deceasedPersonId, is_active: true },
  });
  if (led.length === 0) return;

  for (const group of led) {
    const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';
    const candidates = await tx.person.findMany({
      where: {
        world_id: group.world_id,
        is_alive: true,
        [fkField]: group.id,
        id: { not: deceasedPersonId },
      },
      select: { id: true, intelligence: true, personality_tags: true },
    });

    const wantedTags = (group.wanted_tags ?? []) as unknown as PersonalityTag[];
    const successor = pickSuccessor(
      candidates.map(
        (c): SuccessorCandidate => ({
          id: c.id,
          intelligence: c.intelligence,
          personality_tags: (Array.isArray(c.personality_tags)
            ? c.personality_tags
            : []) as unknown as PersonalityTag[],
        }),
      ),
      { leaderReferenceTags: wantedTags },
    );

    if (successor) {
      await tx.group.update({
        where: { id: group.id },
        data: { leader_id: successor.id },
      });
    } else {
      await dissolveGroupTx(group.id, year, 'leader-loss', tx);
    }
  }
}

// ─── Year-end lifecycle phase ──────────────────────────────────────────────

export interface GroupLifecycleSummary {
  refreshed: number;
  bucketsDrifted: number;
  switches: number;
  schismCandidates: number;
  dissolutions: number;
  /** Real members who left their faction this year for sustained zero-match. */
  factionAutoLeaves: number;
  /** Real members who left their religion this year for sustained zero-match (§8.3). */
  religionAutoLeaves: number;
}

export async function runGroupLifecyclePhaseTx(
  worldId: string,
  year: number,
  tx: TxClient,
): Promise<GroupLifecycleSummary> {
  const groups = await tx.group.findMany({
    where: { world_id: worldId, is_active: true },
  });
  if (groups.length === 0) {
    return {
      refreshed: 0,
      bucketsDrifted: 0,
      switches: 0,
      schismCandidates: 0,
      dissolutions: 0,
      factionAutoLeaves: 0,
      religionAutoLeaves: 0,
    };
  }

  // 0. §8.3 — purge real members with sustained zero-tag-match. Runs BEFORE
  //    the recount so leavers reduce `member_count_cached` in step 1. Both
  //    kinds share the mechanic with their own grace constants.
  const factionAutoLeaves = await runUnmatchedTagPurgeTx(
    'faction',
    worldId,
    year,
    tx,
  );
  const religionAutoLeaves = await runUnmatchedTagPurgeTx(
    'religion',
    worldId,
    year,
    tx,
  );

  // 1. Recount members for cache refresh (also used by dissolution + schism).
  const refreshed = await recountMembersTx(worldId, tx);

  // Refetch (treasury/etc. unchanged but `member_count_cached` now current).
  const refreshedGroups = await tx.group.findMany({
    where: { world_id: worldId, is_active: true },
  });

  // 1a. Append (year, member_count) into Group.member_count_history (cap 50).
  // Bulk: build the new histories in JS, flush in one UPDATE FROM VALUES.
  if (refreshedGroups.length > 0) {
    const rows = refreshedGroups.map((g) => {
      const existing = (Array.isArray(g.member_count_history)
        ? g.member_count_history
        : []) as unknown as Array<{ year: number; count: number }>;
      const next = [...existing, { year, count: g.member_count_cached }].slice(-50);
      return Prisma.sql`(${g.id}::text, ${JSON.stringify(next)}::jsonb)`;
    });
    await tx.$executeRaw`
      UPDATE "Group" AS g
      SET member_count_history = v.h
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, h)
      WHERE g.id = v.id
    `;
  }

  // 2. Bucket drift — per (city, kind), score each active group against the
  //    bucket's modal-personality cohort and drift shares.
  const bucketsDrifted = await driftAllBucketsTx(refreshedGroups, worldId, tx);

  // 3. Real-person switching — sample candidates (cap to keep this cheap).
  const switches = await applyRealSwitchesTx(refreshedGroups, worldId, year, tx);

  // 4. Schism detection — for groups large enough, log candidate.
  let schismCandidates = 0;
  for (const group of refreshedGroups) {
    const result = await evaluateSchismForGroupTx(group, year, tx);
    if (result.fired) schismCandidates++;
  }

  // 5. Dissolution check — recount members again only for groups whose count
  //    changed materially (cheap proxy: re-read `member_count_cached`).
  let dissolutions = 0;
  const finalGroups = await tx.group.findMany({
    where: { world_id: worldId, is_active: true },
  });
  for (const group of finalGroups) {
    const action = evaluateDissolution({
      memberCount: group.member_count_cached,
      lowMembershipYears: group.low_membership_years,
    });
    if (action.kind === 'dissolve') {
      await dissolveGroupTx(group.id, year, 'low-membership', tx);
      dissolutions++;
    } else if (action.kind === 'increment-grace') {
      await tx.group.update({
        where: { id: group.id },
        data: { low_membership_years: action.nextLowMembershipYears },
      });
    } else if (action.kind === 'reset-grace') {
      await tx.group.update({
        where: { id: group.id },
        data: { low_membership_years: 0 },
      });
    }
  }

  return {
    refreshed,
    bucketsDrifted,
    switches,
    schismCandidates,
    dissolutions,
    factionAutoLeaves,
    religionAutoLeaves,
  };
}

// ─── Member-count recount ──────────────────────────────────────────────────

export async function recountMembersTx(
  worldId: string,
  tx: TxClient,
): Promise<number> {
  const groups = await tx.group.findMany({
    where: { world_id: worldId, is_active: true },
  });
  if (groups.length === 0) return 0;

  // Real-person FK counts grouped per group_id.
  const factionCounts = await tx.person.groupBy({
    by: ['faction_id'],
    where: { world_id: worldId, is_alive: true, faction_id: { not: null } },
    _count: { _all: true },
  });
  const religionCounts = await tx.person.groupBy({
    by: ['religion_id'],
    where: { world_id: worldId, is_alive: true, religion_id: { not: null } },
    _count: { _all: true },
  });
  const realCount = new Map<string, number>();
  for (const r of factionCounts) if (r.faction_id) realCount.set(r.faction_id, r._count._all);
  for (const r of religionCounts) if (r.religion_id) realCount.set(r.religion_id, r._count._all);

  // Bucket-share contributions.
  const cities = await tx.city.findMany({
    where: { world_id: worldId },
    select: { id: true },
  });
  const buckets = cities.length
    ? await tx.bucket.findMany({
        where: { city_id: { in: cities.map((c) => c.id) } },
        select: { count: true, faction_shares: true, religion_shares: true },
      })
    : [];

  const bucketCount = new Map<string, number>();
  for (const b of buckets) {
    const fac = (b.faction_shares ?? {}) as GroupShares;
    const rel = (b.religion_shares ?? {}) as GroupShares;
    for (const [id, share] of Object.entries(fac)) {
      bucketCount.set(id, (bucketCount.get(id) ?? 0) + b.count * share);
    }
    for (const [id, share] of Object.entries(rel)) {
      bucketCount.set(id, (bucketCount.get(id) ?? 0) + b.count * share);
    }
  }

  // Bulk: collect groups whose count changed, flush one UPDATE FROM VALUES.
  const changed: { id: string; total: number }[] = [];
  for (const g of groups) {
    const total = Math.round((realCount.get(g.id) ?? 0) + (bucketCount.get(g.id) ?? 0));
    if (total !== g.member_count_cached) changed.push({ id: g.id, total });
  }
  if (changed.length === 0) return 0;
  const rows = changed.map(
    (c) => Prisma.sql`(${c.id}::text, ${c.total}::int)`,
  );
  await tx.$executeRaw`
    UPDATE "Group" AS g
    SET member_count_cached = v.n
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, n)
    WHERE g.id = v.id
  `;
  return changed.length;
}

// ─── Bucket drift ──────────────────────────────────────────────────────────

async function driftAllBucketsTx(
  groups: Group[],
  worldId: string,
  tx: TxClient,
): Promise<number> {
  if (groups.length === 0) return 0;
  const cities = await tx.city.findMany({ where: { world_id: worldId } });
  if (cities.length === 0) return 0;
  const cityIds = cities.map((c) => c.id);
  const buckets = await tx.bucket.findMany({ where: { city_id: { in: cityIds } } });

  // Pre-build city → cityShares of each group (sum across that city's buckets).
  const cityShareByGroup = new Map<string, Record<string, number>>();
  for (const c of cities) {
    const cityBuckets = buckets.filter((b) => b.city_id === c.id);
    const total = cityBuckets.reduce((s, b) => s + b.count, 0);
    const shares: Record<string, number> = {};
    if (total > 0) {
      for (const b of cityBuckets) {
        const fac = (b.faction_shares ?? {}) as GroupShares;
        const rel = (b.religion_shares ?? {}) as GroupShares;
        for (const [id, frac] of Object.entries(fac)) {
          shares[id] = (shares[id] ?? 0) + (b.count * frac) / total;
        }
        for (const [id, frac] of Object.entries(rel)) {
          shares[id] = (shares[id] ?? 0) + (b.count * frac) / total;
        }
      }
    }
    cityShareByGroup.set(c.id, shares);
  }

  let drifted = 0;
  for (const b of buckets) {
    if (b.count === 0) continue;
    const cityShares = cityShareByGroup.get(b.city_id) ?? {};
    const subject = bucketSubjectFromBucket(b);

    // Per-kind drift.
    for (const kind of ['faction', 'religion'] as const) {
      const sharesField = kind === 'faction' ? 'faction_shares' : 'religion_shares';
      const sameKind = groups.filter((g) => g.kind === kind);
      if (sameKind.length === 0) continue;

      const fit: Record<string, number> = {};
      for (const g of sameKind) {
        fit[g.id] = scoreFit(subject, asFitGroup(g), cityShares[g.id] ?? 0);
      }

      const next = driftBucketShares({
        shares: (b[sharesField] ?? {}) as GroupShares,
        fit,
        // §8.3 — religions drift slower so word-of-mouth (talk-conversion)
        // dominates aggregate growth.
        step: kind === 'religion' ? RELIGION_BUCKET_DRIFT_RATE : undefined,
      });
      if (!shareEqual(next, (b[sharesField] ?? {}) as GroupShares)) {
        await tx.bucket.update({
          where: { city_id_type: { city_id: b.city_id, type: b.type } },
          data: { [sharesField]: next as unknown as Prisma.InputJsonValue },
        });
        drifted++;
      }
    }
  }
  return drifted;
}

function shareEqual(a: GroupShares, b: GroupShares): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 1e-9) return false;
  return true;
}

/**
 * Build a FitSubject from bucket aggregates: dominant tag = the highest-freq
 * personality tag (we put just that one in `personality_tags`), with avg
 * stats. This is intentionally shallow — bucket fit is necessarily approximate.
 */
function bucketSubjectFromBucket(b: {
  type: PersonType;
  personality_tag_freqs: unknown;
  avg_intelligence: number;
  avg_combat: number;
  avg_wealth: number;
  avg_age: number;
}): FitSubject {
  const freqs = (b.personality_tag_freqs ?? {}) as Record<PersonalityTag, number>;
  const top = Object.entries(freqs).sort((a, c) => c[1] - a[1])[0]?.[0] as
    | PersonalityTag
    | undefined;
  return {
    type: b.type,
    personality_tags: top ? [top] : [],
    intelligence: b.avg_intelligence,
    combat: b.avg_combat,
    wealth: b.avg_wealth,
    age: b.avg_age,
  };
}

// ─── Real-person switching ─────────────────────────────────────────────────

const SWITCH_SAMPLE_CAP = 200;

async function applyRealSwitchesTx(
  groups: Group[],
  worldId: string,
  year: number,
  tx: TxClient,
): Promise<number> {
  // Sample candidates: alive, of mixed affiliation status. Limit so the year
  // run stays cheap on large worlds.
  const candidates = await tx.person.findMany({
    where: { world_id: worldId, is_alive: true },
    select: {
      id: true,
      city_id: true,
      type: true,
      personality_tags: true,
      intelligence: true,
      combat: true,
      wealth: true,
      age: true,
      faction_id: true,
      religion_id: true,
      faction_joined_year: true,
      religion_joined_year: true,
      recent_memories: true,
    },
    take: SWITCH_SAMPLE_CAP,
  });

  if (candidates.length === 0) return 0;

  // Pre-build cityShares (group share of person's city).
  const cities = await tx.city.findMany({
    where: { world_id: worldId },
    select: { id: true },
  });
  const buckets = cities.length
    ? await tx.bucket.findMany({
        where: { city_id: { in: cities.map((c) => c.id) } },
        select: { city_id: true, count: true, faction_shares: true, religion_shares: true },
      })
    : [];
  const cityShareByGroup = new Map<string, Record<string, number>>();
  for (const c of cities) {
    const cityBuckets = buckets.filter((b) => b.city_id === c.id);
    const total = cityBuckets.reduce((s, b) => s + b.count, 0);
    const shares: Record<string, number> = {};
    if (total > 0) {
      for (const b of cityBuckets) {
        const fac = (b.faction_shares ?? {}) as GroupShares;
        const rel = (b.religion_shares ?? {}) as GroupShares;
        for (const [id, frac] of Object.entries(fac)) {
          shares[id] = (shares[id] ?? 0) + (b.count * frac) / total;
        }
        for (const [id, frac] of Object.entries(rel)) {
          shares[id] = (shares[id] ?? 0) + (b.count * frac) / total;
        }
      }
    }
    cityShareByGroup.set(c.id, shares);
  }

  // Plan all switches in JS, then flush in 1-2 round-trips total.
  const factionSwitches: { personId: string; newFactionId: string }[] = [];
  const memoryUpdates = new Map<string, Memory[]>(); // personId -> mutated memory buf
  for (const p of candidates) {
    // §8.3 — religions are NOT auto-switched at year-end. Real members join
    // via talk-conversion (interactions phase) and leave via the no-match
    // purge or active player/agentic action. Buckets still drift their
    // religion_shares slowly via `driftAllBucketsTx`.
    for (const kind of ['faction'] as const) {
      const fkField = kind === 'faction' ? 'faction_id' : 'religion_id';
      const joinedField =
        kind === 'faction' ? 'faction_joined_year' : 'religion_joined_year';
      const currentId = p[fkField];
      const joinedYear = p[joinedField];

      const altGroups = groups.filter((g) => g.kind === kind);
      if (altGroups.length === 0) continue;

      const subject: FitSubject = {
        type: p.type,
        personality_tags: (Array.isArray(p.personality_tags)
          ? p.personality_tags
          : []) as unknown as PersonalityTag[],
        intelligence: p.intelligence,
        combat: p.combat,
        wealth: p.wealth,
        age: p.age,
      };
      const cityShares = cityShareByGroup.get(p.city_id) ?? {};
      const currentGroup = currentId ? altGroups.find((g) => g.id === currentId) ?? null : null;

      const plan = planRealSwitch({
        subject,
        kind,
        current: currentGroup ? asFitGroup(currentGroup) : null,
        joinedYear: joinedYear ?? null,
        alternatives: altGroups.filter((g) => g.id !== currentId).map(asFitGroup),
        cityShares,
        year,
      });

      if (!plan.switchTo) continue;

      factionSwitches.push({ personId: p.id, newFactionId: plan.switchTo.id });

      // Mutate this person's memory buffer in JS for any leave/join memos.
      if (plan.leaveMemory || plan.joinMemory) {
        let buf =
          memoryUpdates.get(p.id) ??
          ((Array.isArray(p.recent_memories)
            ? p.recent_memories
            : []) as unknown as Memory[]);
        if (plan.leaveMemory) buf = addMemoryEngine(buf, plan.leaveMemory);
        if (plan.joinMemory) buf = addMemoryEngine(buf, plan.joinMemory);
        memoryUpdates.set(p.id, buf);
      }
    }
  }

  if (factionSwitches.length > 0) {
    const rows = factionSwitches.map(
      (s) => Prisma.sql`(${s.personId}::text, ${s.newFactionId}::text, ${year}::int)`,
    );
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET faction_id = v.fid, faction_joined_year = v.yr
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, fid, yr)
      WHERE p.id = v.id
    `;
  }
  if (memoryUpdates.size > 0) {
    const rows = [...memoryUpdates].map(
      ([id, buf]) => Prisma.sql`(${id}::text, ${JSON.stringify(buf)}::jsonb)`,
    );
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET recent_memories = v.mem
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, mem)
      WHERE p.id = v.id
    `;
  }
  return factionSwitches.length;
}

// ─── Schism evaluation ─────────────────────────────────────────────────────

async function evaluateSchismForGroupTx(
  group: Group,
  year: number,
  tx: TxClient,
): Promise<{ fired: boolean }> {
  const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';
  const members = await tx.person.findMany({
    where: { world_id: group.world_id, is_alive: true, [fkField]: group.id },
    select: { personality_tags: true },
  });

  const dist: Record<string, number> = {};
  for (const m of members) {
    const tags = (Array.isArray(m.personality_tags)
      ? m.personality_tags
      : []) as unknown as PersonalityTag[];
    if (tags.length === 0) continue;
    const primary = tags[0];
    dist[primary] = (dist[primary] ?? 0) + 1;
  }

  const leaderPrimaryTag = await leaderPrimaryTagFor(group, tx);

  const result = detectSchismCandidate({
    memberCount: group.member_count_cached,
    primaryTagDistribution: dist as Record<PersonalityTag, number>,
    leaderPrimaryTag,
    lastSchismYear: group.last_schism_year ?? null,
    currentYear: year,
  });
  if (!result.fire) return { fired: false };

  // Record the candidate by stamping cooldown anchor. Phase 8 will spawn an
  // actual ReligiousSchism event from this signal.
  await tx.group.update({
    where: { id: group.id },
    data: { last_schism_year: year },
  });
  return { fired: true };
}

async function leaderPrimaryTagFor(
  group: Group,
  tx: TxClient,
): Promise<PersonalityTag | null> {
  if (!group.leader_id) return null;
  const leader = await tx.person.findUnique({
    where: { id: group.leader_id },
    select: { personality_tags: true, is_alive: true },
  });
  if (!leader || !leader.is_alive) return null;
  const tags = (Array.isArray(leader.personality_tags)
    ? leader.personality_tags
    : []) as unknown as PersonalityTag[];
  return tags[0] ?? null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function asFitGroup(g: Group): FitGroup {
  const isFaction = g.kind === 'faction';
  return {
    id: g.id,
    wanted_tags: (Array.isArray(g.wanted_tags)
      ? g.wanted_tags
      : []) as unknown as PersonalityTag[],
    type_affinities: (g.type_affinities ?? {}) as GroupTypeAffinities,
    stat_floors: (g.stat_floors ?? {}) as GroupStatFloors,
    intelligence_target: isFaction ? g.intelligence_target ?? null : null,
    ambitious_bonus: isFaction,
  };
}

// Re-export constants used in tests.
export {
  GROUP_DISSOLUTION_GRACE_YEARS,
  GROUP_DISSOLUTION_MIN_MEMBERS,
};
