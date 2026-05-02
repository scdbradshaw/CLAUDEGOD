// Phase 2 — world-seed.test.ts
//
// Pure-function tests against `buildWorldSeed`. No DB required: the seed
// computation is deterministic and side-effect free, so we can verify shape,
// race-share distribution, region bias, and seed-determinism in isolation.
//
// Acceptance gates from DESIGN.md §20.2:
//   - World-seed snapshot test (single city, 10 buckets)
//   - Race-share distributions match config ±2%
//   - region_resource bias produces expected farmer/coast skew

import { describe, it, expect } from 'vitest';
import { PERSON_TYPES, RACES, type PersonType } from '@claude-god/shared';
import {
  buildWorldSeed,
  DEFAULT_SEED_POPULATION,
} from '../../src/services/world.service';

const FIXED_SEED = 12345678901234567890n;

function build(opts: Partial<Parameters<typeof buildWorldSeed>[0]> = {}) {
  return buildWorldSeed({
    name: 'Test World',
    city_name: 'Test City',
    region_resource: 'farmland',
    seed_population: 10_000,
    random_seed_root: FIXED_SEED,
    ...opts,
  });
}

describe('Phase 2 — buildWorldSeed structure', () => {
  it('produces exactly 1 city + 10 buckets keyed by PersonType', () => {
    const seed = build();
    expect(seed.city.name).toBe('Test City');
    expect(seed.buckets).toHaveLength(PERSON_TYPES.length);
    const types = seed.buckets.map((b) => b.type).sort();
    expect(types).toEqual([...PERSON_TYPES].sort());
  });

  it('total bucket count equals seed_population (largest-remainder rounding)', () => {
    const seed = build({ seed_population: 10_000 });
    const sum = seed.buckets.reduce((s, b) => s + b.count, 0);
    expect(sum).toBe(10_000);
  });

  it('bucket count exact for unusual populations (rounding edge)', () => {
    for (const pop of [1, 7, 99, 1234, 999_999]) {
      const sum = build({ seed_population: pop }).buckets.reduce((s, b) => s + b.count, 0);
      expect(sum).toBe(pop);
    }
  });

  it('city rollups derive from bucket counts/avgs', () => {
    const seed = build();
    expect(seed.city.population_total).toBe(
      seed.buckets.reduce((s, b) => s + b.count, 0),
    );
    expect(seed.city.region_resource).toBe('farmland');
    expect(seed.city.founded_year).toBe(0);
    expect(seed.world.current_year).toBe(0);
    expect(seed.world.market_index).toBe(1.0);
    expect(seed.world.random_seed_root).toBe(FIXED_SEED);
  });

  it('default seed population is DEFAULT_SEED_POPULATION', () => {
    const seed = buildWorldSeed({
      name: 'A',
      city_name: 'B',
      random_seed_root: FIXED_SEED,
    });
    expect(seed.city.population_total).toBe(DEFAULT_SEED_POPULATION);
  });
});

describe('Phase 2 — race-share distribution (§20.2)', () => {
  it('every bucket has all 10 races and shares sum to 1.0 ±0.001', () => {
    const seed = build();
    for (const b of seed.buckets) {
      const keys = Object.keys(b.race_shares).sort();
      expect(keys).toEqual([...RACES].sort());
      const total = Object.values(b.race_shares).reduce((s, v) => s + (v ?? 0), 0);
      expect(Math.abs(total - 1.0)).toBeLessThan(0.001);
    }
  });

  it('every race share is within ±2% of 0.10 in every bucket', () => {
    const seed = build();
    for (const b of seed.buckets) {
      for (const r of RACES) {
        const share = b.race_shares[r] ?? 0;
        expect(share).toBeGreaterThanOrEqual(0.08);
        expect(share).toBeLessThanOrEqual(0.12);
      }
    }
  });
});

describe('Phase 2 — region_resource bias (§20.2)', () => {
  function countsByType(region: Parameters<typeof build>[0] extends infer T ? T : never) {
    const seed = build({ region_resource: region as any });
    const map: Partial<Record<PersonType, number>> = {};
    for (const b of seed.buckets) map[b.type] = b.count;
    return map as Record<PersonType, number>;
  }

  it('farmland boosts Farmer to be the largest bucket', () => {
    const counts = countsByType('farmland' as any);
    const max = Math.max(...PERSON_TYPES.map((t) => counts[t]));
    expect(counts.Farmer).toBe(max);
  });

  it('coast boosts Merchant well above its base share', () => {
    const baseline = countsByType('farmland' as any).Merchant;
    const coastCounts = countsByType('coast' as any);
    expect(coastCounts.Merchant).toBeGreaterThan(baseline);
  });

  it('mountains boosts Soldier above its baseline (farmland) count', () => {
    const baseline = countsByType('farmland' as any).Soldier;
    const mountainCounts = countsByType('mountains' as any);
    expect(mountainCounts.Soldier).toBeGreaterThan(baseline);
  });

  it('forest boosts Outlaw above its baseline (farmland) count', () => {
    const baseline = countsByType('farmland' as any).Outlaw;
    const forestCounts = countsByType('forest' as any);
    expect(forestCounts.Outlaw).toBeGreaterThan(baseline);
  });
});

describe('Phase 2 — determinism (§15.2.1)', () => {
  it('same seed_root → byte-identical buckets', () => {
    const a = build();
    const b = build();
    expect(a).toEqual(b);
  });

  it('different seed_root → different bucket stat draws', () => {
    const a = build({ random_seed_root: 1n });
    const b = build({ random_seed_root: 2n });
    // Counts may collide (same population, same ratios); race shares should
    // differ on at least one bucket because they're rng-jittered per bucket.
    const aShares = JSON.stringify(a.buckets.map((x) => x.race_shares));
    const bShares = JSON.stringify(b.buckets.map((x) => x.race_shares));
    expect(aShares).not.toBe(bShares);
  });
});

describe('Phase 2 — non-negativity invariants (§20.1)', () => {
  it('no negative counts, wealth, or stats', () => {
    const seed = build();
    for (const b of seed.buckets) {
      expect(b.count).toBeGreaterThanOrEqual(0);
      expect(b.avg_wealth).toBeGreaterThanOrEqual(0);
      expect(b.avg_intelligence).toBeGreaterThanOrEqual(0);
      expect(b.avg_combat).toBeGreaterThanOrEqual(0);
      expect(b.avg_health).toBeGreaterThanOrEqual(0);
      expect(b.avg_happiness).toBeGreaterThanOrEqual(0);
      expect(b.avg_sexuality).toBeGreaterThanOrEqual(0);
    }
    expect(seed.city.treasury).toBeGreaterThanOrEqual(0);
    expect(seed.world.market_index).toBeGreaterThanOrEqual(0);
  });

  it('all stat averages stay within [0, 100]', () => {
    const seed = build();
    for (const b of seed.buckets) {
      for (const stat of [b.avg_intelligence, b.avg_combat, b.avg_health, b.avg_happiness, b.avg_sexuality]) {
        expect(stat).toBeGreaterThanOrEqual(0);
        expect(stat).toBeLessThanOrEqual(100);
      }
    }
  });
});
