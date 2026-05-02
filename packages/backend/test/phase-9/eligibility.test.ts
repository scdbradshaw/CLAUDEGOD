import { describe, it, expect } from 'vitest';
import {
  foundGroupEligibility,
  giftEligibility,
  marryEligibility,
  murderEligibility,
} from '../../src/engine/agentic/eligibility';
import {
  FOUND_GROUP_MIN_AGE,
  FOUND_GROUP_MIN_INTELLIGENCE,
  FOUND_GROUP_TREASURY_SEED,
} from '@claude-god/shared';
import { bondKinds, makeBond, makePerson, tags } from './_factory';

describe('marryEligibility', () => {
  it('rejects when actor already has a spouse', () => {
    const actor = makePerson({ id: 'a', spouse_id: 'b' });
    const target = makePerson({ id: 'b' });
    const r = marryEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.lover })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts when actor has lover bond to alive unmarried target', () => {
    const actor = makePerson({ id: 'a' });
    const target = makePerson({ id: 'b' });
    const r = marryEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.lover })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.target.id).toBe('b');
  });

  it('rejects when target is already married', () => {
    const actor = makePerson({ id: 'a' });
    const target = makePerson({ id: 'b', spouse_id: 'c' });
    const r = marryEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.lover })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(false);
  });
});

describe('murderEligibility', () => {
  it('rejects when actor has no rival/nemesis bonds', () => {
    const actor = makePerson({ id: 'a', personality_tags: [tags.cruel] });
    const target = makePerson({ id: 'b' });
    const r = murderEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.lover })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts when actor has a rival bond to alive target', () => {
    const actor = makePerson({ id: 'a' });
    const target = makePerson({ id: 'b' });
    const r = murderEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.rival })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(true);
  });

  it('skips dead targets', () => {
    const actor = makePerson({ id: 'a' });
    const r = murderEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'ghost', kind: bondKinds.nemesis })],
      alivePersons: [actor],
    });
    expect(r.ok).toBe(false);
  });
});

describe('foundGroupEligibility', () => {
  it('rejects when underage', () => {
    const actor = makePerson({
      age: FOUND_GROUP_MIN_AGE - 1,
      wealth: FOUND_GROUP_TREASURY_SEED,
      intelligence: FOUND_GROUP_MIN_INTELLIGENCE,
      personality_tags: [tags.ambitious],
    });
    expect(foundGroupEligibility(actor).ok).toBe(false);
  });

  it('rejects when poor', () => {
    const actor = makePerson({
      age: FOUND_GROUP_MIN_AGE,
      wealth: FOUND_GROUP_TREASURY_SEED - 1,
      intelligence: FOUND_GROUP_MIN_INTELLIGENCE,
      personality_tags: [tags.ambitious],
    });
    expect(foundGroupEligibility(actor).ok).toBe(false);
  });

  it('rejects below the intelligence floor', () => {
    const actor = makePerson({
      age: FOUND_GROUP_MIN_AGE,
      wealth: FOUND_GROUP_TREASURY_SEED,
      intelligence: FOUND_GROUP_MIN_INTELLIGENCE - 1,
      personality_tags: [tags.ambitious],
    });
    expect(foundGroupEligibility(actor).ok).toBe(false);
  });

  it('rejects when missing both faithful and ambitious', () => {
    const actor = makePerson({
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: [tags.kind, tags.loyal],
    });
    expect(foundGroupEligibility(actor).ok).toBe(false);
  });

  it('rejects charismatic-only actors (charisma alone no longer founds)', () => {
    const actor = makePerson({
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: [tags.charismatic],
    });
    expect(foundGroupEligibility(actor).ok).toBe(false);
  });

  it('returns kind=religion for faithful actors', () => {
    const actor = makePerson({
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: [tags.faithful],
    });
    const r = foundGroupEligibility(actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('religion');
  });

  it('returns kind=faction for ambitious-only actors', () => {
    const actor = makePerson({
      age: 40,
      wealth: 5000,
      intelligence: 80,
      personality_tags: [tags.ambitious],
    });
    const r = foundGroupEligibility(actor);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('faction');
  });
});

describe('giftEligibility', () => {
  it('rejects when target is richer than actor', () => {
    const actor = makePerson({ id: 'a', wealth: 500 });
    const target = makePerson({ id: 'b', wealth: 1000 });
    const r = giftEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.ally })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(false);
  });

  it('accepts when ally bond exists and target is poorer', () => {
    const actor = makePerson({ id: 'a', wealth: 1000 });
    const target = makePerson({ id: 'b', wealth: 200 });
    const r = giftEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.ally })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(true);
  });

  it('rejects rival/nemesis bonds', () => {
    const actor = makePerson({ id: 'a', wealth: 1000 });
    const target = makePerson({ id: 'b', wealth: 200 });
    const r = giftEligibility(actor, {
      ownedBonds: [makeBond({ owner_id: 'a', target_id: 'b', kind: bondKinds.rival })],
      alivePersons: [actor, target],
    });
    expect(r.ok).toBe(false);
  });
});
