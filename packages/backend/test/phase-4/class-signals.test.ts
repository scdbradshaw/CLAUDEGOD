// Phase 4 / §6.4 v2 — class-signals unit tests.
//
// Pure function. Verifies each of the four signals (food / labor / craft /
// capital) responds correctly in isolation, plus the region_resource
// modifiers and event-tag composition.

import { describe, it, expect } from 'vitest';
import {
  CRAFT_MAX_BOOST,
  FOOD_MAX_BOOST,
  FOOD_MAX_DRAG,
  LABOR_DELTA_BOTTLENECK,
  LABOR_DELTA_HEALTHY,
  MERCHANT_DELTA_BUBBLE,
  MERCHANT_DELTA_FLOOR,
  MERCHANT_DELTA_HEALTHY,
} from '@claude-god/shared';
import { computeClassSignals } from '../../src/engine/economy/class-signals';
import type { ActiveEventTags } from '../../src/engine/economy';
import { makeBucket } from './_helpers';

const NO_EVENTS: ActiveEventTags = {
  war: false,
  plague: false,
  famine: false,
  drought: false,
  bountiful: false,
  boom: false,
};

describe('computeClassSignals — food', () => {
  it('zero population returns all-zero deltas', () => {
    const r = computeClassSignals({
      buckets: [makeBucket('Farmer', { count: 0 })],
      events: NO_EVENTS,
    });
    expect(r.delta_total).toBe(0);
    expect(r.food_ratio).toBe(1);
  });

  it('starvation (no farmers) saturates the food drag', () => {
    const r = computeClassSignals({
      buckets: [makeBucket('Laborer', { count: 1000 })],
      events: NO_EVENTS,
    });
    expect(r.food_ratio).toBe(0);
    expect(r.delta_food).toBe(-FOOD_MAX_DRAG);
  });

  it('massive surplus saturates the food boost', () => {
    const r = computeClassSignals({
      buckets: [makeBucket('Farmer', { count: 10000 })],
      events: NO_EVENTS,
    });
    expect(r.food_ratio).toBeGreaterThan(1);
    expect(r.delta_food).toBe(FOOD_MAX_BOOST);
  });

  it('balanced food (~ratio 1) gives near-zero food delta on a neutral region', () => {
    // 1000 farmers × 1.5 food/head = 1500 units; population 1500 → ratio = 1
    // Use a neutral region (coast) so the farmer modifier doesn't skew it.
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 1000 }),
        makeBucket('Laborer', { count: 500 }),
      ],
      region: 'coast',
      events: NO_EVENTS,
    });
    expect(Math.abs(r.food_ratio - 1)).toBeLessThan(0.001);
    expect(Math.abs(r.delta_food)).toBeLessThan(0.001);
  });

  it('Famine event multiplies farmer output downward', () => {
    const buckets = [makeBucket('Farmer', { count: 1000 }), makeBucket('Laborer', { count: 500 })];
    const baseline = computeClassSignals({ buckets, events: NO_EVENTS });
    const famined = computeClassSignals({
      buckets,
      events: { ...NO_EVENTS, famine: true },
    });
    expect(famined.food_ratio).toBeLessThan(baseline.food_ratio);
    expect(famined.delta_food).toBeLessThan(baseline.delta_food);
  });

  it('BountifulHarvest event multiplies farmer output upward', () => {
    const buckets = [makeBucket('Farmer', { count: 600 }), makeBucket('Laborer', { count: 500 })];
    const baseline = computeClassSignals({ buckets, events: NO_EVENTS });
    const bumper = computeClassSignals({
      buckets,
      events: { ...NO_EVENTS, bountiful: true },
    });
    expect(bumper.food_ratio).toBeGreaterThan(baseline.food_ratio);
  });
});

describe('computeClassSignals — region modifier', () => {
  it('farmland boosts farmer output above neutral', () => {
    const buckets = [makeBucket('Farmer', { count: 600 }), makeBucket('Laborer', { count: 500 })];
    const neutral = computeClassSignals({ buckets, region: 'coast', events: NO_EVENTS });
    const farmland = computeClassSignals({ buckets, region: 'farmland', events: NO_EVENTS });
    expect(farmland.food_ratio).toBeGreaterThan(neutral.food_ratio);
  });

  it('desert reduces farmer output below neutral', () => {
    const buckets = [makeBucket('Farmer', { count: 1000 }), makeBucket('Laborer', { count: 500 })];
    const neutral = computeClassSignals({ buckets, region: 'coast', events: NO_EVENTS });
    const desert = computeClassSignals({ buckets, region: 'desert', events: NO_EVENTS });
    expect(desert.food_ratio).toBeLessThan(neutral.food_ratio);
  });
});

