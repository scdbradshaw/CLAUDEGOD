// Engine invariants (Phase 4).
//
// Checked at the end of every year-phase step in development; they encode
// the design promises that future phases must not break.
//
// 1. Counts and avg-wealths are non-negative.
// 2. Wealth conservation: world_wealth_after − world_wealth_before
//    must equal income_added − tax_collected_into_treasury + market_returns
//    (taxes don't leave the world — they move bucket→treasury, both counted).
//    Tolerance is ε per bucket because of integer rounding on avg_wealth.

import type { BucketState, CityState } from './types';

export class InvariantViolation extends Error {
  constructor(message: string) {
    super(`invariant_violation: ${message}`);
    this.name = 'InvariantViolation';
  }
}

export function totalBucketWealth(buckets: BucketState[]): number {
  return buckets.reduce((s, b) => s + Math.max(0, b.count) * Math.max(0, b.avg_wealth), 0);
}

export function totalWorldWealth(buckets: BucketState[], city: CityState): number {
  return totalBucketWealth(buckets) + Math.max(0, city.treasury);
}

export function assertNonNegative(buckets: BucketState[], city: CityState): void {
  if (city.treasury < 0) {
    throw new InvariantViolation(`city.treasury is negative: ${city.treasury}`);
  }
  for (const b of buckets) {
    if (b.count < 0) {
      throw new InvariantViolation(`bucket ${b.type}.count is negative: ${b.count}`);
    }
    if (b.avg_wealth < 0) {
      throw new InvariantViolation(
        `bucket ${b.type}.avg_wealth is negative: ${b.avg_wealth}`,
      );
    }
  }
}

/**
 * Confirm wealth conservation for the year.
 *
 *   wealth_after ≈ wealth_before + gross_income + market_returns
 *
 * Tax flows bucket→treasury inside `wealth_after` (so it's a wash). Births
 * dilute avg_wealth but preserve total. Deaths preserve total via inheritance.
 *
 * Tolerance: avg_wealth is rounded to an Int after each of (income, market,
 * births, deaths) → up to ±2 wealth per capita per bucket per year of
 * rounding drift, plus 2 for the treasury rounding.
 */
export function assertWealthConserved(
  before: number,
  after: number,
  grossIncome: number,
  marketReturns: number,
  totalCount: number,
): void {
  const expected = before + grossIncome + marketReturns;
  const drift = Math.abs(after - expected);
  const tolerance = totalCount * 2 + 2;
  if (drift > tolerance) {
    throw new InvariantViolation(
      `wealth conservation drift ${drift.toFixed(2)} > tolerance ${tolerance}: ` +
        `before=${before.toFixed(2)} after=${after.toFixed(2)} ` +
        `gross_income=${grossIncome.toFixed(2)} market_returns=${marketReturns.toFixed(2)}`,
    );
  }
}
