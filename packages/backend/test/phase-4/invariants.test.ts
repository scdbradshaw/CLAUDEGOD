// Phase 4 — invariants helper tests.

import { describe, it, expect } from 'vitest';
import {
  assertNonNegative,
  assertWealthConserved,
  totalBucketWealth,
  totalWorldWealth,
  InvariantViolation,
} from '../../src/engine/bucket-dynamics/invariants';
import { makeBucket } from './_helpers';

describe('assertNonNegative', () => {
  it('passes on a clean state', () => {
    expect(() =>
      assertNonNegative([makeBucket('Farmer')], { treasury: 100, tax_rate: 10 }),
    ).not.toThrow();
  });
  it('throws on negative treasury', () => {
    expect(() =>
      assertNonNegative([makeBucket('Farmer')], { treasury: -1, tax_rate: 10 }),
    ).toThrow(InvariantViolation);
  });
  it('throws on negative count', () => {
    expect(() =>
      assertNonNegative(
        [makeBucket('Farmer', { count: -1 })],
        { treasury: 0, tax_rate: 10 },
      ),
    ).toThrow(InvariantViolation);
  });
  it('throws on negative avg_wealth', () => {
    expect(() =>
      assertNonNegative(
        [makeBucket('Farmer', { avg_wealth: -1 })],
        { treasury: 0, tax_rate: 10 },
      ),
    ).toThrow(InvariantViolation);
  });
});

describe('assertWealthConserved', () => {
  it('passes when after = before + gross + market', () => {
    expect(() => assertWealthConserved(1000, 1100, 80, 20, 100)).not.toThrow();
  });
  it('passes within rounding tolerance (≈ 2 × totalCount)', () => {
    // totalCount=100 → tolerance=202. 1100 + 200 still passes.
    expect(() => assertWealthConserved(1000, 1300, 80, 20, 100)).not.toThrow();
  });
  it('throws when wealth materializes outside known sources', () => {
    expect(() => assertWealthConserved(1000, 5000, 80, 20, 10)).toThrow(InvariantViolation);
  });
});

describe('totalBucketWealth / totalWorldWealth', () => {
  it('sums count × avg_wealth across buckets', () => {
    expect(
      totalBucketWealth([
        makeBucket('Farmer', { count: 100, avg_wealth: 30 }),
        makeBucket('Noble', { count: 10, avg_wealth: 300 }),
      ]),
    ).toBe(100 * 30 + 10 * 300);
  });

  it('totalWorldWealth includes treasury', () => {
    expect(
      totalWorldWealth(
        [makeBucket('Farmer', { count: 100, avg_wealth: 30 })],
        { treasury: 500, tax_rate: 10 },
      ),
    ).toBe(100 * 30 + 500);
  });
});
