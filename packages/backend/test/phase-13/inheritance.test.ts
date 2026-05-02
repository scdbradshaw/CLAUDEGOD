import { describe, it, expect } from 'vitest';
import { planInheritance } from '../../src/engine/inheritance';

const D = {
  id: 'dec-1',
  wealth: 1000,
  faction_id: 'fac-1',
  religion_id: 'rel-1',
  city_id: 'city-1',
} as const;

describe('planInheritance', () => {
  it('returns empty list when wealth is zero', () => {
    expect(
      planInheritance(
        { ...D, wealth: 0 },
        { spouse: null, eldest_child: null, faction_active: false, religion_active: false },
      ),
    ).toEqual([]);
  });

  it('returns empty list when wealth is negative', () => {
    expect(
      planInheritance(
        { ...D, wealth: -5 },
        { spouse: null, eldest_child: null, faction_active: false, religion_active: false },
      ),
    ).toEqual([]);
  });

  it('1. spouse takes 100% when present', () => {
    const out = planInheritance(D, {
      spouse: { id: 'sp-1' },
      eldest_child: { id: 'ch-1' },
      faction_active: true,
      religion_active: true,
    });
    expect(out).toEqual([{ kind: 'spouse', person_id: 'sp-1', amount: 1000 }]);
  });

  it('2. eldest child takes 100% when no spouse', () => {
    const out = planInheritance(D, {
      spouse: null,
      eldest_child: { id: 'ch-1' },
      faction_active: true,
      religion_active: true,
    });
    expect(out).toEqual([{ kind: 'child', person_id: 'ch-1', amount: 1000 }]);
  });

  it('3. faction + religion split 50/50 (faction takes ceil for odd amounts)', () => {
    const out = planInheritance(D, {
      spouse: null,
      eldest_child: null,
      faction_active: true,
      religion_active: true,
    });
    expect(out).toEqual([
      { kind: 'faction', group_id: 'fac-1', amount: 500 },
      { kind: 'religion', group_id: 'rel-1', amount: 500 },
    ]);

    const odd = planInheritance(
      { ...D, wealth: 1001 },
      {
        spouse: null,
        eldest_child: null,
        faction_active: true,
        religion_active: true,
      },
    );
    expect(odd).toEqual([
      { kind: 'faction', group_id: 'fac-1', amount: 501 },
      { kind: 'religion', group_id: 'rel-1', amount: 500 },
    ]);
  });

  it('4. faction-only when religion inactive', () => {
    const out = planInheritance(D, {
      spouse: null,
      eldest_child: null,
      faction_active: true,
      religion_active: false,
    });
    expect(out).toEqual([{ kind: 'faction', group_id: 'fac-1', amount: 1000 }]);
  });

  it('5. religion-only when faction inactive', () => {
    const out = planInheritance(D, {
      spouse: null,
      eldest_child: null,
      faction_active: false,
      religion_active: true,
    });
    expect(out).toEqual([{ kind: 'religion', group_id: 'rel-1', amount: 1000 }]);
  });

  it('6. city fallback when no other heir', () => {
    const out = planInheritance(D, {
      spouse: null,
      eldest_child: null,
      faction_active: false,
      religion_active: false,
    });
    expect(out).toEqual([{ kind: 'city', city_id: 'city-1', amount: 1000 }]);
  });

  it('city fallback also fires when faction_active=true but faction_id is null', () => {
    const noGroups = planInheritance(
      { ...D, faction_id: null, religion_id: null },
      {
        spouse: null,
        eldest_child: null,
        faction_active: true,
        religion_active: true,
      },
    );
    expect(noGroups).toEqual([{ kind: 'city', city_id: 'city-1', amount: 1000 }]);
  });

  it('plan amounts always sum to decedent wealth (when non-empty)', () => {
    for (const w of [1, 2, 3, 999, 1000, 1001, 9999]) {
      const cases = [
        { spouse: { id: 's' }, eldest_child: null, faction_active: true, religion_active: true },
        { spouse: null, eldest_child: { id: 'c' }, faction_active: true, religion_active: true },
        { spouse: null, eldest_child: null, faction_active: true, religion_active: true },
        { spouse: null, eldest_child: null, faction_active: true, religion_active: false },
        { spouse: null, eldest_child: null, faction_active: false, religion_active: false },
      ];
      for (const c of cases) {
        const plan = planInheritance({ ...D, wealth: w }, c);
        const sum = plan.reduce((s, t) => s + t.amount, 0);
        expect(sum).toBe(w);
      }
    }
  });
});
