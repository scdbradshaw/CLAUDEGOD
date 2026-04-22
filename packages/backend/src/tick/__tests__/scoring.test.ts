// ============================================================
// Unit tests — tick/scoring.ts
// ------------------------------------------------------------
// Covers the pure/near-pure helpers shared by the tick loop and the
// /api/interactions/force route. No database, no prisma. The grudge
// bonus helper is tested separately with a stubbed prisma client.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import type {
  InteractionTypeDef,
  OutcomeBand,
  EffectPacket,
  TraitSet,
  GlobalTraitSet,
} from '@civ-sim/shared';
import {
  applyEffectPacket,
  computeGrudgeBonus,
  computeScore,
  emotionalImpactForMagnitude,
  findBand,
  getEffects,
  invertImpact,
  pickInteractionType,
  randFloat,
  randInt,
  GRUDGE_MEMORY_LIMIT,
  MAX_GRUDGE_BONUS,
} from '../scoring';

// ── Test helpers ────────────────────────────────────────────
const makeBand = (overrides: Partial<OutcomeBand> = {}): OutcomeBand => ({
  label:             'neutral',
  min_score:         0,
  magnitude:         0.5,
  subject_effect:    { stat_delta: [0, 0], affects_stats: [] },
  can_die:           false,
  creates_memory:    true,
  creates_headline:  false,
  ...overrides,
});

