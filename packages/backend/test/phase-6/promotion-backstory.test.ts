import { describe, it, expect } from 'vitest';
import {
  generateBackstory,
  type BackstoryPeer,
  type BackstorySubject,
} from '../../src/engine/promotion-backstory';
import { makeRng } from '../../src/lib/rng';

const subject = (over: Partial<BackstorySubject> = {}): BackstorySubject => ({
  id: over.id ?? 'subj-1',
  city_name: over.city_name ?? 'Veridia',
  type: over.type ?? 'Farmer',
  name: over.name ?? 'Anya',
  age: over.age ?? 30,
  gender: over.gender ?? 'female',
  sexuality: over.sexuality ?? 75, // straight-leaning
});

const peer = (over: Partial<BackstoryPeer> & { id: string }): BackstoryPeer => ({
  id: over.id,
  age: over.age ?? 28,
  gender: over.gender ?? 'male',
  sexuality: over.sexuality ?? 75,
});

describe('generateBackstory — memories', () => {
  it('produces 2-4 memory entries', () => {
    // Sample a few seeds to confirm the bounds hold.
    for (let s = 1n; s <= 30n; s++) {
      const rng = makeRng(s);
      const out = generateBackstory(subject(), [], 100, rng);
      expect(out.memories.length).toBeGreaterThanOrEqual(2);
      expect(out.memories.length).toBeLessThanOrEqual(4);
    }
  });

  it('stamps memories with kind="backstory" and reportage tone', () => {
    const rng = makeRng(7n);
    const out = generateBackstory(subject(), [], 100, rng);
    for (const m of out.memories) {
      expect(m.kind).toBe('backstory');
      expect(m.tone).toBe('reportage');
      expect(m.magnitude).toBeGreaterThanOrEqual(0.2);
      expect(m.magnitude).toBeLessThan(0.5 + 1e-9); // 0.2 + 0.3 ceiling
    }
  });

  it('substitutes the city name into the templated memory text', () => {
    const rng = makeRng(11n);
    const out = generateBackstory(subject({ city_name: 'Brassmoor', type: 'Farmer' }), [], 100, rng);
    for (const m of out.memories) {
      expect(m.summary).toContain('Brassmoor');
      expect(m.summary).not.toContain('{city}');
    }
  });

  it('produces distinct memory templates (no exact duplicates)', () => {
    const rng = makeRng(3n);
    const out = generateBackstory(subject(), [], 100, rng);
    const summaries = new Set(out.memories.map((m) => m.summary));
    expect(summaries.size).toBe(out.memories.length);
  });

  it('memory years fall before or equal to promotion year', () => {
    const rng = makeRng(5n);
    const promotionYear = 200;
    const out = generateBackstory(subject({ age: 30 }), [], promotionYear, rng);
    for (const m of out.memories) {
      expect(m.year).toBeLessThanOrEqual(promotionYear);
    }
  });
});

describe('generateBackstory — bonds', () => {
  it('produces 0 bonds when no peers are available', () => {
    for (let s = 1n; s <= 20n; s++) {
      const rng = makeRng(s);
      const out = generateBackstory(subject(), [], 100, rng);
      expect(out.bonds).toEqual([]);
    }
  });

  it('produces 0-3 bonds when peers are available', () => {
    const peers = Array.from({ length: 10 }, (_, i) =>
      peer({ id: `p${i}`, age: 28 + i, gender: i % 2 ? 'male' : 'female' }),
    );
    let sawAny = false;
    for (let s = 1n; s <= 30n; s++) {
      const rng = makeRng(s);
      const out = generateBackstory(subject(), peers, 100, rng);
      expect(out.bonds.length).toBeGreaterThanOrEqual(0);
      expect(out.bonds.length).toBeLessThanOrEqual(3);
      if (out.bonds.length > 0) sawAny = true;
    }
    // Across 30 seeds with 10 peers we should at least once get a bond.
    expect(sawAny).toBe(true);
  });

  it('bond strength is in [30, 70) and stamps the promotion year', () => {
    const peers = Array.from({ length: 5 }, (_, i) => peer({ id: `p${i}`, age: 30 }));
    for (let s = 1n; s <= 15n; s++) {
      const rng = makeRng(s);
      const out = generateBackstory(subject(), peers, 142, rng);
      for (const b of out.bonds) {
        expect(b.strength).toBeGreaterThanOrEqual(30);
        expect(b.strength).toBeLessThan(70);
        expect(b.set_year).toBe(142);
      }
    }
  });

  it('does not bond with the same peer twice', () => {
    const peers = Array.from({ length: 5 }, (_, i) => peer({ id: `p${i}`, age: 30 }));
    for (let s = 1n; s <= 30n; s++) {
      const rng = makeRng(s);
      const out = generateBackstory(subject(), peers, 100, rng);
      const ids = out.bonds.map((b) => b.target_id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('prefers nearer-aged peers (top-scored come first)', () => {
    // One same-age peer, one wildly off-age peer. With only 1 bond rolled,
    // the same-age peer should be chosen.
    const peers: BackstoryPeer[] = [
      peer({ id: 'far', age: 80 }),
      peer({ id: 'near', age: 30 }),
    ];
    const subj = subject({ age: 30 });
    let sawNearChosenFirst = 0;
    let sawFarChosenFirst = 0;
    for (let s = 1n; s <= 50n; s++) {
      const rng = makeRng(s);
      const out = generateBackstory(subj, peers, 100, rng);
      if (out.bonds.length > 0) {
        if (out.bonds[0].target_id === 'near') sawNearChosenFirst++;
        else if (out.bonds[0].target_id === 'far') sawFarChosenFirst++;
      }
    }
    expect(sawNearChosenFirst).toBeGreaterThan(0);
    expect(sawNearChosenFirst).toBeGreaterThan(sawFarChosenFirst);
  });

  it('is deterministic for a given seed', () => {
    const peers = Array.from({ length: 5 }, (_, i) => peer({ id: `p${i}`, age: 30 + i }));
    const a = generateBackstory(subject(), peers, 100, makeRng(42n));
    const b = generateBackstory(subject(), peers, 100, makeRng(42n));
    expect(a).toEqual(b);
  });
});
