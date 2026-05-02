// Phase 4 — bucket drift tests.

import { describe, it, expect } from 'vitest';
import { applyDrift, DRIFT_STEP_MAX } from '../../src/engine/bucket-dynamics/drift';
import { makeRng } from '../../src/lib/rng';
import { makeBucket } from './_helpers';

describe('applyDrift', () => {
  it('moves stats by ≤ DRIFT_STEP_MAX per year', () => {
    const rng = makeRng(1n);
    const before = makeBucket('Farmer');
    const [after] = applyDrift([before], rng);
    expect(Math.abs(after.avg_intelligence - before.avg_intelligence)).toBeLessThanOrEqual(DRIFT_STEP_MAX);
    expect(Math.abs(after.avg_combat - before.avg_combat)).toBeLessThanOrEqual(DRIFT_STEP_MAX);
    expect(Math.abs(after.avg_health - before.avg_health)).toBeLessThanOrEqual(DRIFT_STEP_MAX);
    expect(Math.abs(after.avg_happiness - before.avg_happiness)).toBeLessThanOrEqual(DRIFT_STEP_MAX);
    expect(Math.abs(after.avg_sexuality - before.avg_sexuality)).toBeLessThanOrEqual(DRIFT_STEP_MAX);
  });

  it('does not drift birth_rate, death_rate, count, or avg_age', () => {
    const rng = makeRng(99n);
    const before = makeBucket('Farmer', {
      birth_rate: 0.025,
      death_rate: 0.018,
      avg_age: 30,
      count: 100,
    });
    const [after] = applyDrift([before], rng);
    expect(after.birth_rate).toBe(0.025);
    expect(after.death_rate).toBe(0.018);
    expect(after.avg_age).toBe(30);
    expect(after.count).toBe(100);
  });

  it('clamps stats to [0, 100]', () => {
    const rng = makeRng(1n);
    const buckets = [
      makeBucket('Farmer', { avg_intelligence: 0, avg_combat: 100 }),
    ];
    // Run many years; values must stay in bounds even if the walk biases hard.
    let state = buckets;
    for (let y = 0; y < 1000; y++) {
      state = applyDrift(state, makeRng(BigInt(y)));
    }
    for (const f of ['avg_intelligence', 'avg_combat', 'avg_health', 'avg_happiness', 'avg_sexuality'] as const) {
      expect(state[0][f]).toBeGreaterThanOrEqual(0);
      expect(state[0][f]).toBeLessThanOrEqual(100);
    }
  });

  it('zero-count bucket is a no-op', () => {
    const rng = makeRng(1n);
    const before = makeBucket('Farmer', { count: 0 });
    const [after] = applyDrift([before], rng);
    expect(after).toEqual(before);
  });
});
