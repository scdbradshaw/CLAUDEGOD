// Generalized §8.3 unmatched-tag purge for both factions + religions.
//
// A real member of an active group whose `personality_tags` have ZERO overlap
// with that group's `wanted_tags` accumulates a per-kind counter; once it
// crosses the kind's grace threshold they auto-leave. Years with at least one
// match reset the counter.
//
// NPC bucket members are not affected — bucket share-drift is handled by
// `driftAllBucketsTx`.

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  FACTION_UNMATCHED_GRACE_YEARS,
  RELIGION_UNMATCHED_GRACE_YEARS,
  type GroupKind,
  type PersonalityTag,
} from '@claude-god/shared';
import { appendMemoryTx } from '../../services/memory.service';

type TxClient = Prisma.TransactionClient | PrismaClient;

const GRACE_BY_KIND: Record<GroupKind, number> = {
  faction: FACTION_UNMATCHED_GRACE_YEARS,
  religion: RELIGION_UNMATCHED_GRACE_YEARS,
};

/**
 * Run the unmatched-tag auto-purge for a single kind. Returns the number of
 * real members who left this year.
 */
export async function runUnmatchedTagPurgeTx(
  kind: GroupKind,
  worldId: string,
  year: number,
  tx: TxClient,
): Promise<number> {
  const fkField = kind === 'faction' ? 'faction_id' : 'religion_id';
  const joinedField =
    kind === 'faction' ? 'faction_joined_year' : 'religion_joined_year';
  const counterField =
    kind === 'faction' ? 'unmatched_faction_years' : 'unmatched_religion_years';
  const duesMissedField =
    kind === 'faction' ? 'dues_missed_faction' : 'dues_missed_religion';
  const memoryKind = kind === 'faction' ? 'faction-left' : 'religion-left';
  const grace = GRACE_BY_KIND[kind];

  const groups = await tx.group.findMany({
    where: { world_id: worldId, kind, is_active: true },
    select: { id: true, name: true, wanted_tags: true },
  });
  if (groups.length === 0) return 0;

  const wantedById = new Map<string, Set<PersonalityTag>>();
  for (const g of groups) {
    const tags = (Array.isArray(g.wanted_tags) ? g.wanted_tags : []) as PersonalityTag[];
    wantedById.set(g.id, new Set(tags));
  }
  const nameById = new Map(groups.map((g) => [g.id, g.name]));

  const members = await tx.person.findMany({
    where: {
      world_id: worldId,
      is_alive: true,
      [fkField]: { in: groups.map((g) => g.id) },
    },
    select: {
      id: true,
      [fkField]: true,
      personality_tags: true,
      [counterField]: true,
    } as Record<string, true>,
  });

  let leaves = 0;
  for (const m of members as Array<Record<string, unknown>>) {
    const groupId = m[fkField] as string | null;
    if (!groupId) continue;
    const wanted = wantedById.get(groupId);
    if (!wanted) continue;
    const tags = (Array.isArray(m.personality_tags)
      ? m.personality_tags
      : []) as PersonalityTag[];
    const counter = Number(m[counterField] ?? 0);
    const personId = m.id as string;
    const hasMatch = tags.some((t) => wanted.has(t));

    if (hasMatch) {
      if (counter !== 0) {
        await tx.person.update({
          where: { id: personId },
          data: { [counterField]: 0 },
        });
      }
      continue;
    }

    const next = counter + 1;
    if (next < grace) {
      await tx.person.update({
        where: { id: personId },
        data: { [counterField]: next },
      });
      continue;
    }

    // Auto-leave: clear membership ties + reset clocks. Group recount runs
    // afterwards in lifecycle phase to sync member_count_cached.
    await tx.person.update({
      where: { id: personId },
      data: {
        [fkField]: null,
        [joinedField]: null,
        [counterField]: 0,
        [duesMissedField]: 0,
      },
    });
    await appendMemoryTx(
      personId,
      {
        year,
        kind: memoryKind,
        summary:
          kind === 'faction'
            ? `walked away from ${nameById.get(groupId) ?? 'their faction'}`
            : `drifted away from ${nameById.get(groupId) ?? 'their faith'}`,
        magnitude: 0.4,
        tone: 'literary',
      },
      tx,
    );
    leaves++;
  }

  return leaves;
}
