// Phase 4 — makeYearRng determinism.

import { describe, it, expect } from 'vitest';
import { makeYearRng } from '../../src/engine/rng-context';

describe('makeYearRng', () => {
  const seedRoot = 0xdeadbeefcafebaben;
  const worldId = '7f6e0f4a-8a5b-4f3a-9c10-aaaabbbbcccc';

  it('is deterministic for the same (seed, worldId, year)', () => {
    const r1 = makeYearRng(seedRoot, worldId, 1);
    const r2 = makeYearRng(seedRoot, worldId, 1);
    const seq1 = Array.from({ length: 10 }, () => r1.next());
    const seq2 = Array.from({ length: 10 }, () => r2.next());
    expect(seq1).toEqual(seq2);
  });

  it('differs across years', () => {
    const r1 = makeYearRng(seedRoot, worldId, 1);
    const r2 = makeYearRng(seedRoot, worldId, 2);
    expect(r1.next()).not.toBe(r2.next());
  });

  it('differs across worldIds', () => {
    const r1 = makeYearRng(seedRoot, worldId, 1);
    const r2 = makeYearRng(seedRoot, '00000000-0000-0000-0000-000000000000', 1);
    expect(r1.next()).not.toBe(r2.next());
  });

  it('differs across seedRoots', () => {
    const r1 = makeYearRng(seedRoot, worldId, 1);
    const r2 = makeYearRng(seedRoot + 1n, worldId, 1);
    expect(r1.next()).not.toBe(r2.next());
  });
});
