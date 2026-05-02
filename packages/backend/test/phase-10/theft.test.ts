import { describe, it, expect } from 'vitest';
import { applyTheft } from '../../src/engine/economy/theft';
import { OUTLAW_THEFT_RATE } from '@claude-god/shared';
import { makeBucket } from './_helpers';

describe('applyTheft', () => {
  it('moves full stolen amount to Outlaw bucket (no void)', () => {
    const buckets = [
      makeBucket('Outlaw', { count: 10, avg_wealth: 20 }),
      makeBucket('Noble', { count: 10, avg_wealth: 1000 }),
    ];
    const r = applyTheft(buckets);
    const beforeNoble = 10 * 1000;
    const expectedStolen = Math.floor(beforeNoble * OUTLAW_THEFT_RATE);
    expect(r.total_stolen).toBe(expectedStolen);

    const afterNoble = r.buckets.find((b) => b.type === 'Noble')!;
    const afterOutlaw = r.buckets.find((b) => b.type === 'Outlaw')!;
    // Noble lost the stolen amount.
    expect(10 * afterNoble.avg_wealth).toBe(beforeNoble - expectedStolen);
    // Outlaw gained the FULL stolen amount.
    const beforeOutlaw = 10 * 20;
    expect(10 * afterOutlaw.avg_wealth).toBe(beforeOutlaw + expectedStolen);
  });

  it('skips buckets at-or-below Outlaw avg_wealth', () => {
    const buckets = [
      makeBucket('Outlaw', { count: 10, avg_wealth: 100 }),
      makeBucket('Farmer', { count: 10, avg_wealth: 50 }), // poorer
      makeBucket('Laborer', { count: 10, avg_wealth: 100 }), // tied
      makeBucket('Noble', { count: 10, avg_wealth: 1000 }), // richer
    ];
    const r = applyTheft(buckets);
    expect(r.per_victim.map((v) => v.type)).toEqual(['Noble']);
  });

  it('no-op when Outlaw bucket has count 0', () => {
    const buckets = [
      makeBucket('Outlaw', { count: 0, avg_wealth: 0 }),
      makeBucket('Noble', { count: 10, avg_wealth: 1000 }),
    ];
    const r = applyTheft(buckets);
    expect(r.total_stolen).toBe(0);
    const afterNoble = r.buckets.find((b) => b.type === 'Noble')!;
    expect(afterNoble.avg_wealth).toBe(1000);
  });

  it('conservation: total bucket-wealth before == after (rounding ε)', () => {
    const buckets = [
      makeBucket('Outlaw', { count: 50, avg_wealth: 30 }),
      makeBucket('Noble', { count: 20, avg_wealth: 800 }),
      makeBucket('Merchant', { count: 30, avg_wealth: 200 }),
    ];
    const before = buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    const r = applyTheft(buckets);
    const after = r.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    // Per-bucket avg_wealth rounding can drift up to ~count/2 per bucket.
    const totalCount = buckets.reduce((s, b) => s + b.count, 0);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(totalCount / 2);
  });
});
