import { describe, it, expect } from 'vitest';
import { applyTrade } from '../../src/engine/economy/trade';
import { makeBucket } from './_helpers';

describe('applyTrade', () => {
  it('single-city is a no-op (v1 default)', () => {
    const cities = [
      {
        city_id: 'c1',
        buckets: [
          makeBucket('Merchant', { count: 30, avg_wealth: 200 }),
          makeBucket('Farmer', { count: 100, avg_wealth: 30 }),
        ],
      },
    ];
    const r = applyTrade(cities);
    expect(r.total_routed).toBe(0);
    expect(r.flows).toEqual([]);
  });

  it('routes wealth from richer to poorer city; merchant pockets a slice', () => {
    const richer = {
      city_id: 'c-rich',
      buckets: [
        makeBucket('Merchant', { count: 50, avg_wealth: 500 }),
        makeBucket('Noble', { count: 20, avg_wealth: 800 }),
      ],
    };
    const poorer = {
      city_id: 'c-poor',
      buckets: [
        makeBucket('Merchant', { count: 5, avg_wealth: 50 }),
        makeBucket('Farmer', { count: 100, avg_wealth: 30 }),
      ],
    };
    const r = applyTrade([richer, poorer]);
    expect(r.flows.length).toBeGreaterThan(0);
    const fromRich = r.flows.find((f) => f.from_city === 'c-rich')!;
    expect(fromRich.flow).toBeGreaterThan(0);
    expect(fromRich.merchant_cut).toBeLessThan(fromRich.flow);
    // Poorer city's bucket-wealth grows; richer city's non-Merchant shrinks.
    const richAfter = r.cities.find((c) => c.city_id === 'c-rich')!;
    const poorAfter = r.cities.find((c) => c.city_id === 'c-poor')!;
    const richTotalAfter = richAfter.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    const poorTotalAfter = poorAfter.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    const richTotalBefore = richer.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    const poorTotalBefore = poorer.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    expect(poorTotalAfter).toBeGreaterThan(poorTotalBefore);
    expect(richTotalAfter).toBeLessThan(richTotalBefore);
  });

  it('skips pairs where merchant_count = 0 in source', () => {
    const noMerchant = {
      city_id: 'c1',
      buckets: [makeBucket('Noble', { count: 20, avg_wealth: 800 })],
    };
    const poor = {
      city_id: 'c2',
      buckets: [makeBucket('Farmer', { count: 100, avg_wealth: 30 })],
    };
    const r = applyTrade([noMerchant, poor]);
    expect(r.flows).toEqual([]);
  });

  it('cross-city wealth approximately conserves (rounding ε)', () => {
    const a = {
      city_id: 'a',
      buckets: [
        makeBucket('Merchant', { count: 40, avg_wealth: 400 }),
        makeBucket('Noble', { count: 30, avg_wealth: 700 }),
      ],
    };
    const b = {
      city_id: 'b',
      buckets: [
        makeBucket('Merchant', { count: 10, avg_wealth: 100 }),
        makeBucket('Farmer', { count: 200, avg_wealth: 25 }),
      ],
    };
    const before = [a, b].reduce(
      (s, c) => s + c.buckets.reduce((t, x) => t + x.count * x.avg_wealth, 0),
      0,
    );
    const r = applyTrade([a, b]);
    const after = r.cities.reduce(
      (s, c) => s + c.buckets.reduce((t, x) => t + x.count * x.avg_wealth, 0),
      0,
    );
    // Per-bucket avg_wealth rounding can drift up to ~count/2 per bucket.
    const totalCount = [...a.buckets, ...b.buckets].reduce((s, x) => s + x.count, 0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(totalCount / 2);
  });
});
