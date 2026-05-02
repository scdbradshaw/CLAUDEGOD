// Shared engine types for Phase 4 bucket-dynamics.
//
// Pure data shapes — no DB, no Prisma. Functions in this directory take and
// return these shapes; the orchestrator does the round-trip with the DB.

import type { GroupShares, PersonType, RegionResource } from '@claude-god/shared';

/** Slim subset of Prisma Bucket that the engine reads/writes during a year. */
export interface BucketState {
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
  /** §6.3 dues — fraction of bucket members affiliated to each faction/religion.
   * Optional so callers building synthetic buckets aren't forced to populate. */
  faction_shares?: GroupShares;
  religion_shares?: GroupShares;
}

/** Slim subset of City. Only fields the engine reads/writes in Phase 4. */
export interface CityState {
  treasury: number;
  /** 0–50 percent. */
  tax_rate: number;
  /** Drives the per-region production multipliers in stepMarket
   *  (REGION_PRODUCTION_BONUS). Optional so synthetic test fixtures can
   *  omit it — a missing value is treated as `farmland`. */
  region_resource?: RegionResource;
}

/** Slim subset of World. */
export interface WorldState {
  market_index: number;
  market_trend: number;
}
