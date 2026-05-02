import { describe, it, expect } from 'vitest';
import { planQueuedActions } from '../../src/engine/agentic/queue';
import type { ActionQueueEntry } from '@claude-god/shared';
import { bondKinds, makeBond, makePerson } from './_factory';

function ctxFor(persons = [makePerson()]) {
  const aliveById = new Map(persons.map((p) => [p.id, p]));
  return {
    alivePersons: persons,
    alivePersonsById: aliveById,
    bondsByOwner: new Map<string, ReturnType<typeof makeBond>[]>(),
  };
}

const baseEntry = (overrides: Partial<ActionQueueEntry> = {}): ActionQueueEntry => ({
  action_type: 'gift',
  scheduled_year: 100,
  status: 'queued',
  ...overrides,
});

describe('planQueuedActions', () => {
  it('skips entries scheduled for other years', () => {
    const actor = makePerson({ id: 'a' });
    const target = makePerson({ id: 'b', wealth: 50 });
    const r = planQueuedActions({
      year: 100,
      queues: [
        {
          person_id: 'a',
          entry: baseEntry({ scheduled_year: 99, target_id: 'b' }),
        },
        {
          person_id: 'a',
          entry: baseEntry({ scheduled_year: 101, target_id: 'b' }),
        },
      ],
      ...ctxFor([actor, target]),
    });
    expect(r).toEqual([]);
  });

  it('skips already-fired entries', () => {
    const actor = makePerson({ id: 'a' });
    const target = makePerson({ id: 'b', wealth: 50 });
    const r = planQueuedActions({
      year: 100,
      queues: [
        {
          person_id: 'a',
          entry: baseEntry({ status: 'fired', target_id: 'b' }),
        },
      ],
      ...ctxFor([actor, target]),
    });
    expect(r).toEqual([]);
  });

  it('returns gate=fail when target is dead', () => {
    const actor = makePerson({ id: 'a', wealth: 1000 });
    const r = planQueuedActions({
      year: 100,
      queues: [
        {
          person_id: 'a',
          entry: baseEntry({
            action_type: 'gift',
            target_id: 'ghost',
          }),
        },
      ],
      ...ctxFor([actor]),
    });
    expect(r).toHaveLength(1);
    expect(r[0].gate).toBe('fail');
    expect(r[0].failure_reason).toBe('target_unavailable');
  });

  it('gates pass for valid gift to poorer alive target', () => {
    const actor = makePerson({ id: 'a', wealth: 1000 });
    const target = makePerson({ id: 'b', wealth: 50 });
    const r = planQueuedActions({
      year: 100,
      queues: [
        {
          person_id: 'a',
          entry: baseEntry({ action_type: 'gift', target_id: 'b' }),
        },
      ],
      ...ctxFor([actor, target]),
    });
    expect(r).toHaveLength(1);
    expect(r[0].gate).toBe('pass');
    expect(r[0].action_type).toBe('gift');
  });

  it('gates fail for marry when actor already married', () => {
    const actor = makePerson({ id: 'a', spouse_id: 's' });
    const target = makePerson({ id: 'b' });
    const r = planQueuedActions({
      year: 100,
      queues: [
        {
          person_id: 'a',
          entry: baseEntry({ action_type: 'marry', target_id: 'b' }),
        },
      ],
      ...ctxFor([actor, target]),
    });
    expect(r[0].gate).toBe('fail');
    expect(r[0].failure_reason).toBe('actor_already_married');
  });

  it('found-group passes if eligibility met (no target needed)', () => {
    const actor = makePerson({
      id: 'a',
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: ['ambitious'],
    });
    const r = planQueuedActions({
      year: 100,
      queues: [
        {
          person_id: 'a',
          entry: baseEntry({ action_type: 'found-group' }),
        },
      ],
      ...ctxFor([actor]),
    });
    expect(r[0].gate).toBe('pass');
    expect(r[0].params?.kind).toBeDefined();
  });
});
