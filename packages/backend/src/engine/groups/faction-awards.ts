// Faction year-end competition awards (pure logic).
//
// Per faction, treasury intake `T` for the year funds:
//   - leader cut:  floor(T × leader_dues_cut)        → leader.wealth
//   - rank prizes: floor(T × prize_shares[i])        → person.wealth
// Remaining (T − total payouts) stays in treasury.
//
// Eligibility: real members of the faction whose `faction_joined_year` is
// at most `year − tenureFloor` (default 1y — anti-snipe). Buckets do not
// compete (anonymous aggregates can't be crowned).
//
// Ranking metric for v1: `faction_income_year`. Tiebreak by wealth desc,
// then person id asc for determinism. Composite metric is a future
// extension — switch on `competition_metric` here when added.

import {
  FACTION_LEADER_DUES_CUT_DEFAULT,
  FACTION_PRIZE_SHARES_DEFAULT,
  FACTION_PRIZE_TENURE_FLOOR_YEARS,
} from '@claude-god/shared';

export interface CandidateMember {
  id: string;
  faction_joined_year: number | null;
  faction_income_year: number;
  wealth: number;
}

export interface FactionAwardsConfig {
  leader_id: string | null;
  /** Override default cut. Null/undefined → use default. */
  leader_dues_cut?: number | null;
  /** Override default prize shares. Null/undefined → use default. */
  prize_shares?: number[] | null;
  /** Tenure floor in years. Null/undefined → default. */
  tenure_floor_years?: number | null;
}

export interface PrizeWinner {
  person_id: string;
  rank: number; // 1-indexed
  prize: number;
  income_this_year: number;
}

export interface FactionAwardsPlan {
  leader_id: string | null;
  leader_cut: number;
  ranks: PrizeWinner[];
  total_paid: number;
}

/**
 * Compute the awards plan for a single faction in a given year. Pure — no DB
 * I/O, no clock, deterministic given inputs.
 */
export function planFactionAwards(input: {
  year: number;
  treasury_in_year: number;
  members: CandidateMember[];
  config: FactionAwardsConfig;
}): FactionAwardsPlan {
  const T = Math.max(0, Math.floor(input.treasury_in_year));
  if (T === 0) {
    return { leader_id: input.config.leader_id, leader_cut: 0, ranks: [], total_paid: 0 };
  }

  const leaderCutPct =
    input.config.leader_dues_cut ?? FACTION_LEADER_DUES_CUT_DEFAULT;
  const prizeShares =
    input.config.prize_shares ?? Array.from(FACTION_PRIZE_SHARES_DEFAULT);
  const tenureFloor =
    input.config.tenure_floor_years ?? FACTION_PRIZE_TENURE_FLOOR_YEARS;

  const leaderCut = input.config.leader_id
    ? Math.max(0, Math.floor(T * Math.max(0, leaderCutPct)))
    : 0;

  // Filter eligible candidates by tenure floor.
  const eligible = input.members.filter((m) => {
    if (m.faction_joined_year == null) return false;
    return m.faction_joined_year <= input.year - tenureFloor;
  });

  // Sort: faction_income_year desc, wealth desc, id asc.
  eligible.sort((a, b) => {
    if (b.faction_income_year !== a.faction_income_year) {
      return b.faction_income_year - a.faction_income_year;
    }
    if (b.wealth !== a.wealth) return b.wealth - a.wealth;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  // Compute prize amounts for each filled rank slot. Rank slots without a
  // qualifying member just stay in treasury (per design Q4).
  const ranks: PrizeWinner[] = [];
  for (let i = 0; i < prizeShares.length && i < eligible.length; i++) {
    const share = Math.max(0, prizeShares[i] ?? 0);
    const prize = Math.max(0, Math.floor(T * share));
    if (prize <= 0) continue;
    ranks.push({
      person_id: eligible[i].id,
      rank: i + 1,
      prize,
      income_this_year: eligible[i].faction_income_year,
    });
  }

  const totalPaid = leaderCut + ranks.reduce((s, r) => s + r.prize, 0);
  return {
    leader_id: input.config.leader_id,
    leader_cut: leaderCut,
    ranks,
    total_paid: totalPaid,
  };
}
