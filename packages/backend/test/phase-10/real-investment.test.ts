import { describe, it, expect } from 'vitest';
import { applyRealPersonInvestment } from '../../src/engine/economy/real-investment';
import { makeReal } from './_helpers';

describe('applyRealPersonInvestment', () => {
  it('flat-index year produces zero returns', () => {
    const persons = [makeReal('p1', { wealth: 1000, intelligence: 80 })];
    const r = applyRealPersonInvestment(persons, 1.0, 1.0);
    expect(r.updates[0].wealth).toBe(1000);
    expect(r.total_returns).toBe(0);
  });

  it('returns scale with intelligence × ratio', () => {
    const smart = makeReal('smart', { wealth: 1000, intelligence: 80 });
    const dumb = makeReal('dumb', { wealth: 1000, intelligence: 20 });
    const r = applyRealPersonInvestment([smart, dumb], 1.0, 1.1);
    const smartU = r.updates.find((u) => u.person_id === 'smart')!;
    const dumbU = r.updates.find((u) => u.person_id === 'dumb')!;
    // smart: 1000 + 0.8 × 1000 × 0.1 = 1080
    // dumb : 1000 + 0.2 × 1000 × 0.1 = 1020
    expect(smartU.wealth).toBe(1080);
    expect(dumbU.wealth).toBe(1020);
  });

  it('losses on a falling index', () => {
    const p = makeReal('p', { wealth: 1000, intelligence: 50 });
    const r = applyRealPersonInvestment([p], 1.0, 0.8);
    // 1000 + 0.5 × 1000 × (-0.2) = 900
    expect(r.updates[0].wealth).toBe(900);
  });

  it('zero-wealth persons skip', () => {
    const p = makeReal('p', { wealth: 0, intelligence: 80 });
    const r = applyRealPersonInvestment([p], 1.0, 1.5);
    expect(r.updates[0].wealth).toBe(0);
    expect(r.total_returns).toBe(0);
  });

  it('clamps wealth to ≥ 0 on catastrophic crash', () => {
    const p = makeReal('p', { wealth: 100, intelligence: 100 });
    const r = applyRealPersonInvestment([p], 10.0, 0.1);
    // 100 + 1.0 × 100 × (-0.99) = 1; floor to 0 if rounding goes further.
    expect(r.updates[0].wealth).toBeGreaterThanOrEqual(0);
  });

  it('handles prevIndex=0 defensively', () => {
    const p = makeReal('p', { wealth: 1000, intelligence: 50 });
    const r = applyRealPersonInvestment([p], 0, 1);
    expect(r.updates[0].wealth).toBe(1000);
    expect(r.total_returns).toBe(0);
  });
});
