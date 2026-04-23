// ============================================================
// LEADERSHIP SERVICE — Phase 5: leader extraction + small-group disband
// ------------------------------------------------------------
// Two passes bolted into the year pipeline:
//
//   extractLeaderCuts(tx, worldId, currentYear)
//     - Runs once per year at year-end.
//     - For every active religion and faction with a living leader and a
//       positive balance, the leader skims
//         extraction = floor( (cunning / 100) × LEADER_EXTRACTION_RATE × balance )
//       from the treasury into personal money.
//     - Cunning stands in for "greed" in the original DESIGN (no such trait
//       exists in the codebase); mapping approved 2026-04-22.
//     - Silent by design: no memories, no happiness impact — members never
//       notice. Corruption is a structural drag, not a narrative beat.
//
//   checkSmallGroupDisbands(tx, worldId, currentYear)
//     - Runs once per bi-annual phase.
//     - Groups with fewer than SMALL_GROUP_DISBAND_THRESHOLD (20) members
//       roll against `(20 - member_count) × SMALL_GROUP_DISBAND_RATE` to
//       dissolve naturally.
//     - On disband: leader inherits the full balance, memberships are
//       cleared, the row is soft-deleted via `disbanded_at`, and a
//       single epic group memory logs the closure.
//
// Leader-death succession is already handled by
// `group-lifecycle.service.handlePersonDeath` (pickHeir → update
// leader_id, or dissolve with leader_void). This file does not touch
// that path.
// ============================================================

import type { Prisma } from '@prisma/client';
import {
  LEADER_EXTRACTION_RATE,
  SMALL_GROUP_DISBAND_RATE,
  SMALL_GROUP_DISBAND_THRESHOLD,
} from '@civ-sim/shared';
import { writeGroupMemory } from './memory.service';

// ── Types ───────────────────────────────────────────────────

export interface LeaderCut {
  group_type:  'religion' | 'faction';
  group_id:    string;
  group_name:  string;
  leader_id:   string;
  amount:      number;
  cunning:     number;
}

export interface GroupDisband {
  group_type:       'religion' | 'faction';
  group_id:         string;
  group_name:       string;
  member_count:     number;
  balance_released: number;
  leader_id:        string | null;
}

// ── extractLeaderCuts ───────────────────────────────────────

/**
 * Per-group leader skim. Runs inside the year-end transaction.
 * Returns one entry per non-zero extraction so the caller can log to
 * the yearly report or heartbeat if desired.
 */
export async function extractLeaderCuts(
  tx:      Prisma.TransactionClient,
  worldId: string,
): Promise<LeaderCut[]> {
  const cuts: LeaderCut[] = [];

  // ── Religions ────────────────────────────────────────────
  const religions = await tx.religion.findMany({
    where: {
      world_id:  worldId,
      is_active: true,
      leader_id: { not: null },
      balance:   { gt: 0 },
    },
    select: { id: true, name: true, leader_id: true, balance: true },
  });

  for (const r of religions) {
    if (!r.leader_id) continue;
    const leader = await tx.person.findUnique({
      where:  { id: r.leader_id },
      select: { id: true, traits: true, current_health: true },
    });
    if (!leader || leader.current_health <= 0) continue;

    const traits  = (leader.traits ?? {}) as Record<string, number>;
    const cunning = typeof traits.cunning === 'number' ? traits.cunning : 0;
    if (cunning <= 0) continue;

    const amount = Math.floor((cunning / 100) * LEADER_EXTRACTION_RATE * r.balance);
    if (amount <= 0) continue;

    await tx.religion.update({
      where: { id: r.id },
      data:  { balance: { decrement: amount } },
    });
    await tx.person.update({
      where: { id: leader.id },
      data:  { money: { increment: amount } },
    });

    cuts.push({
      group_type: 'religion',
      group_id:   r.id,
      group_name: r.name,
      leader_id:  leader.id,
      amount,
      cunning,
    });
  }

  // ── Factions ────────────────────────────────────────────
  const factions = await tx.faction.findMany({
    where: {
      world_id:  worldId,
      is_active: true,
      leader_id: { not: null },
      balance:   { gt: 0 },
    },
    select: { id: true, name: true, leader_id: true, balance: true },
  });

  for (const f of factions) {
    if (!f.leader_id) continue;
    const leader = await tx.person.findUnique({
      where:  { id: f.leader_id },
      select: { id: true, traits: true, current_health: true },
    });
    if (!leader || leader.current_health <= 0) continue;

    const traits  = (leader.traits ?? {}) as Record<string, number>;
    const cunning = typeof traits.cunning === 'number' ? traits.cunning : 0;
    if (cunning <= 0) continue;

    const amount = Math.floor((cunning / 100) * LEADER_EXTRACTION_RATE * f.balance);
    if (amount <= 0) continue;

    await tx.faction.update({
      where: { id: f.id },
      data:  { balance: { decrement: amount } },
    });
    await tx.person.update({
      where: { id: leader.id },
      data:  { money: { increment: amount } },
    });

    cuts.push({
      group_type: 'faction',
      group_id:   f.id,
      group_name: f.name,
      leader_id:  leader.id,
      amount,
      cunning,
    });
  }

  return cuts;
}

