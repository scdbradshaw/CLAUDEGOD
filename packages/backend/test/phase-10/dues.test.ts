import { describe, it, expect } from 'vitest';
import { applyDues } from '../../src/engine/economy/dues';
import { DUES_KICK_AFTER_MISSES } from '@claude-god/shared';
import { makeGroup, makeReal } from './_helpers';

describe('applyDues — real members', () => {
  it('debits cost_per_year and resets miss counter when wealth ≥ cost', () => {
    const group = makeGroup({ cost_per_year: 10 });
    const member = makeReal('p1', { faction_id: group.id, wealth: 100, dues_missed_faction: 1 });
    const r = applyDues({
      groups: [group],
      realMembers: [member],
      bucketDuesByGroup: {},
    });
    expect(r.outcomes).toHaveLength(1);
    const o = r.outcomes[0].real_member_outcomes[0];
    expect(o.paid).toBe(10);
    expect(o.new_missed_count).toBe(0);
    expect(o.kicked).toBe(false);
    expect(r.total_real_debited).toBe(10);
  });

  it('partial payment + miss++ when wealth < cost', () => {
    const group = makeGroup({ cost_per_year: 10 });
    const member = makeReal('p1', { faction_id: group.id, wealth: 3 });
    const r = applyDues({
      groups: [group],
      realMembers: [member],
      bucketDuesByGroup: {},
    });
    const o = r.outcomes[0].real_member_outcomes[0];
    expect(o.paid).toBe(3);
    expect(o.new_missed_count).toBe(1);
    expect(o.kicked).toBe(false);
  });

  it(`kicks at ${DUES_KICK_AFTER_MISSES} consecutive misses`, () => {
    const group = makeGroup({ cost_per_year: 10 });
    const member = makeReal('p1', {
      faction_id: group.id,
      wealth: 0,
      dues_missed_faction: DUES_KICK_AFTER_MISSES - 1,
    });
    const r = applyDues({
      groups: [group],
      realMembers: [member],
      bucketDuesByGroup: {},
    });
    const o = r.outcomes[0].real_member_outcomes[0];
    expect(o.kicked).toBe(true);
    // Counter is reset on kick (the orchestrator nulls the FK).
    expect(o.new_missed_count).toBe(0);
  });

  it('does NOT kick at miss-1 (off-by-one boundary)', () => {
    const group = makeGroup({ cost_per_year: 10 });
    const member = makeReal('p1', {
      faction_id: group.id,
      wealth: 0,
      dues_missed_faction: DUES_KICK_AFTER_MISSES - 2,
    });
    const r = applyDues({
      groups: [group],
      realMembers: [member],
      bucketDuesByGroup: {},
    });
    const o = r.outcomes[0].real_member_outcomes[0];
    expect(o.kicked).toBe(false);
    expect(o.new_missed_count).toBe(DUES_KICK_AFTER_MISSES - 1);
  });

  it('religion vs faction kind: only matching members debited', () => {
    const faction = makeGroup({ id: 'f-1', kind: 'faction' });
    const religion = makeGroup({ id: 'r-1', kind: 'religion' });
    const factionOnly = makeReal('p1', { faction_id: 'f-1', wealth: 100 });
    const religionOnly = makeReal('p2', { religion_id: 'r-1', wealth: 100 });
    const r = applyDues({
      groups: [faction, religion],
      realMembers: [factionOnly, religionOnly],
      bucketDuesByGroup: {},
    });
    const factionOutcome = r.outcomes.find((o) => o.group_id === 'f-1')!;
    const religionOutcome = r.outcomes.find((o) => o.group_id === 'r-1')!;
    expect(factionOutcome.real_member_outcomes.map((m) => m.person_id)).toEqual(['p1']);
    expect(religionOutcome.real_member_outcomes.map((m) => m.person_id)).toEqual(['p2']);
  });

  it('inactive or zero-cost groups produce empty outcome rows', () => {
    const inactive = makeGroup({ id: 'g-i', is_active: false });
    const free = makeGroup({ id: 'g-f', cost_per_year: 0 });
    const member = makeReal('p1', { faction_id: 'g-i', wealth: 100 });
    const r = applyDues({
      groups: [inactive, free],
      realMembers: [member],
      bucketDuesByGroup: {},
    });
    for (const o of r.outcomes) {
      expect(o.collected).toBe(0);
      expect(o.real_member_outcomes).toEqual([]);
    }
  });
});

describe('applyDues — bucket pre-summed contributions', () => {
  it('passes through bucketDuesByGroup verbatim into collected total', () => {
    const group = makeGroup({ cost_per_year: 5 });
    const r = applyDues({
      groups: [group],
      realMembers: [],
      bucketDuesByGroup: { [group.id]: 200 },
    });
    expect(r.outcomes[0].collected).toBe(200);
    expect(r.total_collected).toBe(200);
    expect(r.total_bucket_debited).toBe(200);
  });
});
