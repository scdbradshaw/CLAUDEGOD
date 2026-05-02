import { describe, it, expect } from 'vitest';
import {
  applyEventModifiers,
  zeroDelta,
  type ActiveEventScoped,
  type BucketLite,
} from '../../src/engine/events/apply-modifiers';

const buckets: BucketLite[] = [
  { type: 'Farmer' },
  { type: 'Soldier' },
  { type: 'Merchant' },
];

describe('applyEventModifiers', () => {
  it('returns identity deltas when no events', () => {
    const out = applyEventModifiers(buckets, []);
    expect(out.Farmer).toEqual(zeroDelta());
    expect(out.Soldier).toEqual(zeroDelta());
    expect(out.Merchant).toEqual(zeroDelta());
  });

  it('untyped modifier hits every bucket', () => {
    const ev: ActiveEventScoped = {
      bucket_modifiers: [{ happiness_delta: -10 }],
    };
    const out = applyEventModifiers(buckets, [ev]);
    expect(out.Farmer.happiness_delta).toBe(-10);
    expect(out.Soldier.happiness_delta).toBe(-10);
    expect(out.Merchant.happiness_delta).toBe(-10);
  });

  it('typed modifier targets only matching bucket', () => {
    const ev: ActiveEventScoped = {
      bucket_modifiers: [{ type: 'Farmer', income_multiplier: 0.5 }],
    };
    const out = applyEventModifiers(buckets, [ev]);
    expect(out.Farmer.income_multiplier).toBe(0.5);
    expect(out.Soldier.income_multiplier).toBe(1);
    expect(out.Merchant.income_multiplier).toBe(1);
  });

  it('stacks multiple events: multipliers multiply, deltas sum', () => {
    const e1: ActiveEventScoped = {
      bucket_modifiers: [{ type: 'Farmer', income_multiplier: 0.5, mortality_delta: 0.02 }],
    };
    const e2: ActiveEventScoped = {
      bucket_modifiers: [{ income_multiplier: 0.8, mortality_delta: 0.03 }],
    };
    const out = applyEventModifiers(buckets, [e1, e2]);
    // Farmer: 0.5 * 0.8 = 0.4; mortality 0.02 + 0.03 = 0.05.
    expect(out.Farmer.income_multiplier).toBeCloseTo(0.4);
    expect(out.Farmer.mortality_delta).toBeCloseTo(0.05);
    // Soldier: 1 * 0.8 = 0.8; mortality 0 + 0.03 = 0.03.
    expect(out.Soldier.income_multiplier).toBeCloseTo(0.8);
    expect(out.Soldier.mortality_delta).toBeCloseTo(0.03);
  });

  it('birth_rate_multiplier stacks via product', () => {
    const e1: ActiveEventScoped = { bucket_modifiers: [{ birth_rate_multiplier: 0.5 }] };
    const e2: ActiveEventScoped = { bucket_modifiers: [{ birth_rate_multiplier: 0.4 }] };
    const out = applyEventModifiers(buckets, [e1, e2]);
    expect(out.Farmer.birth_rate_multiplier).toBeCloseTo(0.2);
  });
});
