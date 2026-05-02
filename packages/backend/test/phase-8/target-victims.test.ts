import { describe, it, expect } from 'vitest';
import {
  pickEventVictims,
  type CandidateLite,
} from '../../src/engine/events/target-victims';
import { makeRng } from '../../src/lib/rng';
import type { RealPersonTargetRule } from '@claude-god/shared';

const candidates: CandidateLite[] = Array.from({ length: 20 }, (_, i) => ({
  id: `p${i}`,
  city_id: i < 10 ? 'c1' : 'c2',
  type: i % 2 === 0 ? 'Farmer' : 'Soldier',
  faction_id: i < 5 ? 'f1' : null,
}));

describe('pickEventVictims', () => {
  it('returns empty when pool is empty after filter', () => {
    const rule: RealPersonTargetRule = {
      count_min: 1,
      count_max: 3,
      pool: { city_id: 'c-missing' },
      apply: { kill: true },
    };
    expect(pickEventVictims(rule, candidates, makeRng(1n))).toEqual([]);
  });

  it('honors count bounds [min, max]', () => {
    const rule: RealPersonTargetRule = {
      count_min: 2,
      count_max: 5,
      pool: {},
      apply: { kill: true },
    };
    for (let s = 1; s < 30; s++) {
      const picks = pickEventVictims(rule, candidates, makeRng(BigInt(s)));
      expect(picks.length).toBeGreaterThanOrEqual(2);
      expect(picks.length).toBeLessThanOrEqual(5);
    }
  });

  it('count_min === count_max returns exactly that count', () => {
    const rule: RealPersonTargetRule = {
      count_min: 3,
      count_max: 3,
      pool: {},
      apply: { kill: true },
    };
    expect(pickEventVictims(rule, candidates, makeRng(7n))).toHaveLength(3);
  });

  it('caps to pool size', () => {
    const rule: RealPersonTargetRule = {
      count_min: 5,
      count_max: 8,
      pool: { faction_id: 'f1' }, // only 5 candidates have f1
      apply: { kill: true },
    };
    const picks = pickEventVictims(rule, candidates, makeRng(1n));
    expect(picks.length).toBeLessThanOrEqual(5);
    for (const id of picks) {
      const c = candidates.find((x) => x.id === id);
      expect(c?.faction_id).toBe('f1');
    }
  });

  it('filters by city + type combined', () => {
    const rule: RealPersonTargetRule = {
      count_min: 1,
      count_max: 5,
      pool: { city_id: 'c1', type: 'Farmer' },
      apply: { kill: true },
    };
    const picks = pickEventVictims(rule, candidates, makeRng(11n));
    for (const id of picks) {
      const c = candidates.find((x) => x.id === id);
      expect(c?.city_id).toBe('c1');
      expect(c?.type).toBe('Farmer');
    }
  });

  it('is deterministic for the same seed', () => {
    const rule: RealPersonTargetRule = {
      count_min: 3,
      count_max: 3,
      pool: {},
      apply: { kill: true },
    };
    const a = pickEventVictims(rule, candidates, makeRng(42n));
    const b = pickEventVictims(rule, candidates, makeRng(42n));
    expect(a).toEqual(b);
  });

  it('does not pick duplicates', () => {
    const rule: RealPersonTargetRule = {
      count_min: 5,
      count_max: 5,
      pool: {},
      apply: { kill: true },
    };
    const picks = pickEventVictims(rule, candidates, makeRng(99n));
    expect(new Set(picks).size).toBe(picks.length);
  });
});
