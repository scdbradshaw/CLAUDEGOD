// Stock-market class signals (DESIGN.md §6.4 v2).
//
// Pure function. Given the buckets in scope (one city today, or a world-roll-up
// later), the city's region_resource, and the active event tags, returns the
// four class-driven deltas that move the market_index this year:
//
//   Δ_food     — Farmer output vs world food demand
//   Δ_labor    — Laborer share of (Farmer + Artisan) producers
//   Δ_craft    — Artisan share × wealth ratio vs targets
//   Δ_capital  — Merchant capital velocity, with bubble detection
//
// The caller (stepMarket) adds a small residual noise floor and applies the
// total to market_index. food_ratio is also returned so the caller can persist
// it on the year's WorldStateSnapshot for cascade triggers.

import type { PersonType, RegionResource } from '@claude-god/shared';
import {
  ARTISAN_TARGET_SHARE,
  ARTISAN_TARGET_WEALTH_RATIO,
  CRAFT_MAX_BOOST,
  CRAFT_MAX_DRAG,
  CRAFT_WEIGHT,
  FARMER_FOOD_PER_HEAD,
  FOOD_EVENT_MOD_BOUNTY,
  FOOD_EVENT_MOD_DROUGHT,
  FOOD_EVENT_MOD_FAMINE,
  FOOD_MAX_BOOST,
  FOOD_MAX_DRAG,
  FOOD_PER_CAPITA,
  FOOD_WEIGHT,
  LABOR_DELTA_BOTTLENECK,
  LABOR_DELTA_HEALTHY,
  LABOR_DELTA_HIGH,
  LABOR_DELTA_LOW,
  LABOR_RATIO_BOTTLENECK,
  LABOR_RATIO_HIGH,
  LABOR_RATIO_LOW,
  LABOR_RATIO_OVERFULL,
  MERCHANT_DELTA_BUBBLE,
  MERCHANT_DELTA_FLOOR,
  MERCHANT_DELTA_HEALTHY,
  MERCHANT_IMBALANCE_BUBBLE,
  MERCHANT_IMBALANCE_HEALTHY_HIGH,
  MERCHANT_IMBALANCE_HEALTHY_LOW,
  MERCHANT_SHARE_FLOOR,
  REGION_PRODUCTION_BONUS,
} from '@claude-god/shared';
import type { BucketState } from '../bucket-dynamics/types';
import type { ActiveEventTags } from './types';

export interface ClassSignalsInput {
  buckets: BucketState[];
  /** Per-city region modifier source. Undefined → treat as `farmland`. */
  region?: RegionResource;
  events: ActiveEventTags;
}

export interface ClassSignalsResult {
  delta_food: number;
  delta_labor: number;
  delta_craft: number;
  delta_capital: number;
  /** Sum of the four deltas. The caller adds noise on top. */
  delta_total: number;
  /** food_produced / food_needed — pushed onto state_history for cascades. */
  food_ratio: number;
  /** Total food output (farmer count × per-head × region × event mods). */
  food_produced: number;
  /** Required food (population × FOOD_PER_CAPITA). */
  food_needed: number;
  /** Diagnostic — total population in this scope. */
  population: number;
}

const ZERO_RESULT: ClassSignalsResult = {
  delta_food: 0,
  delta_labor: 0,
  delta_craft: 0,
  delta_capital: 0,
  delta_total: 0,
  food_ratio: 1,
  food_produced: 0,
  food_needed: 0,
  population: 0,
};

