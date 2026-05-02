// Phase 10 — economy-flow engine types.
//
// Pure data shapes for theft / dues / trade / real-person income + investment.
// Bucket dynamics extends BucketState with the group-share Json fields needed
// for dues math; the orchestrator round-trips them with the DB.

import type { GroupKind, GroupShares, PersonType, Race } from '@claude-god/shared';

/** Active event tag set the engine should honor for §6.1 income modifiers. */
export interface ActiveEventTags {
  war: boolean;
  plague: boolean;
  famine: boolean;
  drought: boolean;
  /** BountifulHarvest active. Read by the stock-market food signal as a
   *  multiplier on farmer output; income modifiers don't use it (yet). */
  bountiful: boolean;
  /** Boom = global market_index ≥ 1.6 per §6.1. Set by the year-pipeline. */
  boom: boolean;
}

/** Slim group row for dues math. */
export interface GroupForDues {
  id: string;
  kind: GroupKind;
  /** Flat per-member dues (factions). Religions ignore this and use cost_pct_of_wealth. */
  cost_per_year: number;
  /**
   * Religion-only — fraction of each member's wealth charged annually.
   * Null on factions. When set, this overrides cost_per_year for that group.
   */
  cost_pct_of_wealth: number | null;
  is_active: boolean;
  /** Used to sanity-cap dues at small membership groups; not strictly required. */
  member_count_cached: number;
}

/** Slim real-person row for the real-person economy phase. */
export interface RealPersonForEconomy {
  id: string;
  type: PersonType;
  wealth: number;
  intelligence: number;
  faction_id: string | null;
  religion_id: string | null;
  dues_missed_faction: number;
  dues_missed_religion: number;
}

/** Per-group dues collection result. */
export interface DuesGroupOutcome {
  group_id: string;
  /** Total wealth flowed into this group's treasury this year. */
  collected: number;
  /** Per-real-member outcomes — orchestrator uses these to update Person rows. */
  real_member_outcomes: RealMemberDuesOutcome[];
}

export interface RealMemberDuesOutcome {
  person_id: string;
  paid: number;
  /** New value to write back to Person.dues_missed_<kind>. */
  new_missed_count: number;
  /** True when person hit DUES_KICK_AFTER_MISSES — caller must null the FK
   * + decrement Group.member_count_cached + write a kicked memory. */
  kicked: boolean;
}

/** Race share map alias for clarity in trade flows. */
export type CityRaceShares = Partial<Record<Race, number>>;

/** Dues math input — mixes real members + bucket aggregates. */
export interface DuesInput {
  groups: GroupForDues[];
  realMembers: RealPersonForEconomy[];
  /**
   * For each group, total bucket-share contribution = sum over buckets of
   * `bucket.count × share × cost_per_year`. Computed by the caller from
   * Bucket.faction_shares / religion_shares so this engine module stays
   * BucketState-shape-agnostic. Returns `{ groupId: bucketTotalDues }`.
   */
  bucketDuesByGroup: Record<string, number>;
}

export interface DuesResult {
  outcomes: DuesGroupOutcome[];
  /** Sum of `collected` across all groups — diagnostic for invariants. */
  total_collected: number;
  /**
   * Sum of all wealth debited from real members. Combined with bucket dues,
   * this equals `total_collected` (dues conserves wealth: members → treasury).
   */
  total_real_debited: number;
  /** Bucket dues debited from aggregate buckets. */
  total_bucket_debited: number;
}
