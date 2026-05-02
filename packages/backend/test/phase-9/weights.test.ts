import { describe, it, expect } from 'vitest';
import { actionWeights, pickAction } from '../../src/engine/agentic/weights';
import { makeRng } from '../../src/lib/rng';
import { bondKinds, makeBond, makePerson, tags } from './_factory';

describe('actionWeights', () => {
  it('all-zero weights when nothing applies', () => {
    const actor = makePerson({ id: 'a', age: 18, wealth: 0, personality_tags: [] });
    const ws = actionWeights(actor, { ownedBonds: [], alivePersons: [actor] });
    for (const w of ws) expect(w.weight).toBe(0);
  });

  it('ambitious raises found-group weight; loyal lowers it', () => {
    const ambitious = makePerson({
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: [tags.ambitious],
    });
    const loyal = makePerson({
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: [tags.ambitious, tags.loyal],
    });
    const aFG = actionWeights(ambitious, { ownedBonds: [], alivePersons: [ambitious] }).find(
      (w) => w.action_type === 'found-group',
    )!;
    const lFG = actionWeights(loyal, { ownedBonds: [], alivePersons: [loyal] }).find(
      (w) => w.action_type === 'found-group',
    )!;
    expect(aFG.weight).toBeGreaterThan(lFG.weight);
  });

  it('cruel + vengeful greatly raises murder weight', () => {
    const actor = makePerson({
      personality_tags: [tags.cruel, tags.vengeful],
    });
    const target = makePerson({ id: 'b' });
    const ws = actionWeights(actor, {
      ownedBonds: [makeBond({ owner_id: 'p1', target_id: 'b', kind: bondKinds.rival })],
      alivePersons: [actor, target],
    });
    const murder = ws.find((w) => w.action_type === 'murder')!;
    expect(murder.weight).toBeGreaterThan(2);
    expect(murder.target_id).toBe('b');
  });

  it('wedded-recently zeroes out marry weight', () => {
    const actor = makePerson({ state_tags: ['wedded-recently'] });
    const target = makePerson({ id: 'b' });
    const ws = actionWeights(actor, {
      ownedBonds: [makeBond({ owner_id: 'p1', target_id: 'b', kind: bondKinds.lover })],
      alivePersons: [actor, target],
    });
    expect(ws.find((w) => w.action_type === 'marry')!.weight).toBe(0);
  });
});

describe('pickAction', () => {
  it('returns null when total weight below threshold', () => {
    const r = pickAction(
      [
        { action_type: 'marry', weight: 0 },
        { action_type: 'murder', weight: 0.5 },
        { action_type: 'found-group', weight: 0 },
        { action_type: 'gift', weight: 0 },
      ],
      makeRng(1n),
    );
    expect(r).toBeNull();
  });

  it('always picks the only positive-weight action', () => {
    for (let s = 1; s < 20; s++) {
      const r = pickAction(
        [
          { action_type: 'marry', weight: 0 },
          { action_type: 'murder', weight: 0 },
          { action_type: 'found-group', weight: 5, params: { kind: 'faction' } },
          { action_type: 'gift', weight: 0 },
        ],
        makeRng(BigInt(s)),
      );
      expect(r?.action_type).toBe('found-group');
    }
  });

  it('is deterministic for the same seed', () => {
    const ws = [
      { action_type: 'marry' as const, weight: 1 },
      { action_type: 'gift' as const, weight: 2, target_id: 't' },
      { action_type: 'murder' as const, weight: 0.5, target_id: 'x' },
      { action_type: 'found-group' as const, weight: 0.5 },
    ];
    const a = pickAction(ws, makeRng(42n));
    const b = pickAction(ws, makeRng(42n));
    expect(a).toEqual(b);
  });
});
