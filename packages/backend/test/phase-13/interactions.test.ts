import { describe, it, expect } from 'vitest';
import {
  planInteractions,
  type BondForInteraction,
  type PersonForInteraction,
} from '../../src/engine/interactions';
import {
  INTERACTION_OUTGOING_CAP,
  INTERACTION_INCOMING_CAP,
  INTERACTION_KINDS,
} from '@claude-god/shared';
import { makeRng } from '../../src/lib/rng';

const rng = () => makeRng(42n);

const makePerson = (
  id: string,
  overrides: Partial<PersonForInteraction> = {},
): PersonForInteraction => ({
  id,
  city_id: 'c1',
  age: 30,
  wealth: 100,
  is_pinned: false,
  ...overrides,
});

describe('planInteractions', () => {
  it('returns empty when fewer than 2 persons', () => {
    expect(planInteractions([], [], rng())).toEqual([]);
    expect(planInteractions([makePerson('a')], [], rng())).toEqual([]);
  });

  it('produces only valid kinds and never self-targets', () => {
    const persons = Array.from({ length: 20 }, (_, i) => makePerson(`p${i}`));
    const out = planInteractions(persons, [], rng());
    expect(out.length).toBeGreaterThan(0);
    for (const o of out) {
      expect(o.actor_id).not.toBe(o.target_id);
      expect(INTERACTION_KINDS).toContain(o.kind);
    }
  });

  it('respects per-target incoming cap', () => {
    // 50 actors, 1 target → cap should hold.
    const target = makePerson('target');
    const actors = Array.from({ length: 50 }, (_, i) =>
      makePerson(`a${i}`, { is_pinned: true }),
    );
    const out = planInteractions([target, ...actors], [], rng());
    const incoming = out.filter((o) => o.target_id === 'target').length;
    expect(incoming).toBeLessThanOrEqual(INTERACTION_INCOMING_CAP);
  });

  it('respects per-actor outgoing cap', () => {
    const actors = Array.from({ length: 30 }, (_, i) =>
      makePerson(`p${i}`, { is_pinned: true }),
    );
    const out = planInteractions(actors, [], rng());
    const counts = new Map<string, number>();
    for (const o of out) counts.set(o.actor_id, (counts.get(o.actor_id) ?? 0) + 1);
    for (const [, n] of counts) {
      expect(n).toBeLessThanOrEqual(INTERACTION_OUTGOING_CAP);
    }
  });

  it('only crosses persons in the same city', () => {
    const a = makePerson('a', { city_id: 'gay' });
    const b = makePerson('b', { city_id: 'mom' });
    const c = makePerson('c', { city_id: 'gay' });
    const out = planInteractions([a, b, c], [], rng());
    for (const o of out) {
      const actor = [a, b, c].find((p) => p.id === o.actor_id);
      const target = [a, b, c].find((p) => p.id === o.target_id);
      expect(actor!.city_id).toBe(target!.city_id);
    }
  });

  it('children (age < 13) do not initiate', () => {
    const adult = makePerson('A');
    const kid = makePerson('K', { age: 8 });
    const out = planInteractions([adult, kid], [], rng());
    for (const o of out) expect(o.actor_id).not.toBe('K');
  });

  it('rivals tend to draw hostile kinds', () => {
    const a = makePerson('a', { is_pinned: true });
    const b = makePerson('b', { is_pinned: true });
    const bonds: BondForInteraction[] = [
      { owner_id: 'a', target_id: 'b', kind: 'rival', strength: 80 },
      { owner_id: 'b', target_id: 'a', kind: 'rival', strength: 80 },
    ];
    let hostile = 0;
    let total = 0;
    // Aggregate over many runs to smooth RNG.
    for (let s = 1; s < 50; s++) {
      const out = planInteractions([a, b], bonds, makeRng(BigInt(s)));
      for (const o of out) {
        total++;
        if (o.kind === 'argue' || o.kind === 'betray') hostile++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(hostile / total).toBeGreaterThan(0.6);
  });

  it('chat with a stranger sometimes spawns an ally bond proposal', () => {
    const persons = Array.from({ length: 10 }, (_, i) =>
      makePerson(`p${i}`, { is_pinned: true }),
    );
    let spawned = 0;
    for (let s = 1; s < 30; s++) {
      const out = planInteractions(persons, [], makeRng(BigInt(s)));
      for (const o of out) {
        if (o.success && o.kind === 'chat' && o.spawn_bond) spawned++;
      }
    }
    expect(spawned).toBeGreaterThan(0);
  });

  it('successful gift carries a positive amount, capped', () => {
    const a = makePerson('a', { wealth: 10000, is_pinned: true });
    const b = makePerson('b', { is_pinned: true });
    const bonds: BondForInteraction[] = [
      { owner_id: 'a', target_id: 'b', kind: 'ally', strength: 80 },
    ];
    let gotGift = false;
    for (let s = 1; s < 30; s++) {
      const out = planInteractions([a, b], bonds, makeRng(BigInt(s)));
      const gift = out.find((o) => o.success && o.kind === 'gift');
      if (gift) {
        expect(gift.gift_amount).toBeGreaterThan(0);
        expect(gift.gift_amount).toBeLessThanOrEqual(200);
        gotGift = true;
        break;
      }
    }
    expect(gotGift).toBe(true);
  });

  it('successful betray with a prior bond sets drop_bond', () => {
    const a = makePerson('a', { is_pinned: true });
    const b = makePerson('b', { is_pinned: true });
    const bonds: BondForInteraction[] = [
      { owner_id: 'a', target_id: 'b', kind: 'rival', strength: 90 },
    ];
    let confirmed = false;
    for (let s = 1; s < 60; s++) {
      const out = planInteractions([a, b], bonds, makeRng(BigInt(s)));
      const betray = out.find(
        (o) => o.actor_id === 'a' && o.target_id === 'b' && o.kind === 'betray' && o.success,
      );
      if (betray) {
        expect(betray.drop_bond).toBe(true);
        confirmed = true;
        break;
      }
    }
    expect(confirmed).toBe(true);
  });

  it('is deterministic given the same seed', () => {
    const persons = Array.from({ length: 8 }, (_, i) =>
      makePerson(`p${i}`, { is_pinned: true }),
    );
    const a = planInteractions(persons, [], makeRng(123n));
    const b = planInteractions(persons, [], makeRng(123n));
    expect(a).toEqual(b);
  });
});
