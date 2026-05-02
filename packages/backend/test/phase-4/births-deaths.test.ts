// Phase 4 — births + deaths tests.

import { describe, it, expect } from 'vitest';
import { applyBirths } from '../../src/engine/bucket-dynamics/births';
import { applyDeaths } from '../../src/engine/bucket-dynamics/deaths';
import { makeRng } from '../../src/lib/rng';
import { makeBucket } from './_helpers';

describe('applyBirths', () => {
  it('grows count by ~birth_rate × count', () => {
    const N = 200;
    let totalDelta = 0;
    for (let i = 0; i < N; i++) {
      const rng = makeRng(BigInt(i));
      const out = applyBirths([makeBucket('Farmer', { count: 1000, birth_rate: 0.025 })], rng);
      totalDelta += out.buckets[0].count - 1000;
    }
    const expected = 1000 * 0.025;
    expect(Math.abs(totalDelta / N - expected)).toBeLessThan(2);
  });

  it('preserves total wealth on birth (children at 0 wealth dilutes avg)', () => {
    // Force a deterministic non-zero birth count via large bucket.
    const rng = makeRng(7n);
    const before = makeBucket('Farmer', { count: 1000, avg_wealth: 50, birth_rate: 0.05 });
    const out = applyBirths([before], rng);
    const after = out.buckets[0];
    const beforeTotal = before.count * before.avg_wealth;
    const afterTotal = after.count * after.avg_wealth;
    expect(out.total_births).toBeGreaterThan(0);
    // Allow ±N rounding (one per bucket).
    expect(Math.abs(afterTotal - beforeTotal)).toBeLessThanOrEqual(after.count);
  });

  it('zero-count bucket stays zero', () => {
    const rng = makeRng(1n);
    const out = applyBirths([makeBucket('Farmer', { count: 0 })], rng);
    expect(out.buckets[0].count).toBe(0);
    expect(out.total_births).toBe(0);
  });

  it('avg_age trends down after births', () => {
    const rng = makeRng(11n);
    const out = applyBirths([makeBucket('Farmer', { count: 1000, avg_age: 40, birth_rate: 0.05 })], rng);
    expect(out.buckets[0].avg_age).toBeLessThan(40);
  });
});

describe('applyDeaths', () => {
  it('shrinks count by ~death_rate × count', () => {
    const N = 200;
    let totalDelta = 0;
    for (let i = 0; i < N; i++) {
      const rng = makeRng(BigInt(i));
      const out = applyDeaths([makeBucket('Farmer', { count: 1000, death_rate: 0.02 })], rng);
      totalDelta += 1000 - out.buckets[0].count;
    }
    const expected = 1000 * 0.02;
    expect(Math.abs(totalDelta / N - expected)).toBeLessThan(2);
  });

  it('preserves total wealth on death (survivors inherit)', () => {
    const rng = makeRng(7n);
    const before = makeBucket('Farmer', { count: 1000, avg_wealth: 50, death_rate: 0.05 });
    const out = applyDeaths([before], rng);
    const after = out.buckets[0];
    const beforeTotal = before.count * before.avg_wealth;
    const afterTotal = after.count * after.avg_wealth;
    expect(out.total_deaths).toBeGreaterThan(0);
    expect(after.count).toBeLessThan(before.count);
    expect(Math.abs(afterTotal - beforeTotal)).toBeLessThanOrEqual(after.count);
  });

  it('clamps deaths so count never goes negative', () => {
    const rng = makeRng(13n);
    const out = applyDeaths(
      [makeBucket('Outlaw', { count: 5, death_rate: 0.99 })],
      rng,
    );
    expect(out.buckets[0].count).toBeGreaterThanOrEqual(0);
  });

  it('zero-count bucket stays zero', () => {
    const rng = makeRng(1n);
    const out = applyDeaths([makeBucket('Farmer', { count: 0 })], rng);
    expect(out.buckets[0].count).toBe(0);
  });
});
