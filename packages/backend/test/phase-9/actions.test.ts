import { describe, it, expect } from 'vitest';
import {
  planFoundGroup,
  planGift,
  planMarry,
  planMurder,
} from '../../src/engine/agentic/actions';
import { makeRng } from '../../src/lib/rng';
import {
  FOUND_GROUP_TREASURY_SEED,
  GIFT_PCT_MAX,
  GIFT_PCT_MIN,
} from '@claude-god/shared';
import { makePerson, tags } from './_factory';

describe('planMarry', () => {
  it('produces mutual spouse + memories tagged literary', () => {
    const a = makePerson({ id: 'a' });
    const b = makePerson({ id: 'b' });
    const desc = planMarry(a, b, 100);
    expect(desc.set_spouse).toBe(true);
    expect(desc.bond_strength).toBeGreaterThanOrEqual(80);
    expect(desc.actor_memory.tone).toBe('literary');
    expect(desc.target_memory.counterparty_id).toBe('a');
    expect(desc.set_state_tag).toBe('wedded-recently');
  });
});

describe('planMurder', () => {
  it('actor wins when combat differential favours actor', () => {
    const a = makePerson({ id: 'a', combat: 80 });
    const b = makePerson({ id: 'b', combat: 30 });
    const desc = planMurder(a, b, 200);
    expect(desc.outcome).toBe('actor_wins');
    expect(desc.kills).toEqual(['b']);
    expect(desc.witness_id).toBe('a');
  });

  it('target wins when target combat is higher', () => {
    const a = makePerson({ id: 'a', combat: 30 });
    const b = makePerson({ id: 'b', combat: 80 });
    const desc = planMurder(a, b, 200);
    expect(desc.outcome).toBe('target_wins');
    expect(desc.kills).toEqual(['a']);
    expect(desc.witness_id).toBe('b');
  });

  it('combat tie kills both', () => {
    const a = makePerson({ id: 'a', combat: 50 });
    const b = makePerson({ id: 'b', combat: 50 });
    const desc = planMurder(a, b, 200);
    expect(desc.outcome).toBe('both_die');
    expect(new Set(desc.kills)).toEqual(new Set(['a', 'b']));
    expect(desc.survivor_memory).toBeNull();
  });
});

describe('planFoundGroup', () => {
  it('seeds a religion when actor is faithful', () => {
    const actor = makePerson({
      personality_tags: [tags.faithful],
      wealth: 5000,
    });
    const desc = planFoundGroup(actor, 'religion', FOUND_GROUP_TREASURY_SEED, 50);
    expect(desc.kind).toBe('religion');
    expect(desc.treasury_seed).toBe(FOUND_GROUP_TREASURY_SEED);
    expect(desc.actor_memory.tone).toBe('epic');
    expect(desc.wanted_tags).toEqual(['faithful']);
    expect(desc.faction_config).toBeNull();
  });

  it('caps wanted_tags at 3', () => {
    const actor = makePerson({
      personality_tags: [tags.ambitious, tags.charismatic, tags.kind, tags.loyal],
    });
    const desc = planFoundGroup(actor, 'faction', 1000, 1);
    expect(desc.wanted_tags.length).toBeLessThanOrEqual(3);
  });

  it('seeds full competition config for factions', () => {
    const actor = makePerson({
      personality_tags: [tags.ambitious],
      intelligence: 75,
      wealth: 5000,
    });
    const desc = planFoundGroup(actor, 'faction', 1000, 1);
    expect(desc.faction_config).not.toBeNull();
    const cfg = desc.faction_config!;
    expect(cfg.competition_metric).toBe('income');
    expect(cfg.leader_dues_cut).toBeGreaterThan(0);
    expect(cfg.leader_dues_cut).toBeLessThanOrEqual(0.25);
    expect(cfg.prize_shares.length).toBeGreaterThanOrEqual(3);
    // Top-rank should be the largest share.
    expect(cfg.prize_shares[0]).toBeGreaterThan(cfg.prize_shares[1]);
    expect(cfg.prize_shares[1]).toBeGreaterThan(cfg.prize_shares[2]);
    // Founder's intel becomes the soft target.
    expect(cfg.intelligence_target).toBe(75);
    expect(cfg.cost_per_year).toBeGreaterThan(0);
  });

  it('religion config carries no faction_config', () => {
    const actor = makePerson({
      personality_tags: [tags.faithful],
      intelligence: 50,
    });
    const desc = planFoundGroup(actor, 'religion', FOUND_GROUP_TREASURY_SEED, 1);
    expect(desc.faction_config).toBeNull();
  });
});

describe('planGift', () => {
  it('amount is between 1% and 10% of actor wealth (capped)', () => {
    const actor = makePerson({ id: 'a', wealth: 10_000 });
    const target = makePerson({ id: 'b', wealth: 100 });
    const rng = makeRng(7n);
    const desc = planGift(actor, target, 1, rng);
    expect(desc.amount).toBeGreaterThanOrEqual(Math.floor(actor.wealth * GIFT_PCT_MIN));
    expect(desc.amount).toBeLessThanOrEqual(Math.floor(actor.wealth * GIFT_PCT_MAX) + 1);
  });

  it('deterministic for same seed', () => {
    const a = makePerson({ id: 'a', wealth: 10_000 });
    const b = makePerson({ id: 'b', wealth: 100 });
    const x = planGift(a, b, 1, makeRng(42n));
    const y = planGift(a, b, 1, makeRng(42n));
    expect(x.amount).toBe(y.amount);
  });
});
