// Phase 4 — market step tests (post §6.4 v2 class-driven rewrite).
//
// stepMarket no longer uses world.market_trend; the index moves on the
// class-signals delta plus a small noise floor. These tests verify the
// shape of that movement, the clamps, and the per-bucket investment math.

import { describe, it, expect } from 'vitest';
import { stepMarket, MARKET_INDEX_MIN, MARKET_INDEX_MAX } from '../../src/engine/bucket-dynamics/market';
import { makeRng } from '../../src/lib/rng';
import { makeBucket } from './_helpers';

describe('stepMarket', () => {
  it('moves the index by the class-signals delta plus small noise', () => {
    // Healthy economy: enough farmers to feed everyone, balanced classes.
    const buckets = [
      makeBucket('Farmer', { count: 1000, avg_wealth: 50 }),
      makeBucket('Laborer', { count: 400, avg_wealth: 60 }),
      makeBucket('Artisan', { count: 200, avg_wealth: 120 }),
      makeBucket('Merchant', { count: 80, avg_wealth: 200 }),
    ];
    const out = stepMarket({ market_index: 1.0, market_trend: 0 }, buckets, makeRng(1n));
    expect(out.world.market_index).toBeGreaterThanOrEqual(MARKET_INDEX_MIN);
    expect(out.world.market_index).toBeLessThanOrEqual(MARKET_INDEX_MAX);
    // Healthy economy on a clamped delta should land near 1.0 (±0.2 covers
    // food + labor + craft + capital + noise comfortably).
    expect(out.world.market_index).toBeGreaterThan(0.8);
    expect(out.world.market_index).toBeLessThan(1.2);
  });

  it('clamps index at MARKET_INDEX_MIN when the food signal saturates negative', () => {
    // Empty Farmer bucket → food_ratio=0 → Δ_food at floor (-0.30). Apply
    // repeatedly from a low starting index to drive into the floor.
    let world = { market_index: 0.15, market_trend: 0 };
    let buckets = [
      makeBucket('Farmer', { count: 0 }),
      makeBucket('Laborer', { count: 100 }),
    ];
    for (let i = 0; i < 5; i++) {
      const out = stepMarket(world, buckets, makeRng(BigInt(i + 1)));
      world = out.world;
      buckets = out.buckets;
    }
    expect(world.market_index).toBe(MARKET_INDEX_MIN);
  });

  it('clamps index at MARKET_INDEX_MAX when food signal saturates positive', () => {
    // Heavily farmer-loaded economy starting near the cap should clamp.
    const buckets = [
      makeBucket('Farmer', { count: 10000, avg_wealth: 100 }),
      makeBucket('Laborer', { count: 4000, avg_wealth: 100 }),
    ];
    const out = stepMarket(
      { market_index: 9.5, market_trend: 0 },
      buckets,
      makeRng(1n),
    );
    expect(out.world.market_index).toBe(MARKET_INDEX_MAX);
  });

  it('high-intelligence bucket gains more than low-intelligence at same positive move', () => {
    const seed = 42n;
    // Build a world where Δ_total is clearly positive: healthy farmer share,
    // wealthy artisans, balanced merchants. Both compared buckets share the
    // same starting wealth — only intelligence differs.
    const buckets = [
      makeBucket('Farmer',   { count: 3000, avg_wealth: 50 }),
      makeBucket('Laborer',  { count: 1200, avg_wealth: 100, avg_intelligence: 20 }),
      makeBucket('Scholar',  { count: 1200, avg_wealth: 100, avg_intelligence: 90 }),
      makeBucket('Artisan',  { count: 600,  avg_wealth: 200 }),
      makeBucket('Merchant', { count: 250,  avg_wealth: 200 }),
    ];
    const out = stepMarket({ market_index: 1.0, market_trend: 0 }, buckets, makeRng(seed));
    const dLaborer = out.buckets[1].avg_wealth - 100;
    const dScholar = out.buckets[2].avg_wealth - 100;
    expect(out.world.market_index).toBeGreaterThan(1.0); // sanity: positive move
    expect(dScholar).toBeGreaterThan(dLaborer);
  });

  it('zero-count or zero-wealth bucket is a no-op for investment returns', () => {
    const out = stepMarket(
      { market_index: 1.0, market_trend: 0 },
      [
        makeBucket('Farmer', { count: 0, avg_wealth: 100 }),
        makeBucket('Outlaw', { count: 100, avg_wealth: 0 }),
      ],
      makeRng(1n),
    );
    expect(out.buckets[0].avg_wealth).toBe(100);
    expect(out.buckets[1].avg_wealth).toBe(0);
  });

  it('exposes signals breakdown including food_ratio', () => {
    const out = stepMarket(
      { market_index: 1.0, market_trend: 0 },
      [makeBucket('Farmer', { count: 1000 }), makeBucket('Laborer', { count: 400 })],
      makeRng(1n),
    );
    expect(out.signals.food_ratio).toBeGreaterThan(0);
    expect(typeof out.signals.delta_food).toBe('number');
    expect(typeof out.signals.delta_labor).toBe('number');
    expect(typeof out.signals.delta_craft).toBe('number');
    expect(typeof out.signals.delta_capital).toBe('number');
  });
});
