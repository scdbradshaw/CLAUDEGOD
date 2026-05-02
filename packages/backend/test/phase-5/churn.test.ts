import { describe, it, expect } from 'vitest';
import { planChurn, isDemotionEligible } from '../../src/engine/churn';
import { makeRng } from '../../src/lib/rng';
import { REAL_PERSON_CAP, DEMOTION_GRACE_YEARS } from '@claude-god/shared';

const BUCKET = (over: Partial<Parameters<typeof planChurn>[0]['buckets'][number]> = {}) => ({
  city_id: 'c1',
  type: 'Farmer' as const,
  count: 100,
  avg_wealth: 50,
  ...over,
});

describe('isDemotionEligible', () => {
  it('rejects pinned persons', () => {
    expect(
      isDemotionEligible(
        { id: 'a', is_pinned: true, last_event_year: null, created_year: 0 },
        100,
      ),
    ).toBe(false);
  });

  it('rejects persons within the grace window', () => {
    expect(
      isDemotionEligible(
        { id: 'a', is_pinned: false, last_event_year: 99, created_year: 0 },
        100, // 1 year ago < 5
      ),
    ).toBe(false);
  });

  it('accepts unpinned, never-touched persons', () => {
    expect(
      isDemotionEligible(
        { id: 'a', is_pinned: false, last_event_year: null, created_year: 0 },
        100,
      ),
    ).toBe(true);
  });

  it('accepts persons past grace window', () => {
    expect(
      isDemotionEligible(
        { id: 'a', is_pinned: false, last_event_year: 100 - DEMOTION_GRACE_YEARS, created_year: 0 },
        100,
      ),
    ).toBe(true);
  });
});

describe('planChurn', () => {
  it('returns warmup-floor promotions for tiny worlds', () => {
    const plan = planChurn({
      persons: [],
      buckets: [BUCKET()],
      year: 50,
      rng: makeRng(1n),
    });
    expect(plan.promotion_budget).toBe(5);
    expect(plan.promotion_picks.length).toBe(5);
    expect(plan.demotion_ids.length).toBe(0);
  });

  it('clamps promotions when no demotion-eligible persons exist at cap', () => {
    const persons = Array.from({ length: REAL_PERSON_CAP }, (_, i) => ({
      id: `p${i}`,
      is_pinned: true, // all pinned → none eligible
      last_event_year: null,
      created_year: 0,
    }));
    const plan = planChurn({
      persons,
      buckets: [BUCKET()],
      year: 100,
      rng: makeRng(2n),
    });
    expect(plan.promotion_picks.length).toBe(0);
    expect(plan.promotions_skipped_for_cap).toBeGreaterThan(0);
  });

  it('demotes oldest first, ties broken by quietness', () => {
    const persons = [
      { id: 'oldest_loud', is_pinned: false, last_event_year: 80, created_year: 10 },
      { id: 'oldest_quiet', is_pinned: false, last_event_year: null, created_year: 10 },
      { id: 'newer', is_pinned: false, last_event_year: null, created_year: 50 },
    ];
    const plan = planChurn({
      persons,
      buckets: [BUCKET({ count: 100 })],
      year: 100,
      cap: 3, // force at-cap demotions
      rng: makeRng(3n),
    });
    // First demotion should be one of the year-10 persons; quiet wins tie.
    expect(plan.demotion_ids[0]).toBe('oldest_quiet');
  });

  it('promotion picks come from non-empty buckets only', () => {
    const plan = planChurn({
      persons: [],
      buckets: [
        BUCKET({ count: 0, type: 'Farmer' }),
        BUCKET({ count: 50, type: 'Merchant', avg_wealth: 200 }),
      ],
      year: 1,
      rng: makeRng(4n),
    });
    for (const pick of plan.promotion_picks) {
      expect(pick.type).toBe('Merchant');
    }
  });

  it('is deterministic given the same seed', () => {
    const input = {
      persons: [],
      buckets: [BUCKET(), BUCKET({ type: 'Soldier', avg_wealth: 80 })],
      year: 10,
    };
    const a = planChurn({ ...input, rng: makeRng(99n) });
    const b = planChurn({ ...input, rng: makeRng(99n) });
    expect(b).toEqual(a);
  });
});
