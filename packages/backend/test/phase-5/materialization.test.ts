import { describe, it, expect } from 'vitest';
import { samplePerson, samplePersonalityTags } from '../../src/engine/materialization';
import { makeRng } from '../../src/lib/rng';
import { PERSONALITY_TAGS, type PersonalityTagFreqs } from '@claude-god/shared';
import { makeBucket, evenRaceShares } from './_helpers';

const FREQS: PersonalityTagFreqs = {
  ambitious: 0.15,
  cruel: 0.08,
  kind: 0.20,
  greedy: 0.15,
  loyal: 0.20,
  vengeful: 0.10,
  charismatic: 0.12,
  faithful: 0.18,
  cunning: 0.10,
  stoic: 0.15,
  paranoid: 0.10,
  lazy: 0.12,
  brave: 0.12,
  reckless: 0.10,
  proud: 0.12,
  diligent: 0.15,
};

describe('samplePerson', () => {
  it('produces a stable shape', () => {
    const rng = makeRng(1n);
    const p = samplePerson({
      bucket: makeBucket('Farmer', { avg_wealth: 40, avg_age: 35 }),
      race_shares: evenRaceShares(),
      personality_tag_freqs: FREQS,
      year: 100,
      rng,
    });
    expect(p.type).toBe('Farmer');
    expect(p.current_health).toBe(100);
    expect(p.is_alive).toBe(true);
    expect(p.is_pinned).toBe(false);
    expect(p.created_year).toBe(100);
    expect(p.state_tags).toEqual([]);
    expect(p.age).toBeGreaterThanOrEqual(14);
    expect(p.age).toBeLessThanOrEqual(90);
    expect(['male', 'female']).toContain(p.gender);
    expect(p.personality_tags.length).toBeGreaterThanOrEqual(1);
    expect(p.personality_tags.length).toBeLessThanOrEqual(3);
  });

  it('clamps stats to [0, 100]', () => {
    const rng = makeRng(2n);
    for (let i = 0; i < 100; i++) {
      const p = samplePerson({
        bucket: makeBucket('Noble', { avg_intelligence: 95, avg_combat: 5 }),
        race_shares: evenRaceShares(),
        personality_tag_freqs: FREQS,
        year: 0,
        rng,
      });
      expect(p.intelligence).toBeGreaterThanOrEqual(0);
      expect(p.intelligence).toBeLessThanOrEqual(100);
      expect(p.combat).toBeGreaterThanOrEqual(0);
      expect(p.combat).toBeLessThanOrEqual(100);
    }
  });

  it('is deterministic with the same seed', () => {
    const a = samplePerson({
      bucket: makeBucket('Merchant'),
      race_shares: evenRaceShares(),
      personality_tag_freqs: FREQS,
      year: 5,
      rng: makeRng(42n),
    });
    const b = samplePerson({
      bucket: makeBucket('Merchant'),
      race_shares: evenRaceShares(),
      personality_tag_freqs: FREQS,
      year: 5,
      rng: makeRng(42n),
    });
    expect(b).toEqual(a);
  });
});

describe('samplePersonalityTags', () => {
  it('always returns 1–3 tags', () => {
    const rng = makeRng(3n);
    for (let i = 0; i < 200; i++) {
      const tags = samplePersonalityTags(FREQS, rng);
      expect(tags.length).toBeGreaterThanOrEqual(1);
      expect(tags.length).toBeLessThanOrEqual(3);
      for (const t of tags) expect(PERSONALITY_TAGS).toContain(t);
    }
  });

  it('falls back to highest-freq tag when all roll fail', () => {
    const rng = makeRng(4n);
    const zeros: PersonalityTagFreqs = {
      ambitious: 0,
      cruel: 0,
      kind: 0,
      greedy: 0,
      loyal: 0,
      vengeful: 0,
      charismatic: 0,
      faithful: 1, // highest
      cunning: 0,
      stoic: 0,
      paranoid: 0,
      lazy: 0,
      brave: 0,
      reckless: 0,
      proud: 0,
      diligent: 0,
    };
    const tags = samplePersonalityTags(zeros, rng);
    expect(tags).toContain('faithful');
  });
});