export function computeClassSignals(input: ClassSignalsInput): ClassSignalsResult {
  const region = input.region ?? 'farmland';
  const regionMods = REGION_PRODUCTION_BONUS[region];
  const byType = bucketsByType(input.buckets);

  const farmer = byType.Farmer;
  const laborer = byType.Laborer;
  const artisan = byType.Artisan;
  const merchant = byType.Merchant;

  const population = input.buckets.reduce((s, b) => s + Math.max(0, b.count), 0);
  if (population <= 0) return ZERO_RESULT;

  // ── Food ──────────────────────────────────────────────────────────────────
  const farmerCount = farmer?.count ?? 0;
  const eventMod = foodEventMod(input.events);
  const foodProduced = farmerCount * FARMER_FOOD_PER_HEAD * regionMods.farmer * eventMod;
  const foodNeeded = population * FOOD_PER_CAPITA;
  const foodRatio = foodNeeded > 0 ? foodProduced / foodNeeded : 1;
  const deltaFood = clamp((foodRatio - 1) * FOOD_WEIGHT, -FOOD_MAX_DRAG, FOOD_MAX_BOOST);

  // ── Labor ─────────────────────────────────────────────────────────────────
  const effectiveLabor = (laborer?.count ?? 0) * regionMods.laborer;
  const effectiveProducers =
    farmerCount * regionMods.farmer + (artisan?.count ?? 0) * regionMods.artisan;
  const laborRatio = effectiveProducers > 0 ? effectiveLabor / effectiveProducers : 0;
  const deltaLabor = laborDeltaForRatio(laborRatio);

  // ── Craft (artisans) ──────────────────────────────────────────────────────
  const artisanCount = artisan?.count ?? 0;
  const artisanShare = artisanCount / population;
  const worldAvgWealth = countWeightedAvgWealth(input.buckets);
  const artisanAvgWealth = artisan?.avg_wealth ?? 0;
  const artisanWealthRatio = worldAvgWealth > 0 ? artisanAvgWealth / worldAvgWealth : 0;
  const craftSignal =
    (artisanShare / ARTISAN_TARGET_SHARE) *
    (artisanWealthRatio / ARTISAN_TARGET_WEALTH_RATIO);
  const deltaCraft = clamp(
    (craftSignal - 1) * CRAFT_WEIGHT,
    -CRAFT_MAX_DRAG,
    CRAFT_MAX_BOOST,
  );

  // ── Capital (merchants) ───────────────────────────────────────────────────
  const merchantCount = merchant?.count ?? 0;
  const merchantShare = merchantCount / population;
  const worldTotalWealth = totalWealth(input.buckets);
  const merchantTotalWealth = merchantCount * (merchant?.avg_wealth ?? 0);
  const merchantWealthShare =
    worldTotalWealth > 0 ? merchantTotalWealth / worldTotalWealth : 0;
  const imbalance = merchantShare > 0 ? merchantWealthShare / merchantShare : 0;

  let deltaCapital = 0;
  if (merchantShare < MERCHANT_SHARE_FLOOR) {
    deltaCapital = MERCHANT_DELTA_FLOOR;
  } else if (imbalance > MERCHANT_IMBALANCE_BUBBLE && deltaFood < 0) {
    deltaCapital = MERCHANT_DELTA_BUBBLE;
  } else if (
    imbalance >= MERCHANT_IMBALANCE_HEALTHY_LOW &&
    imbalance <= MERCHANT_IMBALANCE_HEALTHY_HIGH
  ) {
    deltaCapital = MERCHANT_DELTA_HEALTHY;
  }

  const deltaTotal = deltaFood + deltaLabor + deltaCraft + deltaCapital;

  return {
    delta_food: deltaFood,
    delta_labor: deltaLabor,
    delta_craft: deltaCraft,
    delta_capital: deltaCapital,
    delta_total: deltaTotal,
    food_ratio: foodRatio,
    food_produced: foodProduced,
    food_needed: foodNeeded,
    population,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function bucketsByType(buckets: BucketState[]): Partial<Record<PersonType, BucketState>> {
  const out: Partial<Record<PersonType, BucketState>> = {};
  for (const b of buckets) out[b.type] = b;
  return out;
}

function foodEventMod(e: ActiveEventTags): number {
  let m = 1;
  if (e.bountiful) m *= FOOD_EVENT_MOD_BOUNTY;
  if (e.drought) m *= FOOD_EVENT_MOD_DROUGHT;
  if (e.famine) m *= FOOD_EVENT_MOD_FAMINE;
  return m;
}

function laborDeltaForRatio(r: number): number {
  if (r < LABOR_RATIO_BOTTLENECK) return LABOR_DELTA_BOTTLENECK;
  if (r < LABOR_RATIO_LOW) return LABOR_DELTA_LOW;
  if (r <= LABOR_RATIO_HIGH) return LABOR_DELTA_HEALTHY;
  if (r <= LABOR_RATIO_OVERFULL) return LABOR_DELTA_HIGH;
  return 0; // diminishing returns above overfull — flat, not negative
}

function countWeightedAvgWealth(buckets: BucketState[]): number {
  let totalWealthSum = 0;
  let totalCount = 0;
  for (const b of buckets) {
    if (b.count <= 0) continue;
    totalWealthSum += b.count * b.avg_wealth;
    totalCount += b.count;
  }
  return totalCount > 0 ? totalWealthSum / totalCount : 0;
}

function totalWealth(buckets: BucketState[]): number {
  let s = 0;
  for (const b of buckets) {
    if (b.count <= 0) continue;
    s += b.count * b.avg_wealth;
  }
  return s;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
