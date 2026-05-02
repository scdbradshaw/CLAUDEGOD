// Global market step + per-bucket investment (Phase 4 — DESIGN.md §6.4 v2).
//
// 1. Compute the four lower-class signals (food / labor / craft / capital)
//    from the in-scope buckets + this city's region_resource. Add a small
//    residual noise floor so a perfectly balanced economy still wiggles.
// 2. Apply the resulting Δ to world.market_index and clamp.
// 3. Each bucket invests `(avg_intelligence/100) × bucket_total_wealth` and
//    earns `invested × (new_index/old_index − 1)`. Smart buckets compound
//    faster (and lose harder).
//
// Wealth-conservation note: this is the ONLY step besides income that
// changes total world wealth. The orchestrator's invariants helper accounts
// for it via the diagnostic `market_returns` field.

import { MARKET_NOISE_HALF } from '@claude-god/shared';
import { computeClassSignals } from '../economy/class-signals';
import type { ActiveEventTags } from '../economy/types';
import type { Rng } from '../../lib/rng';
import type { BucketState, CityState, WorldState } from './types';

/** Index clamps from §6.4 — boom/depression conditions live above 1.6 / below 0.5. */
export const MARKET_INDEX_MIN = 0.1;
export const MARKET_INDEX_MAX = 10;

const NO_EVENTS: ActiveEventTags = {
  war: false,
  plague: false,
  famine: false,
  drought: false,
  bountiful: false,
  boom: false,
};

export interface MarketStepResult {
  buckets: BucketState[];
  world: WorldState;
  /** Diagnostic — net wealth created (or destroyed) by market returns. */
  market_returns: number;
  /** Diagnostic — index before drift. */
  prev_index: number;
  /** Class-signals breakdown for diagnostics + cascade-trigger snapshot. */
  signals: {
    delta_food: number;
    delta_labor: number;
    delta_craft: number;
    delta_capital: number;
    food_ratio: number;
    food_produced: number;
    food_needed: number;
  };
}

/**
 * Step the global market once, then apply per-bucket investment returns.
 * Pure: inputs not mutated.
 */
export function stepMarket(
  world: WorldState,
  buckets: BucketState[],
  rng: Rng,
  city?: CityState,
  events?: ActiveEventTags,
): MarketStepResult {
  const prev = world.market_index;

  const sig = computeClassSignals({
    buckets,
    region: city?.region_resource,
    events: events ?? NO_EVENTS,
  });
  const noise = (rng.next() * 2 - 1) * MARKET_NOISE_HALF;
  const driftedRaw = prev * (1 + sig.delta_total + noise);
  const next = clamp(driftedRaw, MARKET_INDEX_MIN, MARKET_INDEX_MAX);
  const ratio = next / prev - 1;

  let marketReturns = 0;
  const nextBuckets: BucketState[] = buckets.map((b) => {
    if (b.count <= 0 || b.avg_wealth <= 0) return { ...b };
    const totalWealth = b.count * b.avg_wealth;
    const invested = totalWealth * (b.avg_intelligence / 100);
    const gain = invested * ratio;
    marketReturns += gain;
    const newTotal = Math.max(0, totalWealth + gain);
    const newAvgWealth = Math.max(0, Math.round(newTotal / b.count));
    return { ...b, avg_wealth: newAvgWealth };
  });

  return {
    buckets: nextBuckets,
    world: { ...world, market_index: round4(next) },
    market_returns: marketReturns,
    prev_index: prev,
    signals: {
      delta_food: sig.delta_food,
      delta_labor: sig.delta_labor,
      delta_craft: sig.delta_craft,
      delta_capital: sig.delta_capital,
      food_ratio: sig.food_ratio,
      food_produced: sig.food_produced,
      food_needed: sig.food_needed,
    },
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
