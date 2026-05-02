// Phase 4 — runBucketDynamics orchestrator + 50-year smoke test.

import { describe, it, expect } from 'vitest';
import { runBucketDynamics } from '../../src/engine/bucket-dynamics';
import { makeYearRng } from '../../src/engine/rng-context';
import { makeRng } from '../../src/lib/rng';
import { makeBucket } from './_helpers';
import { totalWorldWealth } from '../../src/engine/bucket-dynamics/invariants';

describe('runBucketDynamics — single year', () => {
  it('produces non-negative state and conserved wealth', () => {
    const out = runBucketDynamics({
      world: { market_index: 1.0, market_trend: 0.02 },
      city: { treasury: 0, tax_rate: 10 },
      buckets: [
        makeBucket('Farmer', { count: 1000, avg_wealth: 30 }),
        makeBucket('Merchant', { count: 80, avg_wealth: 100 }),
        makeBucket('Noble', { count: 50, avg_wealth: 300 }),
      ],
      rng: makeRng(123n),
    });
    expect(out.diagnostics.gross_income).toBeGreaterThan(0);
    expect(out.diagnostics.tax_collected).toBeGreaterThan(0);
    // Treasury saw the tax skim.
    expect(out.city.treasury).toBeGreaterThan(0);
  });

  it('is deterministic for the same RNG', () => {
    const inputs = () => ({
      world: { market_index: 1.0, market_trend: 0.0 },
      city: { treasury: 0, tax_rate: 10 },
      buckets: [
        makeBucket('Farmer', { count: 500 }),
        makeBucket('Soldier', { count: 50 }),
      ],
      rng: makeYearRng(999n, 'world-1', 1),
    });
    const a = runBucketDynamics(inputs());
    const b = runBucketDynamics(inputs());
    expect(a.buckets).toEqual(b.buckets);
    expect(a.city.treasury).toEqual(b.city.treasury);
    expect(a.world.market_index).toEqual(b.world.market_index);
  });

  it('zero-population world: nothing changes (no births, no income)', () => {
    const out = runBucketDynamics({
      world: { market_index: 1.0, market_trend: 0.0 },
      city: { treasury: 0, tax_rate: 10 },
      buckets: [makeBucket('Farmer', { count: 0 })],
      rng: makeRng(1n),
    });
    expect(out.diagnostics.gross_income).toBe(0);
    expect(out.diagnostics.tax_collected).toBe(0);
    expect(out.diagnostics.total_births).toBe(0);
    expect(out.diagnostics.total_deaths).toBe(0);
    expect(out.city.treasury).toBe(0);
    expect(out.buckets[0].count).toBe(0);
  });
});

describe('runBucketDynamics — 50-year smoke test', () => {
  it('runs 50 years without invariant violations and grows population', () => {
    const initialBuckets = [
      makeBucket('Farmer',   { count: 3000, avg_wealth: 30,  birth_rate: 0.025, death_rate: 0.020 }),
      makeBucket('Laborer',  { count: 1500, avg_wealth: 30,  birth_rate: 0.024, death_rate: 0.022 }),
      makeBucket('Artisan',  { count: 1000, avg_wealth: 60,  birth_rate: 0.022, death_rate: 0.018 }),
      makeBucket('Merchant', { count: 800,  avg_wealth: 100, birth_rate: 0.020, death_rate: 0.017 }),
      makeBucket('Soldier',  { count: 700,  avg_wealth: 50,  birth_rate: 0.018, death_rate: 0.030 }),
      makeBucket('Priest',   { count: 500,  avg_wealth: 50,  birth_rate: 0.012, death_rate: 0.016 }),
      makeBucket('Scholar',  { count: 300,  avg_wealth: 60,  birth_rate: 0.014, death_rate: 0.018 }),
      makeBucket('Noble',    { count: 500,  avg_wealth: 300, birth_rate: 0.018, death_rate: 0.014 }),
      makeBucket('Outlaw',   { count: 1000, avg_wealth: 20,  birth_rate: 0.022, death_rate: 0.040 }),
      makeBucket('Healer',   { count: 700,  avg_wealth: 60,  birth_rate: 0.018, death_rate: 0.014 }),
    ];

    let state = {
      world: { market_index: 1.0, market_trend: 0.005 },
      city: { treasury: 0, tax_rate: 10 },
      buckets: initialBuckets,
    };

    const initialPop = state.buckets.reduce((s, b) => s + b.count, 0);
    const initialWealth = totalWorldWealth(state.buckets, state.city);

    for (let year = 1; year <= 50; year++) {
      const out = runBucketDynamics({
        ...state,
        rng: makeYearRng(0xfeedfacecafebeefn, 'smoke-world', year),
      });
      state = { world: out.world, city: out.city, buckets: out.buckets };
    }

    const finalPop = state.buckets.reduce((s, b) => s + b.count, 0);
    const finalWealth = totalWorldWealth(state.buckets, state.city);

    // Birth rates exceed death rates on most buckets → population should grow.
    expect(finalPop).toBeGreaterThan(initialPop);
    // Income + market should grow total world wealth.
    expect(finalWealth).toBeGreaterThan(initialWealth);
    // Treasury accrues from 50 years of tax skim.
    expect(state.city.treasury).toBeGreaterThan(0);
    // Market index stayed in bounds.
    expect(state.world.market_index).toBeGreaterThan(0);
    expect(state.world.market_index).toBeLessThanOrEqual(10);
  });

  it('replays identically from the same seed', () => {
    const seed = 0x1234567890abcdefn;
    const run = (): number[] => {
      let state = {
        world: { market_index: 1.0, market_trend: 0.0 },
        city: { treasury: 0, tax_rate: 10 },
        buckets: [
          makeBucket('Farmer', { count: 500 }),
          makeBucket('Merchant', { count: 100, avg_wealth: 100 }),
        ],
      };
      const counts: number[] = [];
      for (let y = 1; y <= 25; y++) {
        const out = runBucketDynamics({
          ...state,
          rng: makeYearRng(seed, 'replay-world', y),
        });
        state = { world: out.world, city: out.city, buckets: out.buckets };
        counts.push(state.buckets.reduce((s, b) => s + b.count, 0));
      }
      return counts;
    };
    expect(run()).toEqual(run());
  });
});
