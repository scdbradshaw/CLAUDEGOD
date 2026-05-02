// Phase 4 — income + tax tests.

import { describe, it, expect } from 'vitest';
import { applyIncomeAndTax } from '../../src/engine/bucket-dynamics/income';
import { TYPE_INCOME_BASES } from '../../src/engine/income-rates';
import { makeRng } from '../../src/lib/rng';
import { makeBucket } from './_helpers';

describe('applyIncomeAndTax', () => {
  it('adds gross income to bucket wealth and tax to treasury', () => {
    const rng = makeRng(1n);
    const buckets = [makeBucket('Farmer', { count: 100, avg_wealth: 30 })];
    const out = applyIncomeAndTax(buckets, { treasury: 0, tax_rate: 10 }, rng);

    // Gross ≈ 100 × 6 × jitter; tax = 10% of gross; net = 90% to bucket.
    expect(out.gross_added).toBeGreaterThan(0);
    expect(out.tax_collected).toBeCloseTo(out.gross_added * 0.1, 0);
    expect(out.city.treasury).toBeCloseTo(out.tax_collected, 0);
    expect(out.buckets[0].avg_wealth).toBeGreaterThan(30);
  });

  it('zero-count bucket is a no-op', () => {
    const rng = makeRng(1n);
    const buckets = [makeBucket('Farmer', { count: 0, avg_wealth: 30 })];
    const out = applyIncomeAndTax(buckets, { treasury: 100, tax_rate: 10 }, rng);
    expect(out.gross_added).toBe(0);
    expect(out.tax_collected).toBe(0);
    expect(out.city.treasury).toBe(100);
    expect(out.buckets[0]).toEqual(buckets[0]);
  });

  it('clamps tax rate to [0, 50]', () => {
    const rng = makeRng(1n);
    const buckets = [makeBucket('Noble', { count: 10, avg_wealth: 300 })];
    const out = applyIncomeAndTax(buckets, { treasury: 0, tax_rate: 99 }, rng);
    // tax_rate 99 should be capped at 50, so tax ≤ 0.5 × gross.
    expect(out.tax_collected).toBeLessThanOrEqual(out.gross_added * 0.5 + 0.0001);
  });

  it('does not mutate inputs', () => {
    const rng = makeRng(1n);
    const buckets = [makeBucket('Farmer', { count: 100, avg_wealth: 30 })];
    const city = { treasury: 0, tax_rate: 10 };
    const before = JSON.stringify(buckets);
    applyIncomeAndTax(buckets, city, rng);
    expect(JSON.stringify(buckets)).toBe(before);
    expect(city.treasury).toBe(0);
  });

  it('income scale matches TYPE_INCOME_BASES (no jitter)', () => {
    // Pin jitter near zero by averaging many runs.
    let totalGross = 0;
    const N = 200;
    for (let i = 0; i < N; i++) {
      const rng = makeRng(BigInt(i));
      const out = applyIncomeAndTax(
        [makeBucket('Farmer', { count: 1000, avg_wealth: 30 })],
        { treasury: 0, tax_rate: 0 },
        rng,
      );
      totalGross += out.gross_added;
    }
    const avgGross = totalGross / N;
    const expected = 1000 * TYPE_INCOME_BASES.Farmer;
    expect(Math.abs(avgGross - expected) / expected).toBeLessThan(0.02);
  });
});
