import { describe, it, expect } from 'vitest';
import { evaluateWarEnd, type FactionSnapshot } from '../../src/engine/war-resolver';

const healthy = (id: string, name: string): FactionSnapshot => ({
  id,
  name,
  army_size: 100,
  treasury: 500,
  member_count_cached: 50,
  is_active: true,
});

describe('evaluateWarEnd', () => {
  it('returns ended=false when both sides healthy', () => {
    expect(evaluateWarEnd(healthy('a', 'A'), healthy('b', 'B')).ended).toBe(false);
  });

  it('ends when side A is dissolved', () => {
    const a = { ...healthy('a', 'A'), is_active: false };
    const ev = evaluateWarEnd(a, healthy('b', 'B'));
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_a_dissolved');
    expect(ev.loser_id).toBe('a');
  });

  it('ends when side B is dissolved', () => {
    const b = { ...healthy('b', 'B'), is_active: false };
    const ev = evaluateWarEnd(healthy('a', 'A'), b);
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_b_dissolved');
  });

  it('ends when side A has zero members', () => {
    const a = { ...healthy('a', 'A'), member_count_cached: 0 };
    const ev = evaluateWarEnd(a, healthy('b', 'B'));
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_a_no_members');
  });

  it('ends when side A has zero army', () => {
    const a = { ...healthy('a', 'A'), army_size: 0 };
    const ev = evaluateWarEnd(a, healthy('b', 'B'));
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_a_no_army');
  });

  it('ends when side B has zero army', () => {
    const b = { ...healthy('b', 'B'), army_size: 0 };
    const ev = evaluateWarEnd(healthy('a', 'A'), b);
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_b_no_army');
  });

  it('ends when side A is broke (treasury<=0)', () => {
    const a = { ...healthy('a', 'A'), treasury: 0 };
    const ev = evaluateWarEnd(a, healthy('b', 'B'));
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_a_broke');
  });

  it('ends when side B is broke', () => {
    const b = { ...healthy('b', 'B'), treasury: -10 };
    const ev = evaluateWarEnd(healthy('a', 'A'), b);
    expect(ev.ended).toBe(true);
    expect(ev.reason).toBe('side_b_broke');
  });

  it('member loss before army loss in priority order', () => {
    const a = { ...healthy('a', 'A'), army_size: 0, member_count_cached: 0 };
    const ev = evaluateWarEnd(a, healthy('b', 'B'));
    expect(ev.reason).toBe('side_a_no_members');
  });
});
