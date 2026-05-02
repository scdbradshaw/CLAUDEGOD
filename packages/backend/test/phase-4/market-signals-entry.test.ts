// §6.4 v2 — buildMarketSignalsEntry shape + rounding tests.
//
// Exercises the pure helper that assembles one MarketSignalsEntry from
// runBucketDynamics diagnostics + buckets. This is what gets appended to
// World.market_signals_history each year.

import { describe, it, expect } from 'vitest';
import { buildMarketSignalsEntry } from '../../src/services/year.service';
import { makeBucket } from './_helpers';

const baseDiag = {
  delta_food: 0.0123456,
  delta_labor: 0.02,
  delta_craft: -0.012345,
  delta_capital: 0.0,
  food_ratio: 1.234567,
  food_produced: 1500.7654,
  food_needed: 1200.5,
};

describe('buildMarketSignalsEntry', () => {
  it('returns the expected shape with rounded numbers', () => {
    const entry = buildMarketSignalsEntry(42, baseDiag, [
      makeBucket('Farmer', { count: 1000, avg_wealth: 50 }),
      makeBucket('Laborer', { count: 400, avg_wealth: 60 }),
      makeBucket('Artisan', { count: 200, avg_wealth: 120 }),
      makeBucket('Merchant', { count: 80, avg_wealth: 200 }),
    ]);
    expect(entry.year).toBe(42);
    expect(entry.food_ratio).toBe(1.2346);
    expect(entry.delta_food).toBe(0.0123);
    expect(entry.delta_labor).toBe(0.02);
    expect(entry.delta_craft).toBe(-0.0123);
    expect(entry.delta_capital).toBe(0);
    expect(entry.food_produced).toBe(1500.8);
    expect(entry.food_needed).toBe(1200.5);
    expect(entry.classes.farmer).toEqual({ count: 1000, avg_wealth: 50 });
    expect(entry.classes.laborer).toEqual({ count: 400, avg_wealth: 60 });
    expect(entry.classes.artisan).toEqual({ count: 200, avg_wealth: 120 });
    expect(entry.classes.merchant).toEqual({ count: 80, avg_wealth: 200 });
  });

  it('zero-counts when a class bucket is missing', () => {
    const entry = buildMarketSignalsEntry(1, baseDiag, [
      makeBucket('Farmer', { count: 500, avg_wealth: 30 }),
      // no Laborer / Artisan / Merchant
    ]);
    expect(entry.classes.farmer.count).toBe(500);
    expect(entry.classes.laborer).toEqual({ count: 0, avg_wealth: 0 });
    expect(entry.classes.artisan).toEqual({ count: 0, avg_wealth: 0 });
    expect(entry.classes.merchant).toEqual({ count: 0, avg_wealth: 0 });
  });

  it('preserves negative deltas through rounding', () => {
    const entry = buildMarketSignalsEntry(10, {
      ...baseDiag,
      delta_food: -0.30001,
      delta_capital: -0.06,
    }, [makeBucket('Farmer', { count: 100 })]);
    expect(entry.delta_food).toBe(-0.3);
    expect(entry.delta_capital).toBe(-0.06);
  });

  it('JSON-serializes cleanly (no non-serializable types)', () => {
    const entry = buildMarketSignalsEntry(5, baseDiag, [
      makeBucket('Farmer', { count: 100 }),
    ]);
    const round = JSON.parse(JSON.stringify(entry));
    expect(round).toEqual(entry);
  });
});
