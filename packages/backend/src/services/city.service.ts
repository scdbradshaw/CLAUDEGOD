// City service (Phase 11).
//
// Read/update layer for the City Detail page.
//   - getCityDetail: city + buckets + active events + dominant group names
//   - updateTaxRate: PATCH from the City Detail tax slider (0–50)
//   - getLeaderboards: top-N real persons per metric for the city

import type { Person, Prisma, PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';

export type LeaderboardMetric =
  | 'richest'
  | 'poorest'
  | 'happiest'
  | 'smartest'
  | 'strongest'
  | 'oldest'
  | 'famous'
  | 'infamous';

export const LEADERBOARD_METRICS: readonly LeaderboardMetric[] = [
  'richest',
  'poorest',
  'happiest',
  'smartest',
  'strongest',
  'oldest',
  'famous',
  'infamous',
] as const;

const DEFAULT_LEADERBOARD_LIMIT = 10;
const MAX_LEADERBOARD_LIMIT = 50;

export async function getCityDetail(
  cityId: string,
  prisma: PrismaClient = defaultPrisma,
) {
  const city = await prisma.city.findUnique({
    where: { id: cityId },
    include: { buckets: true },
  });
  if (!city) return null;

  // Compute dominant faction/religion from bucket share weights.
  // Each bucket has faction_shares / religion_shares: { [groupId]: share (0–1) }.
  // Weight each group's share by the bucket's population count, sum, pick the max.
  const factionWeights = new Map<string, number>();
  const religionWeights = new Map<string, number>();
  for (const bucket of city.buckets) {
    const fs = bucket.faction_shares as Record<string, number> | null;
    const rs = bucket.religion_shares as Record<string, number> | null;
    if (fs) {
      for (const [gid, share] of Object.entries(fs)) {
        factionWeights.set(gid, (factionWeights.get(gid) ?? 0) + share * bucket.count);
      }
    }
    if (rs) {
      for (const [gid, share] of Object.entries(rs)) {
        religionWeights.set(gid, (religionWeights.get(gid) ?? 0) + share * bucket.count);
      }
    }
  }
  const topFactionId = factionWeights.size > 0
    ? [...factionWeights.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;
  const topReligionId = religionWeights.size > 0
    ? [...religionWeights.entries()].sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const groupIdsToFetch = [topFactionId, topReligionId].filter(Boolean) as string[];

  const [activeEvents, dominantGroups, realCountsRaw] = await Promise.all([
    prisma.worldEvent.findMany({
      where: {
        world_id: city.world_id,
        ended_year: null,
        OR: [{ city_id: city.id }, { city_id: null }],
      },
      orderBy: { started_year: 'desc' },
    }),
    groupIdsToFetch.length > 0
      ? prisma.group.findMany({
          where: { id: { in: groupIdsToFetch } },
          select: { id: true, name: true, kind: true },
        })
      : Promise.resolve([]),
    prisma.person.groupBy({
      by: ['type'],
      where: { city_id: city.id, is_alive: true },
      _count: { _all: true },
    }),
  ]);

  const groupMap = new Map(dominantGroups.map((g) => [g.id, g]));
  const dominantFaction = topFactionId ? (groupMap.get(topFactionId) ?? null) : null;
  const dominantReligion = topReligionId ? (groupMap.get(topReligionId) ?? null) : null;

  const real_counts: Record<string, number> = {};
  for (const row of realCountsRaw) real_counts[row.type] = row._count._all;

  return {
    city,
    buckets: city.buckets,
    active_events: activeEvents,
    dominant_faction: dominantFaction,
    dominant_religion: dominantReligion,
    real_counts,
  };
}

/** Update tax_rate on the city. Caller validates the 0–50 range. */
export async function updateTaxRate(
  cityId: string,
  taxRate: number,
  prisma: PrismaClient = defaultPrisma,
) {
  return prisma.city.update({
    where: { id: cityId },
    data: { tax_rate: taxRate },
    select: { id: true, tax_rate: true },
  });
}

export interface LeaderboardOpts {
  metric: LeaderboardMetric;
  limit?: number;
}

/**
 * Top-N real persons in the city for the given metric.
 * `famous` and `infamous` filter on `state_tags` JSONB containing the tag,
 * then sort by happiness desc (a stable secondary signal).
 */
export async function getLeaderboards(
  cityId: string,
  opts: LeaderboardOpts,
  prisma: PrismaClient = defaultPrisma,
): Promise<Person[]> {
  const take = Math.min(opts.limit ?? DEFAULT_LEADERBOARD_LIMIT, MAX_LEADERBOARD_LIMIT);
  const baseWhere: Prisma.PersonWhereInput = { city_id: cityId, is_alive: true };

  switch (opts.metric) {
    case 'richest':
      return prisma.person.findMany({
        where: baseWhere,
        orderBy: [{ wealth: 'desc' }, { id: 'asc' }],
        take,
      });
    case 'poorest':
      return prisma.person.findMany({
        where: baseWhere,
        orderBy: [{ wealth: 'asc' }, { id: 'asc' }],
        take,
      });
    case 'happiest':
      return prisma.person.findMany({
        where: baseWhere,
        orderBy: [{ happiness: 'desc' }, { id: 'asc' }],
        take,
      });
    case 'smartest':
      return prisma.person.findMany({
        where: baseWhere,
        orderBy: [{ intelligence: 'desc' }, { id: 'asc' }],
        take,
      });
    case 'strongest':
      return prisma.person.findMany({
        where: baseWhere,
        orderBy: [{ combat: 'desc' }, { id: 'asc' }],
        take,
      });
    case 'oldest':
      return prisma.person.findMany({
        where: baseWhere,
        orderBy: [{ age: 'desc' }, { id: 'asc' }],
        take,
      });
    case 'famous':
      return prisma.person.findMany({
        where: {
          ...baseWhere,
          state_tags: { array_contains: [{ tag: 'famous' }] },
        },
        orderBy: [{ happiness: 'desc' }, { id: 'asc' }],
        take,
      });
    case 'infamous':
      return prisma.person.findMany({
        where: {
          ...baseWhere,
          state_tags: { array_contains: [{ tag: 'infamous' }] },
        },
        orderBy: [{ wealth: 'desc' }, { id: 'asc' }],
        take,
      });
  }
}
