import { describe, it, expect } from 'vitest';
import {
  evaluateDissolution,
  pickSuccessor,
  SUCCESSOR_INTELLIGENCE_MIN,
  SUCCESSOR_TAG_OVERLAP_MIN,
  type SuccessorCandidate,
} from '../../src/engine/groups/dissolution';
import {
  GROUP_DISSOLUTION_GRACE_YEARS,
  GROUP_DISSOLUTION_MIN_MEMBERS,
} from '@claude-god/shared';

describe('evaluateDissolution', () => {
  it('noop when membership healthy and no grace pending', () => {
    expect(
      evaluateDissolution({
        memberCount: GROUP_DISSOLUTION_MIN_MEMBERS + 5,
        lowMembershipYears: 0,
      }),
    ).toEqual({ kind: 'noop' });
  });

  it('reset-grace when membership rebounds during grace period', () => {
    expect(
      evaluateDissolution({
        memberCount: GROUP_DISSOLUTION_MIN_MEMBERS + 1,
        lowMembershipYears: 1,
      }),
    ).toEqual({ kind: 'reset-grace' });
  });

  it('dissolves the moment membership dips below MIN_MEMBERS', () => {
    // With GROUP_DISSOLUTION_GRACE_YEARS = 1 the first low-year is fatal.
    const r = evaluateDissolution({
      memberCount: GROUP_DISSOLUTION_MIN_MEMBERS - 1,
      lowMembershipYears: 0,
    });
    expect(r.kind).toBe('dissolve');
    if (r.kind === 'dissolve') expect(r.reason).toBe('low-membership');
  });

  it('dissolves when grace counter reaches GRACE_YEARS', () => {
    const r = evaluateDissolution({
      memberCount: GROUP_DISSOLUTION_MIN_MEMBERS - 1,
      lowMembershipYears: GROUP_DISSOLUTION_GRACE_YEARS - 1,
    });
    expect(r.kind).toBe('dissolve');
    if (r.kind === 'dissolve') expect(r.reason).toBe('low-membership');
  });
});

describe('pickSuccessor', () => {
  const reference: SuccessorCandidate['personality_tags'] = ['ambitious', 'cruel', 'loyal'];

  it('returns null when no candidates qualify', () => {
    const candidates: SuccessorCandidate[] = [
      { id: 'a', intelligence: SUCCESSOR_INTELLIGENCE_MIN - 1, personality_tags: reference },
      { id: 'b', intelligence: 80, personality_tags: ['kind'] }, // overlap = 0
    ];
    expect(pickSuccessor(candidates, { leaderReferenceTags: reference })).toBeNull();
  });

  it('picks the highest tag-overlap qualifying candidate', () => {
    const candidates: SuccessorCandidate[] = [
      { id: 'a', intelligence: 60, personality_tags: ['ambitious', 'cruel'] }, // overlap 2
      { id: 'b', intelligence: 60, personality_tags: ['ambitious', 'cruel', 'loyal'] }, // overlap 3
      { id: 'c', intelligence: 60, personality_tags: ['ambitious'] }, // overlap 1, below floor
    ];
    expect(SUCCESSOR_TAG_OVERLAP_MIN).toBeLessThanOrEqual(2);
    const winner = pickSuccessor(candidates, { leaderReferenceTags: reference });
    expect(winner?.id).toBe('b');
  });

  it('breaks ties by intelligence', () => {
    const candidates: SuccessorCandidate[] = [
      { id: 'low', intelligence: 55, personality_tags: ['ambitious', 'cruel'] },
      { id: 'high', intelligence: 90, personality_tags: ['ambitious', 'cruel'] },
    ];
    expect(pickSuccessor(candidates, { leaderReferenceTags: reference })?.id).toBe('high');
  });
});
