import { describe, it, expect } from 'vitest';
import {
  EVENT_CATALOG,
  getEventDef,
  listEventDefs,
} from '../../src/engine/events/catalog';
import { EVENT_TYPES } from '@claude-god/shared';

describe('EVENT_CATALOG', () => {
  it('has an entry for every EventType in EVENT_TYPES', () => {
    for (const t of EVENT_TYPES) {
      expect(EVENT_CATALOG[t]).toBeDefined();
      expect(EVENT_CATALOG[t].id).toBe(t);
    }
  });

  it('listEventDefs returns 12 entries', () => {
    expect(listEventDefs()).toHaveLength(12);
  });

  it('getEventDef returns the matching def by id', () => {
    expect(getEventDef('Plague').id).toBe('Plague');
    expect(getEventDef('GoldenAge').scope).toBe('global');
    expect(getEventDef('Famine').default_duration).toBe(3);
  });

  it('Famine is fixed-3y, Fire fixed-1y, Drought fixed-2y, GoldenAge fixed-5y', () => {
    expect(EVENT_CATALOG.Famine.end_condition).toEqual({ kind: 'duration', years: 3 });
    expect(EVENT_CATALOG.Fire.end_condition).toEqual({ kind: 'duration', years: 1 });
    expect(EVENT_CATALOG.Drought.end_condition).toEqual({ kind: 'duration', years: 2 });
    expect(EVENT_CATALOG.GoldenAge.end_condition).toEqual({ kind: 'duration', years: 5 });
  });

  it('Plague is condition-bound on plague-clear', () => {
    expect(EVENT_CATALOG.Plague.end_condition.kind).toBe('plague-clear');
    expect(EVENT_CATALOG.Plague.default_duration).toBeNull();
  });

  it('FactionWar carries war-resolved with 20y fallback', () => {
    const ec = EVENT_CATALOG.FactionWar.end_condition;
    expect(ec.kind).toBe('war-resolved');
    if (ec.kind === 'war-resolved') expect(ec.fallback_years).toBe(20);
  });

  it('GreatCrash is condition-bound on crash-recovered', () => {
    const ec = EVENT_CATALOG.GreatCrash.end_condition;
    expect(ec.kind).toBe('crash-recovered');
    if (ec.kind === 'crash-recovered') expect(ec.threshold).toBeGreaterThan(0);
  });

  it('cascade-fireable events carry a cascade_key', () => {
    expect(EVENT_CATALOG.CityRevolt.cascade_key).toBe('happiness-revolt');
    expect(EVENT_CATALOG.GreatCrash.cascade_key).toBe('crash');
    expect(EVENT_CATALOG.Plague.cascade_key).toBe('plague-risk');
    expect(EVENT_CATALOG.Famine.cascade_key).toBe('farmer-collapse');
  });

  it('every def has at least one bucket modifier OR a target rule', () => {
    for (const def of listEventDefs()) {
      const has =
        def.bucket_modifiers.length > 0 || def.real_person_target_rules.length > 0;
      expect(has, `${def.id} has neither modifiers nor target rules`).toBe(true);
    }
  });

  it('Famine reduces Farmer income, raises mortality', () => {
    const farmerMod = EVENT_CATALOG.Famine.bucket_modifiers.find(
      (m) => m.type === 'Farmer' && m.income_multiplier !== undefined,
    );
    expect(farmerMod?.income_multiplier).toBeLessThan(1);
    const allBucketMortality = EVENT_CATALOG.Famine.bucket_modifiers.find(
      (m) => m.type === undefined && m.mortality_delta !== undefined,
    );
    expect(allBucketMortality?.mortality_delta).toBeGreaterThan(0);
  });
});