// ── checkSmallGroupDisbands ─────────────────────────────────

/**
 * Per bi-annual small-group attrition. Groups below the threshold roll
 * once; on success the leader absorbs the treasury, memberships are
 * released, and the group is soft-deleted with `disbanded_at`.
 */
export async function checkSmallGroupDisbands(
  tx:          Prisma.TransactionClient,
  worldId:     string,
  currentYear: number,
): Promise<GroupDisband[]> {
  const disbands: GroupDisband[] = [];
  const now = new Date();

  // ── Religions ────────────────────────────────────────────
  const religions = await tx.religion.findMany({
    where:  { world_id: worldId, is_active: true },
    select: {
      id: true, name: true, leader_id: true, balance: true,
      _count: { select: { memberships: true } },
    },
  });

  for (const r of religions) {
    const memberCount = r._count.memberships;
    if (memberCount >= SMALL_GROUP_DISBAND_THRESHOLD) continue;

    const chance = (SMALL_GROUP_DISBAND_THRESHOLD - memberCount) * SMALL_GROUP_DISBAND_RATE;
    if (Math.random() >= chance) continue;

    if (r.leader_id && r.balance > 0) {
      await tx.person.update({
        where: { id: r.leader_id },
        data:  { money: { increment: r.balance } },
      });
    }

    await tx.religionMembership.deleteMany({ where: { religion_id: r.id } });

    await tx.religion.update({
      where: { id: r.id },
      data:  {
        is_active:        false,
        balance:          0,
        dissolved_year:   currentYear,
        dissolved_reason: 'small_group_natural',
        disbanded_at:     now,
      },
    });

    await writeGroupMemory(tx, {
      groupType:    'religion',
      groupId:      r.id,
      worldId,
      eventKind:    'disbanded_small_group',
      eventSummary: `${r.name} faded quietly — only ${memberCount} faithful remained when the doors finally closed.`,
      worldYear:    currentYear,
      tone:         'epic',
      weight:       70,
      payload: {
        member_count:     memberCount,
        balance_released: r.balance,
      },
    });

    disbands.push({
      group_type:       'religion',
      group_id:         r.id,
      group_name:       r.name,
      member_count:     memberCount,
      balance_released: r.balance,
      leader_id:        r.leader_id,
    });
  }

  // ── Factions ────────────────────────────────────────────
  const factions = await tx.faction.findMany({
    where:  { world_id: worldId, is_active: true },
    select: {
      id: true, name: true, leader_id: true, balance: true,
      _count: { select: { memberships: true } },
    },
  });

  for (const f of factions) {
    const memberCount = f._count.memberships;
    if (memberCount >= SMALL_GROUP_DISBAND_THRESHOLD) continue;

    const chance = (SMALL_GROUP_DISBAND_THRESHOLD - memberCount) * SMALL_GROUP_DISBAND_RATE;
    if (Math.random() >= chance) continue;

    if (f.leader_id && f.balance > 0) {
      await tx.person.update({
        where: { id: f.leader_id },
        data:  { money: { increment: f.balance } },
      });
    }

    await tx.factionMembership.deleteMany({ where: { faction_id: f.id } });

    await tx.faction.update({
      where: { id: f.id },
      data:  {
        is_active:        false,
        balance:          0,
        dissolved_year:   currentYear,
        dissolved_reason: 'small_group_natural',
        disbanded_at:     now,
      },
    });

    await writeGroupMemory(tx, {
      groupType:    'faction',
      groupId:      f.id,
      worldId,
      eventKind:    'disbanded_small_group',
      eventSummary: `${f.name} dissolved without fanfare — only ${memberCount} still flew the banner when it was finally lowered.`,
      worldYear:    currentYear,
      tone:         'epic',
      weight:       70,
      payload: {
        member_count:     memberCount,
        balance_released: f.balance,
      },
    });

    disbands.push({
      group_type:       'faction',
      group_id:         f.id,
      group_name:       f.name,
      member_count:     memberCount,
      balance_released: f.balance,
      leader_id:        f.leader_id,
    });
  }

  return disbands;
}
