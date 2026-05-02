// Faction year-end awards service (Phase 7+).
//
// Hooked into the year pipeline AFTER real-person economy (which credits
// dues into Group.treasury) and BEFORE invariants. Per active faction:
//   1. Compute treasury intake T for this year (passed in by caller).
//   2. Plan payouts via the pure `planFactionAwards`.
//   3. Apply: debit treasury by total payouts, credit wealth to leader +
//      winners, bump career counters, append memories.
//   4. Reset every faction member's `faction_income_year` ledger to 0.
//
// Religions are skipped — they're not competitions.

import { Prisma, type PrismaClient } from '@prisma/client';
import type { Memory } from '@claude-god/shared';
import {
  planFactionAwards,
  type CandidateMember,
  type FactionAwardsPlan,
} from '../engine/groups/faction-awards';
import { appendMemoryTx } from './memory.service';

type TxClient = Prisma.TransactionClient | PrismaClient;

/** Cap on award_history entries per faction. */
export const AWARD_HISTORY_CAP = 10;

/** Single archived awards entry stored on Group.award_history. */
export interface FactionAwardHistoryEntry {
  year: number;
  treasury_in_year: number;
  leader_id: string | null;
  leader_cut: number;
  ranks: Array<{
    person_id: string;
    rank: number;
    prize: number;
    income_this_year: number;
  }>;
  total_paid: number;
}

export interface FactionAwardOutcome {
  faction_id: string;
  faction_name: string;
  treasury_in_year: number;
  plan: FactionAwardsPlan;
}

export interface RunFactionAwardsResult {
  outcomes: FactionAwardOutcome[];
  total_paid_out: number;
}