describe('computeClassSignals — labor', () => {
  it('healthy band returns the positive labor delta', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 1000 }),
        makeBucket('Laborer', { count: 500 }), // 500/1000 = 0.5 → healthy band
        makeBucket('Artisan', { count: 0 }),
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_labor).toBe(LABOR_DELTA_HEALTHY);
  });

  it('bottleneck (very few laborers) returns the floor delta', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 1000 }),
        makeBucket('Laborer', { count: 50 }), // 0.05 < 0.20 → bottleneck
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_labor).toBe(LABOR_DELTA_BOTTLENECK);
  });

  it('very high labor share returns flat zero (diminishing returns)', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 100 }),
        makeBucket('Laborer', { count: 500 }), // ratio 5.0 — well above overfull
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_labor).toBe(0);
  });
});

describe('computeClassSignals — craft (artisans)', () => {
  it('absent artisan class drags craft signal negative', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 1000 }),
        makeBucket('Laborer', { count: 500 }),
        makeBucket('Artisan', { count: 0 }),
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_craft).toBeLessThan(0);
  });

  it('artisan-rich + wealthy gives positive craft signal', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 700, avg_wealth: 50 }),
        makeBucket('Laborer', { count: 200, avg_wealth: 50 }),
        makeBucket('Artisan', { count: 200, avg_wealth: 200 }), // 20% share, 4× world avg
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_craft).toBeGreaterThan(0);
    expect(r.delta_craft).toBeLessThanOrEqual(CRAFT_MAX_BOOST + 0.0001);
  });
});

describe('computeClassSignals — capital (merchants)', () => {
  it('floor: too-few merchants returns the floor delta', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 1000 }),
        makeBucket('Laborer', { count: 500 }),
        makeBucket('Merchant', { count: 10, avg_wealth: 200 }), // < 3% share
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_capital).toBe(MERCHANT_DELTA_FLOOR);
  });

  it('healthy band: balanced merchant share + wealth concentration', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 700, avg_wealth: 50 }),
        makeBucket('Laborer', { count: 200, avg_wealth: 50 }),
        makeBucket('Merchant', { count: 100, avg_wealth: 130 }),
        // total wealth 35000+10000+13000 = 58000
        // merchant share 10%, wealth share 13000/58000 ≈ 22.4% → imbalance ≈ 2.24 (healthy)
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_capital).toBe(MERCHANT_DELTA_HEALTHY);
  });

  it('bubble: massive imbalance + negative food signal returns bubble drag', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 100, avg_wealth: 10 }),  // food ratio low
        makeBucket('Laborer', { count: 500, avg_wealth: 30 }),
        makeBucket('Merchant', { count: 100, avg_wealth: 5000 }), // hoarding wealth
      ],
      events: NO_EVENTS,
    });
    expect(r.delta_food).toBeLessThan(0);
    expect(r.delta_capital).toBe(MERCHANT_DELTA_BUBBLE);
  });
});

describe('computeClassSignals — composition', () => {
  it('balanced economy: total delta close to zero', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 700, avg_wealth: 50 }),
        makeBucket('Laborer', { count: 350, avg_wealth: 60 }),
        makeBucket('Artisan', { count: 130, avg_wealth: 100 }),
        makeBucket('Merchant', { count: 80, avg_wealth: 200 }),
      ],
      events: NO_EVENTS,
    });
    expect(Math.abs(r.delta_total)).toBeLessThan(0.1);
  });

  it('delta_total is the sum of the four components', () => {
    const r = computeClassSignals({
      buckets: [
        makeBucket('Farmer', { count: 1000 }),
        makeBucket('Laborer', { count: 500 }),
        makeBucket('Artisan', { count: 100 }),
        makeBucket('Merchant', { count: 60 }),
      ],
      events: NO_EVENTS,
    });
    const expected = r.delta_food + r.delta_labor + r.delta_craft + r.delta_capital;
    expect(r.delta_total).toBeCloseTo(expected, 10);
  });
});
