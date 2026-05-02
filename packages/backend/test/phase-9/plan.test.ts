import { describe, it, expect } from 'vitest';
import { planYearActions } from '../../src/engine/agentic/plan';
import { makeRng } from '../../src/lib/rng';
import { bondKinds, makeBond, makePerson, tags } from './_factory';

describe('planYearActions', () => {
  it('returns no intents for an empty world', () => {
    const r = planYearActions({
      year: 1,
      alivePersons: [],
      bonds: [],
      queues: [],
      rng: makeRng(1n),
    });
    expect(r.intents).toEqual([]);
  });

  it('queued intents come before engine intents', () => {
    const a = makePerson({ id: 'a', wealth: 10_000, age: 40, personality_tags: [tags.ambitious] });
    const b = makePerson({ id: 'b', wealth: 50 });
    const r = planYearActions({
      year: 100,
      alivePersons: [a, b],
      bonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.ally })],
      queues: [
        {
          person_id: 'a',
          entry: {
            action_type: 'gift',
            target_id: 'b',
            scheduled_year: 100,
            status: 'queued',
          },
        },
      ],
      rng: makeRng(1n),
    });
    // First intent is queued (regardless of how many engine intents follow).
    expect(r.intents[0].source).toBe('queued');
  });

  it('is deterministic for the same seed', () => {
    const persons = [
      makePerson({ id: 'a', age: 30, personality_tags: [tags.cruel] }),
      makePerson({ id: 'b', age: 30, personality_tags: [tags.kind] }),
      makePerson({ id: 'c', age: 30, personality_tags: [tags.ambitious], wealth: 5000 }),
    ];
    const x = planYearActions({
      year: 1,
      alivePersons: persons,
      bonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.rival })],
      queues: [],
      rng: makeRng(99n),
    });
    const y = planYearActions({
      year: 1,
      alivePersons: persons,
      bonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.rival })],
      queues: [],
      rng: makeRng(99n),
    });
    expect(x.intents).toEqual(y.intents);
  });

  it('actor with passing queued intent does not also engine-roll', () => {
    const a = makePerson({
      id: 'a',
      age: 30,
      personality_tags: [tags.ambitious, tags.cruel, tags.vengeful],
      wealth: 5000,
    });
    const b = makePerson({ id: 'b', wealth: 50 });
    const r = planYearActions({
      year: 100,
      alivePersons: [a, b],
      bonds: [
        makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.ally }),
      ],
      queues: [
        {
          person_id: 'a',
          entry: {
            action_type: 'gift',
            target_id: 'b',
            scheduled_year: 100,
            status: 'queued',
          },
        },
      ],
      rng: makeRng(7n),
    });
    const aIntents = r.intents.filter((i) => i.actor_id === 'a');
    expect(aIntents).toHaveLength(1);
    expect(aIntents[0].source).toBe('queued');
  });
});
