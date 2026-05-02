import { describe, it, expect } from 'vitest';
import {
  applyRealPersonIncome,
  incomeMultiplierFor,
} from '../../src/engine/economy/real-income';
import type { ActiveEventTags } from '../../src/engine/economy';
import { TYPE_INCOME_BASES } from '../../src/engine/income-rates';
import { makeReal } from './_helpers';

const noEvents: ActiveEventTags = {
  war: false,
  plague: false,
  famine: false,
  drought: false,
  bountiful: false,
  boom: false,
};

describe('incomeMultiplierFor', () => {
  it('baseline = 1.0 with no events', () => {
    expect(incomeMultiplierFor('Farmer', noEvents)).toBe(1);
    expect(incomeMultiplierFor('Soldier', noEvents)).toBe(1);
  });

  it('war: -30% non-Soldier; Soldier unaffected', () => {
    const e = { ...noEvents, war: true };
    expect(incomeMultiplierFor('Farmer', e)).toBeCloseTo(0.7, 5);
    expect(incomeMultiplierFor('Soldier', e)).toBe(1);
  });

  it('plague: -50% all', () => {
    const e = { ...noEvents, plague: true };
    expect(incomeMultiplierFor('Farmer', e)).toBe(0.5);
    expect(incomeMultiplierFor('Soldier', e)).toBe(0.5);
  });

  it('famine: -70% Farmer only', () => {
    const e = { ...noEvents, famine: true };
    expect(incomeMultiplierFor('Farmer', e)).toBeCloseTo(0.3, 5);
    expect(incomeMultiplierFor('Laborer', e)).toBe(1);
  });

  it('drought: -40% Farmer + Laborer', () => {
    const e = { ...noEvents, drought: true };
    expect(incomeMultiplierFor('Farmer', e)).toBeCloseTo(0.6, 5);
    expect(incomeMultiplierFor('Laborer', e)).toBeCloseTo(0.6, 5);
    expect(incomeMultiplierFor('Soldier', e)).toBe(1);
  });

  it('boom: +30% Merchant/Artisan/Noble', () => {
    const e = { ...noEvents, boom: true };
    expect(incomeMultiplierFor('Merchant', e)).toBeCloseTo(1.3, 5);
    expect(incomeMultiplierFor('Artisan', e)).toBeCloseTo(1.3, 5);
    expect(incomeMultiplierFor('Noble', e)).toBeCloseTo(1.3, 5);
    expect(incomeMultiplierFor('Farmer', e)).toBe(1);
  });

  it('compose: war + plague stack multiplicatively', () => {
    const e = { ...noEvents, war: true, plague: true };
    // non-Soldier: 0.7 × 0.5 = 0.35
    expect(incomeMultiplierFor('Farmer', e)).toBeCloseTo(0.35, 5);
    // Soldier: only plague → 0.5
    expect(incomeMultiplierFor('Soldier', e)).toBe(0.5);
  });
});

describe('applyRealPersonIncome', () => {
  it('adds gross to wealth per type', () => {
    const persons = [
      makeReal('p1', { type: 'Farmer', wealth: 100 }),
      makeReal('p2', { type: 'Noble', wealth: 1000 }),
    ];
    const r = applyRealPersonIncome(persons, noEvents);
    const farmer = r.updates.find((u) => u.person_id === 'p1')!;
    const noble = r.updates.find((u) => u.person_id === 'p2')!;
    expect(farmer.wealth).toBe(100 + TYPE_INCOME_BASES.Farmer);
    expect(noble.wealth).toBe(1000 + TYPE_INCOME_BASES.Noble);
    expect(r.total_gross).toBe(TYPE_INCOME_BASES.Farmer + TYPE_INCOME_BASES.Noble);
  });

  it('applies plague modifier to gross', () => {
    const persons = [makeReal('p1', { type: 'Farmer', wealth: 100 })];
    const r = applyRealPersonIncome(persons, { ...noEvents, plague: true });
    const expected = Math.round(TYPE_INCOME_BASES.Farmer * 0.5);
    expect(r.updates[0].wealth).toBe(100 + expected);
  });
});
