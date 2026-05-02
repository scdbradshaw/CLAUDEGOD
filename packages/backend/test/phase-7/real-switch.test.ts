import { describe, it, expect } from 'vitest';
import {
  planRealSwitch,
  SWITCH_THRESHOLD,
} from '../../src/engine/groups/real-switch';
import type { FitGroup, FitSubject } from '../../src/engine/groups/fit-score';

const subject = (over: Partial<FitSubject> = {}): FitSubject => ({
  type: 'Soldier',
  personality_tags: ['ambitious', 'loyal'],
  intelligence: 60,
  combat: 70,
  wealth: 100,
  age: 30,
  ...over,
});

const group = (id: string, wanted: FitSubject['personality_tags'], affinity = 1): FitGroup => ({
  id,
  wanted_tags: wanted,
  type_affinities: { Soldier: affinity },
  stat_floors: {},
});

describe('planRealSwitch', () => {
  it('reports no-alternatives when alternatives is empty', () => {
    const plan = planRealSwitch({
      subject: subject(),
      kind: 'faction',
      current: null,
      joinedYear: null,
      alternatives: [],
      cityShares: {},
      year: 100,
    });
    expect(plan.switchTo).toBeNull();
    expect(plan.reason).toBe('no-alternatives');
  });

  it('joins from unaffiliated immediately (no tenure gate)', () => {
    const G = group('A', ['ambitious'], 2);
    const plan = planRealSwitch({
      subject: subject(),
      kind: 'religion',
      current: null,
      joinedYear: null,
      alternatives: [G],
      cityShares: {},
      year: 100,
    });
    expect(plan.switchTo?.id).toBe('A');
    expect(plan.reason).toBe('join-from-unaffiliated');
    expect(plan.joinMemory?.kind).toBe('converted'); // religion
    expect(plan.leaveMemory).toBeUndefined();
  });

  it('blocks switching when tenure < 3 years', () => {
    const current = group('CUR', ['ambitious'], 1);
    const better = group('NEW', ['ambitious', 'loyal'], 5);
    const plan = planRealSwitch({
      subject: subject(),
      kind: 'faction',
      current,
      joinedYear: 99,
      alternatives: [better],
      cityShares: {},
      year: 100, // tenure = 1
    });
    expect(plan.switchTo).toBeNull();
    expect(plan.reason).toBe('tenure-gate');
  });

  it('switches when tenure ≥ 3y AND alt-fit exceeds current+threshold', () => {
    const current = group('CUR', ['ambitious'], 1); // overlap 1, fit ~ 1
    const better = group('NEW', ['ambitious', 'loyal'], 10); // overlap 2, fit = 20
    const plan = planRealSwitch({
      subject: subject(),
      kind: 'faction',
      current,
      joinedYear: 90,
      alternatives: [better],
      cityShares: {},
      year: 100,
      threshold: SWITCH_THRESHOLD,
    });
    expect(plan.switchTo?.id).toBe('NEW');
    expect(plan.reason).toBe('switch');
    expect(plan.leaveMemory?.kind).toBe('defected'); // faction
    expect(plan.joinMemory?.kind).toBe('enlisted');
  });

  it('does not switch if alt is only marginally better than current', () => {
    const current = group('CUR', ['ambitious'], 5); // fit ~ 5
    const tie = group('NEW', ['ambitious'], 5); // identical fit
    const plan = planRealSwitch({
      subject: subject(),
      kind: 'religion',
      current,
      joinedYear: 50,
      alternatives: [tie],
      cityShares: {},
      year: 100,
    });
    expect(plan.switchTo).toBeNull();
    expect(plan.reason).toBe('no-better-fit');
  });

  it('produces religion-flavored memory kinds for religion switches', () => {
    const current = group('CUR', ['ambitious'], 1);
    const better = group('NEW', ['ambitious', 'loyal'], 10);
    const plan = planRealSwitch({
      subject: subject(),
      kind: 'religion',
      current,
      joinedYear: 90,
      alternatives: [better],
      cityShares: {},
      year: 100,
    });
    expect(plan.switchTo?.id).toBe('NEW');
    expect(plan.leaveMemory?.kind).toBe('apostatized');
    expect(plan.joinMemory?.kind).toBe('converted');
  });
});
