import { describe, it, expect } from 'vitest';
import { planAddBond, type BondRow } from '../../src/engine/relationships';
import { DECLARED_BONDS_CAP } from '@claude-god/shared';

const bond = (over: Partial<BondRow>): BondRow => ({
  id: over.id,
  target_id: over.target_id ?? `t-${Math.random()}`,
  kind: over.kind ?? 'ally',
  strength: over.strength ?? 50,
  set_year: over.set_year ?? 0,
});

describe('planAddBond', () => {
  it('adds when below cap', () => {
    const plan = planAddBond([], bond({ target_id: 't1' }));
    expect(plan.added).toBe(true);
    expect(plan.evicted).toBeNull();
    expect(plan.kept).toHaveLength(1);
  });

  it('updates in place on (target, kind) collision (no eviction)', () => {
    const existing: BondRow[] = [
      bond({ id: 'b1', target_id: 't1', kind: 'lover', strength: 30, set_year: 5 }),
    ];
    const plan = planAddBond(existing, bond({ target_id: 't1', kind: 'lover', strength: 80, set_year: 10 }));
    expect(plan.added).toBe(true);
    expect(plan.evicted).toBeNull();
    expect(plan.kept).toHaveLength(1);
    expect(plan.kept[0].strength).toBe(80);
    expect(plan.kept[0].set_year).toBe(10);
  });

  it('evicts the lowest-strength bond when at cap', () => {
    const existing: BondRow[] = [
      bond({ id: 'a', target_id: 'A', strength: 90 }),
      bond({ id: 'b', target_id: 'B', strength: 80 }),
      bond({ id: 'c', target_id: 'C', strength: 70 }),
      bond({ id: 'd', target_id: 'D', strength: 60 }),
      bond({ id: 'e', target_id: 'E', strength: 40 }), // weakest
    ];
    expect(existing).toHaveLength(DECLARED_BONDS_CAP);
    const plan = planAddBond(existing, bond({ target_id: 'F', strength: 75 }));
    expect(plan.added).toBe(true);
    expect(plan.evicted?.target_id).toBe('E');
    expect(plan.kept).toHaveLength(DECLARED_BONDS_CAP);
    expect(plan.kept.find((b) => b.target_id === 'F')).toBeDefined();
  });

  it('rejects a candidate weaker than the existing weakest', () => {
    const existing: BondRow[] = Array.from({ length: DECLARED_BONDS_CAP }, (_, i) =>
      bond({ id: `b${i}`, target_id: `T${i}`, strength: 50 + i }),
    );
    const plan = planAddBond(existing, bond({ target_id: 'NEW', strength: 10 }));
    expect(plan.added).toBe(false);
    expect(plan.evicted).toBeNull();
    expect(plan.kept).toHaveLength(DECLARED_BONDS_CAP);
    expect(plan.kept.find((b) => b.target_id === 'NEW')).toBeUndefined();
  });

  it('on strength tie, evicts the oldest', () => {
    const existing: BondRow[] = Array.from({ length: DECLARED_BONDS_CAP }, (_, i) =>
      bond({ id: `b${i}`, target_id: `T${i}`, strength: 50, set_year: i }),
    );
    const plan = planAddBond(existing, bond({ target_id: 'NEW', strength: 51 }));
    expect(plan.added).toBe(true);
    expect(plan.evicted?.target_id).toBe('T0'); // year 0 = oldest
  });
});