// ── randInt / randFloat ─────────────────────────────────────
describe('randInt / randFloat', () => {
  it('randInt stays within inclusive bounds', () => {
    for (let i = 0; i < 200; i++) {
      const v = randInt(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('randInt(a, a) returns a', () => {
    expect(randInt(5, 5)).toBe(5);
  });

  it('randFloat stays within [min, max)', () => {
    for (let i = 0; i < 200; i++) {
      const v = randFloat(-1.5, 2.5);
      expect(v).toBeGreaterThanOrEqual(-1.5);
      expect(v).toBeLessThan(2.5);
    }
  });
});

// ── pickInteractionType ─────────────────────────────────────
describe('pickInteractionType', () => {
  const mkType = (id: string, weight: number): InteractionTypeDef => ({
    id,
    label: id,
    weight,
    trait_weights: [],
    global_amplifiers: [],
  });

  it('always returns a type from the list', () => {
    const types = [mkType('a', 1), mkType('b', 1), mkType('c', 1)];
    for (let i = 0; i < 50; i++) {
      const picked = pickInteractionType(types);
      expect(types).toContain(picked);
    }
  });

  it('respects relative weights (statistically)', () => {
    const types = [mkType('common', 9), mkType('rare', 1)];
    const counts: Record<string, number> = { common: 0, rare: 0 };
    for (let i = 0; i < 2000; i++) {
      counts[pickInteractionType(types).id]++;
    }
    // common should be picked way more often than rare
    expect(counts.common).toBeGreaterThan(counts.rare * 3);
  });

  it('falls back to last entry when roll lands exactly on boundary', () => {
    // Math.random = 0.9999999 — roll just under total, should still return something.
    const types = [mkType('a', 1), mkType('b', 1)];
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
    try {
      expect(types).toContain(pickInteractionType(types));
    } finally {
      spy.mockRestore();
    }
  });
});

// ── computeScore ────────────────────────────────────────────
describe('computeScore', () => {
  const baseType: InteractionTypeDef = {
    id: 'test',
    label: 'test',
    weight: 1,
    trait_weights: [],
    global_amplifiers: [],
  };

  it('sums trait_weights * sign * multiplier', () => {
    const type: InteractionTypeDef = {
      ...baseType,
      trait_weights: [
        { trait: 'aggression', sign:  1, multiplier: 1 },
        { trait: 'empathy',    sign: -1, multiplier: 2 },
      ],
    };
    const traits: TraitSet = { aggression: 80, empathy: 30 };
    // 80*1*1 + 30*-1*2 = 80 - 60 = 20
    expect(computeScore(type, traits, {}, {}, 0)).toBe(20);
  });

  it('skips unknown trait keys silently', () => {
    const type: InteractionTypeDef = {
      ...baseType,
      trait_weights: [
        { trait: 'aggression', sign: 1, multiplier: 1 },
        { trait: 'nonexistent', sign: 1, multiplier: 1 },
      ],
    };
    expect(computeScore(type, { aggression: 40 }, {}, {}, 0)).toBe(40);
  });

  it('applies global amplifiers through force multipliers', () => {
    const type: InteractionTypeDef = {
      ...baseType,
      global_amplifiers: [{ key: 'war.morale', multiplier: 0.5 }],
    };
    const globals: GlobalTraitSet = { 'war.morale': 100 };
    // no force multiplier ⇒ 100 * 0.5 * 1.0 = 50
    expect(computeScore(type, {}, globals, {}, 0)).toBe(50);
    // with war multiplier = 2.0 ⇒ 100 * 0.5 * 2.0 = 100
    expect(computeScore(type, {}, globals, { war: 2.0 }, 0)).toBe(100);
  });

  it('defaults trait multiplier to 1 when undefined', () => {
    const type: InteractionTypeDef = {
      ...baseType,
      trait_weights: [{ trait: 'x', sign: 1, multiplier: undefined as unknown as number }],
    };
    expect(computeScore(type, { x: 50 }, {}, {}, 0)).toBe(50);
  });

  it('adds grudgeBonus and rounds the final score', () => {
    const type: InteractionTypeDef = {
      ...baseType,
      trait_weights: [{ trait: 'a', sign: 1, multiplier: 0.3333 }],
    };
    // 50 * 0.3333 = 16.665; +grudge 10 = 26.665 → 27 rounded.
    expect(computeScore(type, { a: 50 }, {}, {}, 10)).toBe(27);
  });
});

// ── findBand ────────────────────────────────────────────────
describe('findBand', () => {
  const bands: OutcomeBand[] = [
    makeBand({ label: 'critical',   min_score: 100 }),
    makeBand({ label: 'success',    min_score:  50 }),
    makeBand({ label: 'neutral',    min_score:   0 }),
    makeBand({ label: 'failure',    min_score: -50 }),
    makeBand({ label: 'disaster',   min_score: -100 }),
  ];

  it('returns highest-qualifying band', () => {
    expect(findBand(150, bands).label).toBe('critical');
    expect(findBand(100, bands).label).toBe('critical');
    expect(findBand( 75, bands).label).toBe('success');
    expect(findBand(  0, bands).label).toBe('neutral');
    expect(findBand(-10, bands).label).toBe('failure');  // -10 >= -50
    expect(findBand(-50, bands).label).toBe('failure');
    expect(findBand(-99, bands).label).toBe('disaster'); // -99 < -50, >= -100
    expect(findBand(-100, bands).label).toBe('disaster');
  });

  it('falls back to last band when score is below every min_score', () => {
    expect(findBand(-9999, bands).label).toBe('disaster');
  });
});

// ── getEffects ──────────────────────────────────────────────
describe('getEffects', () => {
  it('uses subject_effect and mirrors antagonist when missing', () => {
    const band = makeBand({
      subject_effect: {
        stat_delta: [2, 5],
        affects_stats: ['health'],
      },
    });
    const { subject, antagonist } = getEffects(band);
    expect(subject.stat_delta).toEqual([2, 5]);
    expect(antagonist.stat_delta).toEqual([-5, -2]); // mirrored range
    expect(antagonist.affects_stats).toEqual(['health']);
  });

  it('honors explicit antagonist_effect when provided', () => {
    const band = makeBand({
      subject_effect:    { stat_delta: [1, 3],  affects_stats: ['a'] },
      antagonist_effect: { stat_delta: [-1, 0], affects_stats: ['b'] },
    });
    const { antagonist } = getEffects(band);
    expect(antagonist.stat_delta).toEqual([-1, 0]);
    expect(antagonist.affects_stats).toEqual(['b']);
  });

  it('upgrades legacy bands (stat_delta + affects_stats at band level)', () => {
    // Legacy v2 bands have no subject_effect; helpers should reconstruct one.
    const band = {
      label: 'legacy',
      min_score: 0,
      magnitude: 0.5,
      can_die: false,
      creates_memory: true,
      creates_headline: false,
      stat_delta: [3, 6],
      affects_stats: ['health'],
    } as unknown as OutcomeBand;
    const { subject, antagonist } = getEffects(band);
    expect(subject.stat_delta).toEqual([3, 6]);
    expect(subject.affects_stats).toEqual(['health']);
    expect(antagonist.stat_delta).toEqual([-6, -3]);
    expect(antagonist.affects_stats).toEqual(['health']);
  });

  it('returns zero-delta packets when legacy band has nothing declared', () => {
    const band = {
      label: 'empty',
      min_score: 0,
      magnitude: 0,
      can_die: false,
      creates_memory: false,
      creates_headline: false,
    } as unknown as OutcomeBand;
    const { subject, antagonist } = getEffects(band);
    expect(subject.stat_delta).toEqual([0, 0]);
    expect(subject.affects_stats).toEqual([]);
    expect(antagonist.stat_delta).toEqual([-0, -0]);
  });
});

// ── applyEffectPacket ───────────────────────────────────────
describe('applyEffectPacket', () => {
  it('accumulates a rolled magnitude across every affects_stats key', () => {
    const acc: Record<string, Record<string, number>> = {};
    // pin the roll to max by constraining range
    const packet: EffectPacket = { stat_delta: [5, 5], affects_stats: ['a', 'b'] };
    applyEffectPacket(acc, 'p1', packet);
    expect(acc.p1).toEqual({ a: 5, b: 5 });
  });

  it('sums across repeated calls for the same person', () => {
    const acc: Record<string, Record<string, number>> = {};
    const packet: EffectPacket = { stat_delta: [2, 2], affects_stats: ['x'] };
    applyEffectPacket(acc, 'p1', packet);
    applyEffectPacket(acc, 'p1', packet);
    applyEffectPacket(acc, 'p1', packet);
    expect(acc.p1.x).toBe(6);
  });

  it('applies trait_deltas independently of affects_stats', () => {
    const acc: Record<string, Record<string, number>> = {};
    applyEffectPacket(acc, 'p1', {
      stat_delta: [0, 0],
      affects_stats: [],
      trait_deltas: { resilience: 1, empathy: -2 },
    });
    expect(acc.p1).toEqual({ resilience: 1, empathy: -2 });
  });

  it('is a no-op when both channels are empty', () => {
    const acc: Record<string, Record<string, number>> = {};
    applyEffectPacket(acc, 'p1', { stat_delta: [1, 5], affects_stats: [] });
    expect(acc.p1).toBeUndefined();
  });

  it('keeps different persons isolated', () => {
    const acc: Record<string, Record<string, number>> = {};
    applyEffectPacket(acc, 'p1', { stat_delta: [3, 3], affects_stats: ['h'] });
    applyEffectPacket(acc, 'p2', { stat_delta: [7, 7], affects_stats: ['h'] });
    expect(acc.p1.h).toBe(3);
    expect(acc.p2.h).toBe(7);
  });
});

// ── emotionalImpactForMagnitude / invertImpact ──────────────
describe('emotionalImpactForMagnitude', () => {
  it('maps positive-score rolls by magnitude', () => {
    expect(emotionalImpactForMagnitude(10, 0.95)).toBe('euphoric');
    expect(emotionalImpactForMagnitude(10, 0.9)).toBe('euphoric');
    expect(emotionalImpactForMagnitude(10, 0.6)).toBe('positive');
    expect(emotionalImpactForMagnitude(10, 0.4)).toBe('positive');
    expect(emotionalImpactForMagnitude(10, 0.1)).toBe('neutral');
    expect(emotionalImpactForMagnitude(0, 0.3)).toBe('neutral');
  });

  it('maps negative-score rolls by magnitude', () => {
    expect(emotionalImpactForMagnitude(-1, 0.95)).toBe('traumatic');
    expect(emotionalImpactForMagnitude(-1, 0.9)).toBe('traumatic');
    expect(emotionalImpactForMagnitude(-1, 0.6)).toBe('negative');
    expect(emotionalImpactForMagnitude(-1, 0.4)).toBe('negative');
    expect(emotionalImpactForMagnitude(-1, 0.2)).toBe('neutral');
  });
});

describe('invertImpact', () => {
  it('mirrors valence', () => {
    expect(invertImpact('euphoric')).toBe('traumatic');
    expect(invertImpact('positive')).toBe('negative');
    expect(invertImpact('negative')).toBe('positive');
    expect(invertImpact('traumatic')).toBe('euphoric');
    expect(invertImpact('neutral')).toBe('neutral');
  });
});

// ── computeGrudgeBonus ──────────────────────────────────────
describe('computeGrudgeBonus', () => {
  // Build a stub that only implements what scoring.ts reaches for.
  const fakePrisma = (memories: { emotional_impact: string; magnitude: number }[]) =>
    ({
      memoryBank: {
        findMany: vi.fn().mockResolvedValue(memories),
      },
    }) as unknown as import('@prisma/client').PrismaClient;

  it('returns 0 when the pair has no shared memories', async () => {
    expect(await computeGrudgeBonus(fakePrisma([]), 'a', 'b')).toBe(0);
  });

  it('adds positive valence for positive memories', async () => {
    // 2 positive + 1 euphoric, each magnitude 0.5 → (1+1+2) * 0.5 * 25 = 50
    const prisma = fakePrisma([
      { emotional_impact: 'positive', magnitude: 0.5 },
      { emotional_impact: 'positive', magnitude: 0.5 },
      { emotional_impact: 'euphoric', magnitude: 0.5 },
    ]);
    expect(await computeGrudgeBonus(prisma, 'a', 'b')).toBe(50);
  });

  it('caps at +MAX_GRUDGE_BONUS', async () => {
    const prisma = fakePrisma(
      Array.from({ length: 8 }, () => ({ emotional_impact: 'euphoric', magnitude: 1.0 })),
    );
    // each: 2 * 1 * 25 = 50, x8 = 400 → clamped
    expect(await computeGrudgeBonus(prisma, 'a', 'b')).toBe(MAX_GRUDGE_BONUS);
  });

  it('caps at -MAX_GRUDGE_BONUS', async () => {
    const prisma = fakePrisma(
      Array.from({ length: 8 }, () => ({ emotional_impact: 'traumatic', magnitude: 1.0 })),
    );
    expect(await computeGrudgeBonus(prisma, 'a', 'b')).toBe(-MAX_GRUDGE_BONUS);
  });

  it('passes the lookback limit to the query', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      memoryBank: { findMany },
    } as unknown as import('@prisma/client').PrismaClient;
    await computeGrudgeBonus(prisma, 'a', 'b');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: GRUDGE_MEMORY_LIMIT }),
    );
  });

  it('treats unknown emotional_impact strings as 0 valence', async () => {
    const prisma = fakePrisma([
      { emotional_impact: 'something-weird', magnitude: 1.0 },
    ]);
    expect(await computeGrudgeBonus(prisma, 'a', 'b')).toBe(0);
  });
});
