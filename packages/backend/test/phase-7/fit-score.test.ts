import { describe, it, expect } from 'vitest';
import {
  scoreFit,
  passesStatFloors,
  proximityBonus,
  intelligenceTargetMultiplier,
  AMBITIOUS_BONUS_MULT,
  INTELLIGENCE_TARGET_FLOOR,
  type FitGroup,
  type FitSubject,
} from '../../src/engine/groups/fit-score';

const baseSubject = (over: Partial<FitSubject> = {}): FitSubject => ({
  type: 'Soldier',
  personality_tags: ['ambitious', 'loyal'],
  intelligence: 60,
  combat: 70,
  wealth: 100,
  age: 30,
  ...over,
});

const baseGroup = (over: Partial<FitGroup> = {}): FitGroup => ({
  id: 'g1',
  wanted_tags: ['ambitious', 'cruel'],
  type_affinities: { Soldier: 1.5 },
  stat_floors: {},
  ...over,
});

describe('proximityBonus', () => {
  it('returns 1 for zero or negative cityShare', () => {
    expect(proximityBonus(0)).toBe(1);
    expect(proximityBonus(-0.1)).toBe(1);
  });
  it('scales 1 + 1.5 × cityShare', () => {
    expect(proximityBonus(0.5)).toBe(1.75);
    expect(proximityBonus(1)).toBe(2.5);
  });
});

describe('passesStatFloors', () => {
  it('passes when all floors satisfied or unset', () => {
    expect(passesStatFloors(baseSubject(), {})).toBe(true);
    expect(
      passesStatFloors(baseSubject(), { intelligence_min: 60, combat_min: 70 }),
    ).toBe(true);
  });
  it('fails when a floor is unmet', () => {
    expect(passesStatFloors(baseSubject({ intelligence: 30 }), { intelligence_min: 50 })).toBe(false);
    expect(passesStatFloors(baseSubject({ age: 10 }), { age_min: 18 })).toBe(false);
  });
});

describe('scoreFit', () => {
  it('returns 0 when no tag overlap', () => {
    expect(
      scoreFit(baseSubject({ personality_tags: ['kind'] }), baseGroup(), 0),
    ).toBe(0);
  });

  it('returns 0 when stat floors fail', () => {
    expect(
      scoreFit(
        baseSubject({ intelligence: 10 }),
        baseGroup({ stat_floors: { intelligence_min: 50 } }),
        0,
      ),
    ).toBe(0);
  });

  it('multiplies overlap × affinity × proximity', () => {
    // 1 overlap (ambitious), affinity 1.5, proximity 1 (cityShare=0) = 1.5
    expect(scoreFit(baseSubject(), baseGroup(), 0)).toBeCloseTo(1.5);
    // proximity at 0.5 → bonus 1.75 → 1 × 1.5 × 1.75 = 2.625
    expect(scoreFit(baseSubject(), baseGroup(), 0.5)).toBeCloseTo(2.625);
  });

  it('counts multiple overlapping tags', () => {
    const subject = baseSubject({ personality_tags: ['ambitious', 'cruel'] });
    // 2 overlap × 1.5 affinity × 1 proximity = 3
    expect(scoreFit(subject, baseGroup(), 0)).toBeCloseTo(3);
  });

  it('falls back to affinity 1 when type missing', () => {
    const group = baseGroup({ type_affinities: {} });
    // 1 overlap × 1 (default) × 1 = 1
    expect(scoreFit(baseSubject(), group, 0)).toBe(1);
  });

  it('intelligence_target soft multiplier: exact match = 1×, far mismatch = floor', () => {
    const exact = baseGroup({ intelligence_target: 60 });
    // 1 overlap × 1.5 affinity × 1 prox × 1 (target match) = 1.5
    expect(scoreFit(baseSubject(), exact, 0)).toBeCloseTo(1.5);
    // Subject intel=10, target=100 → dist=0.9, mult = floor + 0.5*0.1 = 0.55
    const far = baseGroup({ intelligence_target: 100 });
    const expected =
      1 * 1.5 * 1 * (INTELLIGENCE_TARGET_FLOOR + (1 - INTELLIGENCE_TARGET_FLOOR) * 0.1);
    expect(scoreFit(baseSubject({ intelligence: 10 }), far, 0)).toBeCloseTo(expected);
  });

  it('ambitious_bonus only fires when subject has the tag', () => {
    const fac = baseGroup({ ambitious_bonus: true });
    // Subject has 'ambitious' → bonus applies. base = 1.5 → 1.5 × 1.25.
    expect(scoreFit(baseSubject(), fac, 0)).toBeCloseTo(1.5 * AMBITIOUS_BONUS_MULT);
    // Subject without 'ambitious' but matching the other wanted tag.
    const noAmb = baseSubject({ personality_tags: ['cruel'] });
    expect(scoreFit(noAmb, fac, 0)).toBeCloseTo(1.5);
  });

  it('religion-shaped fit (ambitious_bonus=false, intelligence_target=null) is unaffected', () => {
    const rel = baseGroup({});
    const baseScore = scoreFit(baseSubject(), rel, 0);
    expect(baseScore).toBeCloseTo(1.5);
  });
});

describe('intelligenceTargetMultiplier', () => {
  it('returns 1 when target is null/undefined or subject intel missing', () => {
    expect(intelligenceTargetMultiplier(50, null)).toBe(1);
    expect(intelligenceTargetMultiplier(50, undefined)).toBe(1);
    expect(intelligenceTargetMultiplier(undefined, 80)).toBe(1);
  });
  it('returns 1 at exact match, floor at full mismatch', () => {
    expect(intelligenceTargetMultiplier(75, 75)).toBe(1);
    expect(intelligenceTargetMultiplier(0, 100)).toBeCloseTo(INTELLIGENCE_TARGET_FLOOR);
    expect(intelligenceTargetMultiplier(100, 0)).toBeCloseTo(INTELLIGENCE_TARGET_FLOOR);
  });
});
