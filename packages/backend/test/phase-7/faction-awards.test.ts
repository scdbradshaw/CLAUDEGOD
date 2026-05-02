import { describe, it, expect } from 'vitest';
import {
  planFactionAwards,
  type CandidateMember,
} from '../../src/engine/groups/faction-awards';
import {
  FACTION_LEADER_DUES_CUT_DEFAULT,
  FACTION_PRIZE_SHARES_DEFAULT,
} from '@claude-god/shared';

function m(
  id: string,
  income: number,
  joined: number = 0,
  wealth: number = 0,
): CandidateMember {
  return {
    id,
    faction_joined_year: joined,
    faction_income_year: income,
    wealth,
  };
}

const cfg = (overrides: Partial<{ leader_id: string | null }> = {}) => ({
  leader_id: 'L' as string | null,
  ...overrides,
});

describe('planFactionAwards', () => {
  it('zero treasury → empty plan', () => {
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: 0,
      members: [m('a', 100)],
      config: cfg(),
    });
    expect(plan.total_paid).toBe(0);
    expect(plan.leader_cut).toBe(0);
    expect(plan.ranks).toEqual([]);
  });

  it('pays leader cut + top-3 ranks at default shares', () => {
    const T = 1000;
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: T,
      members: [
        m('a', 500, 0),
        m('b', 300, 0),
        m('c', 200, 0),
        m('d', 100, 0),
      ],
      config: cfg(),
    });
    expect(plan.leader_cut).toBe(Math.floor(T * FACTION_LEADER_DUES_CUT_DEFAULT));
    expect(plan.ranks).toHaveLength(3);
    expect(plan.ranks[0].person_id).toBe('a');
    expect(plan.ranks[1].person_id).toBe('b');
    expect(plan.ranks[2].person_id).toBe('c');
    expect(plan.ranks[0].prize).toBe(Math.floor(T * FACTION_PRIZE_SHARES_DEFAULT[0]));
    expect(plan.ranks[1].prize).toBe(Math.floor(T * FACTION_PRIZE_SHARES_DEFAULT[1]));
    expect(plan.ranks[2].prize).toBe(Math.floor(T * FACTION_PRIZE_SHARES_DEFAULT[2]));
    // Total paid = leader + top 3 prizes.
    const expected =
      plan.leader_cut + plan.ranks.reduce((s, r) => s + r.prize, 0);
    expect(plan.total_paid).toBe(expected);
  });

  it('leader being also rank 1 → both cuts stack (different mutations on the service side)', () => {
    // Plan only reflects identities; the service applies both increments.
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: 1000,
      members: [m('L', 999, 0), m('b', 100, 0)],
      config: cfg(),
    });
    expect(plan.leader_id).toBe('L');
    expect(plan.ranks[0].person_id).toBe('L');
    expect(plan.leader_cut).toBeGreaterThan(0);
    expect(plan.ranks[0].prize).toBeGreaterThan(0);
  });

  it('with <3 eligible members, fills only available rank slots', () => {
    const T = 1000;
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: T,
      members: [m('a', 100, 0), m('b', 50, 0)],
      config: cfg(),
    });
    expect(plan.ranks).toHaveLength(2);
    // Total paid excludes the unfilled rank-3 share.
    const unspent = T - plan.total_paid;
    expect(unspent).toBeGreaterThanOrEqual(Math.floor(T * FACTION_PRIZE_SHARES_DEFAULT[2]));
  });

  it('tenure floor excludes new joiners (joined this year)', () => {
    const plan = planFactionAwards({
      year: 5,
      treasury_in_year: 1000,
      members: [
        m('new', 999, 5), // joined this year — not eligible
        m('vet', 50, 1),
      ],
      config: cfg(),
    });
    expect(plan.ranks.find((r) => r.person_id === 'new')).toBeUndefined();
    expect(plan.ranks[0]?.person_id).toBe('vet');
  });

  it('skips leader cut when leaderless', () => {
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: 1000,
      members: [m('a', 100, 0)],
      config: cfg({ leader_id: null }),
    });
    expect(plan.leader_cut).toBe(0);
    expect(plan.leader_id).toBeNull();
    expect(plan.ranks).toHaveLength(1);
  });

  it('tiebreak by wealth desc, then id asc', () => {
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: 1000,
      members: [
        m('z', 500, 0, 100),
        m('a', 500, 0, 100), // same income, same wealth, lex-first id wins
        m('m', 500, 0, 200), // same income, higher wealth — tops both
      ],
      config: cfg(),
    });
    expect(plan.ranks[0].person_id).toBe('m');
    expect(plan.ranks[1].person_id).toBe('a');
    expect(plan.ranks[2].person_id).toBe('z');
  });

  it('zero-income members still get ranked but with prize > 0 only if they have a slot', () => {
    const plan = planFactionAwards({
      year: 10,
      treasury_in_year: 1000,
      members: [m('a', 0, 0), m('b', 0, 0)],
      config: cfg(),
    });
    // Both eligible, both ranked even though no income — prizes still paid.
    expect(plan.ranks).toHaveLength(2);
    expect(plan.ranks[0].prize).toBeGreaterThan(0);
  });
});
