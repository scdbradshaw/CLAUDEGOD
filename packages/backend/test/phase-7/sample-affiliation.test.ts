import { describe, it, expect } from 'vitest';
import { sampleAffiliation } from '../../src/engine/groups/sample-affiliation';
import { makeRng, type Rng } from '../../src/lib/rng';

/** A tiny mock RNG that emits a fixed sequence of `next()` values. */
function fixedRng(values: number[]): Rng {
  let i = 0;
  const next = () => values[i++ % values.length];
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
    intInclusive: (min, max) => Math.floor(min + (max - min + 1) * next()),
    jitterFactor: (j) => 1 + (next() * 2 - 1) * j,
  };
}

describe('sampleAffiliation', () => {
  it('returns null when shares map is empty (all unaffiliated residual)', () => {
    expect(sampleAffiliation({}, fixedRng([0.5]))).toBeNull();
  });

  it('returns null when draw lands in residual region', () => {
    // shares total 0.4 → residual 0.6; r = 0.7 lands in residual.
    expect(sampleAffiliation({ A: 0.3, B: 0.1 }, fixedRng([0.7]))).toBeNull();
  });

  it('returns the first group when draw lands in its slice', () => {
    // r = 0.05 < 0.3 → A
    expect(sampleAffiliation({ A: 0.3, B: 0.2 }, fixedRng([0.05]))).toBe('A');
  });

  it('returns the second group when draw lands in its slice', () => {
    // r = 0.4 > 0.3 (A bound) and < 0.5 (A+B) → B
    expect(sampleAffiliation({ A: 0.3, B: 0.2 }, fixedRng([0.4]))).toBe('B');
  });

  it('skips zero/negative shares', () => {
    // r = 0.05 — A has share 0 so skip; B has 0.5 — winner.
    expect(sampleAffiliation({ A: 0, B: 0.5 }, fixedRng([0.05]))).toBe('B');
  });

  it('respects categorical proportions over many draws (statistical sanity)', () => {
    const rng = makeRng(0xdeadbeefn);
    const tally: Record<string, number> = { A: 0, B: 0, NULL: 0 };
    const N = 5000;
    const shares = { A: 0.6, B: 0.3 }; // residual 0.1
    for (let i = 0; i < N; i++) {
      const pick = sampleAffiliation(shares, rng);
      tally[pick ?? 'NULL']++;
    }
    // Loose bounds — deterministic seed but allow modest variance.
    expect(tally.A / N).toBeGreaterThan(0.55);
    expect(tally.A / N).toBeLessThan(0.65);
    expect(tally.B / N).toBeGreaterThan(0.25);
    expect(tally.B / N).toBeLessThan(0.35);
    expect(tally.NULL / N).toBeGreaterThan(0.05);
    expect(tally.NULL / N).toBeLessThan(0.15);
  });

  it('is deterministic for the same seed', () => {
    const a = makeRng(42n);
    const b = makeRng(42n);
    const shares = { A: 0.4, B: 0.3, C: 0.2 };
    for (let i = 0; i < 100; i++) {
      expect(sampleAffiliation(shares, a)).toBe(sampleAffiliation(shares, b));
    }
  });
});