export async function runFactionAwardsTx(
  worldId: string,
  year: number,
  /** Per-group total dues credited this year (from
   *  `runRealPersonEconomyPhaseTx`). Religion ids are ignored. */
  duesByGroupThisYear: Record<string, number>,
  tx: TxClient,
): Promise<RunFactionAwardsResult> {
  const factions = await tx.group.findMany({
    where: { world_id: worldId, kind: 'faction', is_active: true },
    select: {
      id: true,
      name: true,
      leader_id: true,
      leader_dues_cut: true,
      prize_shares: true,
      treasury: true,
      award_history: true,
    },
  });
  if (factions.length === 0) {
    return { outcomes: [], total_paid_out: 0 };
  }

  const outcomes: FactionAwardOutcome[] = [];
  let totalPaidOut = 0;

  for (const f of factions) {
    const T = Math.max(0, Math.floor(duesByGroupThisYear[f.id] ?? 0));

    // Always reset the ledger for this faction's members at the end, even
    // if no payout fires this year. We do that pass below after the awards.
    if (T === 0) {
      await resetFactionLedgerTx(f.id, tx);
      continue;
    }

    // Eligible candidates: real, alive members of this faction.
    const memberRows = await tx.person.findMany({
      where: {
        world_id: worldId,
        is_alive: true,
        faction_id: f.id,
      },
      select: {
        id: true,
        faction_joined_year: true,
        faction_income_year: true,
        wealth: true,
      },
    });
    const members: CandidateMember[] = memberRows.map((m) => ({
      id: m.id,
      faction_joined_year: m.faction_joined_year,
      faction_income_year: m.faction_income_year,
      wealth: m.wealth,
    }));

    const plan = planFactionAwards({
      year,
      treasury_in_year: T,
      members,
      config: {
        leader_id: f.leader_id,
        leader_dues_cut: f.leader_dues_cut,
        prize_shares: Array.isArray(f.prize_shares)
          ? (f.prize_shares as unknown as number[])
          : null,
      },
    });

    // Cap actual debit at current treasury to defend against future code
    // paths that decrement treasury between intake and awards.
    const cappedPaid = Math.min(plan.total_paid, f.treasury);
    if (cappedPaid <= 0) {
      await resetFactionLedgerTx(f.id, tx);
      outcomes.push({
        faction_id: f.id,
        faction_name: f.name,
        treasury_in_year: T,
        plan: { ...plan, total_paid: 0, leader_cut: 0, ranks: [] },
      });
      continue;
    }

    // Scale payouts proportionally if cap binds (rare: only when treasury
    // got drained between intake and now).
    const scale = cappedPaid / plan.total_paid;
    const leaderCut = Math.floor(plan.leader_cut * scale);
    const ranks = plan.ranks.map((r) => ({
      ...r,
      prize: Math.floor(r.prize * scale),
    }));
    const actualPaid = leaderCut + ranks.reduce((s, r) => s + r.prize, 0);

    // Debit treasury once.
    if (actualPaid > 0) {
      await tx.group.update({
        where: { id: f.id },
        data: { treasury: { decrement: actualPaid } },
      });
    }

    // Credit leader cut.
    if (plan.leader_id && leaderCut > 0) {
      await tx.person.update({
        where: { id: plan.leader_id },
        data: {
          wealth: { increment: leaderCut },
          faction_leadership_years: { increment: 1 },
        },
      });
      await appendMemoryTx(
        plan.leader_id,
        memoryFor('leader-skim', f.id, f.name, leaderCut, year, 1),
        tx,
      );
    } else if (plan.leader_id) {
      // Still credit the leadership-years counter even when cut is 0.
      await tx.person.update({
        where: { id: plan.leader_id },
        data: { faction_leadership_years: { increment: 1 } },
      });
    }

    // Credit rank prizes.
    for (const r of ranks) {
      if (r.prize <= 0) continue;
      const isFirst = r.rank === 1;
      await tx.person.update({
        where: { id: r.person_id },
        data: {
          wealth: { increment: r.prize },
          ...(isFirst ? { faction_wins: { increment: 1 } } : {}),
        },
      });
      await appendMemoryTx(
        r.person_id,
        memoryFor('rank-prize', f.id, f.name, r.prize, year, r.rank),
        tx,
      );
    }

    // Append to award_history (cap AWARD_HISTORY_CAP).
    const prior = (Array.isArray(f.award_history)
      ? f.award_history
      : []) as unknown as FactionAwardHistoryEntry[];
    const entry: FactionAwardHistoryEntry = {
      year,
      treasury_in_year: T,
      leader_id: plan.leader_id,
      leader_cut: leaderCut,
      ranks,
      total_paid: actualPaid,
    };
    const nextHistory = [...prior, entry].slice(-AWARD_HISTORY_CAP);
    await tx.group.update({
      where: { id: f.id },
      data: {
        award_history: nextHistory as unknown as Prisma.InputJsonValue,
      },
    });

    // Reset ledger for the faction's current membership.
    await resetFactionLedgerTx(f.id, tx);

    totalPaidOut += actualPaid;
    outcomes.push({
      faction_id: f.id,
      faction_name: f.name,
      treasury_in_year: T,
      plan: { leader_id: plan.leader_id, leader_cut: leaderCut, ranks, total_paid: actualPaid },
    });
  }

  return { outcomes, total_paid_out: totalPaidOut };
}

async function resetFactionLedgerTx(factionId: string, tx: TxClient): Promise<void> {
  await tx.person.updateMany({
    where: { faction_id: factionId, faction_income_year: { not: 0 } },
    data: { faction_income_year: 0 },
  });
}

function memoryFor(
  kind: 'leader-skim' | 'rank-prize',
  factionId: string,
  factionName: string,
  amount: number,
  year: number,
  rank: number,
): Memory {
  if (kind === 'leader-skim') {
    return {
      year,
      kind: 'faction-leader-skim',
      summary: `skimmed ${amount.toLocaleString()} as leader of ${factionName}`,
      magnitude: 0.5,
      tone: 'reportage',
      counterparty_id: factionId,
    };
  }
  const place = rank === 1 ? 'won' : rank === 2 ? 'placed second in' : `placed ${rank}th in`;
  return {
    year,
    kind: 'faction-prize',
    summary: `${place} the ${factionName} competition (+${amount.toLocaleString()})`,
    magnitude: rank === 1 ? 0.85 : 0.5,
    tone: rank === 1 ? 'epic' : 'reportage',
    counterparty_id: factionId,
  };
}
