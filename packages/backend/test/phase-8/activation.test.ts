import { describe, it, expect } from 'vitest';
import {
  planActivation,
  type ActiveEventLite,
  type PlannedDrop,
} from '../../src/engine/events/activation';
import { EVENT_ACTIVE_CAP } from '@claude-god/shared';

describe('planActivation', () => {
  it('fires a player drop into an empty world', () => {
    const plan = planActivation(
      [
        {
          intent_id: 'a',
          source: 'player',
          event_def_id: 'Famine',
          city_id: 'c1',
        },
      ],
      [],
    );
    expect(plan.decisions[0]).toEqual({ intent_id: 'a', action: 'fire' });
  });

  it('player god-override replaces same-def active event (no new slot)', () => {
    const active: ActiveEventLite[] = Array.from({ length: EVENT_ACTIVE_CAP }, (_, i) => ({
      id: `ev${i}`,
      event_def_id: i === 0 ? 'Famine' : 'Drought',
    }));
    const planned: PlannedDrop[] = [
      { intent_id: 'a', source: 'player', event_def_id: 'Famine', city_id: 'c1' },
    ];
    const plan = planActivation(planned, active);
    const d = plan.decisions[0];
    expect(d.action).toBe('fire');
    if (d.action === 'fire') expect(d.replaces_event_id).toBe('ev0');
  });

  it('player drop is rejected with cap-full when at cap and no same-def', () => {
    const active: ActiveEventLite[] = Array.from({ length: EVENT_ACTIVE_CAP }, (_, i) => ({
      id: `ev${i}`,
      event_def_id: 'Drought',
    }));
    // Note: above repeats `Drought` in 'active' which violates the actual
    // single-row-per-def invariant, but the planner only matches the first
    // unique def to its slot. To make this a true cap-full test, give 6
    // distinct defs.
    const distinct: ActiveEventLite[] = [
      { id: 'e1', event_def_id: 'Drought' },
      { id: 'e2', event_def_id: 'Fire' },
      { id: 'e3', event_def_id: 'GoldenAge' },
      { id: 'e4', event_def_id: 'Discovery' },
      { id: 'e5', event_def_id: 'Plague' },
      { id: 'e6', event_def_id: 'Siege' },
    ];
    const plan = planActivation(
      [{ intent_id: 'a', source: 'player', event_def_id: 'Famine', city_id: 'c1' }],
      distinct,
    );
    expect(plan.decisions[0]).toEqual({
      intent_id: 'a',
      action: 'reject',
      reason: 'cap-full',
    });
  });

  it('cascade queues when cap full', () => {
    const distinct: ActiveEventLite[] = [
      { id: 'e1', event_def_id: 'Drought' },
      { id: 'e2', event_def_id: 'Fire' },
      { id: 'e3', event_def_id: 'GoldenAge' },
      { id: 'e4', event_def_id: 'Discovery' },
      { id: 'e5', event_def_id: 'Plague' },
      { id: 'e6', event_def_id: 'Siege' },
    ];
    const plan = planActivation(
      [{ intent_id: 'a', source: 'cascade', event_def_id: 'Famine', city_id: 'c1' }],
      distinct,
    );
    expect(plan.decisions[0]).toEqual({ intent_id: 'a', action: 'queue' });
  });

  it('cascade with same-def already active is rejected silently', () => {
    const plan = planActivation(
      [{ intent_id: 'a', source: 'cascade', event_def_id: 'Famine', city_id: 'c1' }],
      [{ id: 'ev1', event_def_id: 'Famine' }],
    );
    expect(plan.decisions[0]).toEqual({
      intent_id: 'a',
      action: 'reject',
      reason: 'cap-full',
    });
  });

  it('multiple drops in one tick respect a running cap count', () => {
    // Start with 5 active; two new player drops (different defs). First fires
    // (slot 6), second is rejected (cap-full).
    const active: ActiveEventLite[] = [
      { id: 'e1', event_def_id: 'Drought' },
      { id: 'e2', event_def_id: 'Fire' },
      { id: 'e3', event_def_id: 'GoldenAge' },
      { id: 'e4', event_def_id: 'Discovery' },
      { id: 'e5', event_def_id: 'Plague' },
    ];
    const plan = planActivation(
      [
        { intent_id: 'a', source: 'player', event_def_id: 'Siege', city_id: 'c1' },
        { intent_id: 'b', source: 'player', event_def_id: 'Famine', city_id: 'c1' },
      ],
      active,
    );
    expect(plan.decisions[0].action).toBe('fire');
    expect(plan.decisions[1]).toMatchObject({ action: 'reject', reason: 'cap-full' });
  });
});
