import { describe, it, expect } from 'vitest';
import { evaluateCascades } from '../../src/engine/events/cascade-triggers';
import { makeRng } from '../../src/lib/rng';
import {
  CASCADE_COOLDOWN_YEARS,
  CASCADE_FOOD_RATIO_FLOOR,
  CASCADE_FOOD_RATIO_HARD_FLOOR,
  CASCADE_HAPPINESS_FLOOR,
  CASCADE_HEALTH_FLOOR,
  CASCADE_MARKET_FLOOR,
  type WorldStateSnapshot,
} from '@claude-god/shared';

function snap(
  year: number,
  market: number,
  city: { id: string; happiness?: number; health?: number; farmer?: number },
  foodRatio?: number,
): WorldStateSnapshot {
  return {
    year,
    market_index: market,
    food_ratio: foodRatio,
    cities: {
      [city.id]: {
        avg_happiness: city.happiness ?? 60,
        avg_health: city.health ?? 80,
        farmer_count: city.farmer ?? 100,
      },
    },
  };
}

const noopRng = makeRng(1n);

describe('evaluateCascades', () => {
  it('returns nothing on empty history', () => {
    expect(
      evaluateCascades({
        current_year: 10,
        state_history: [],
        cooldowns: {},
        rng: noopRng,
      }),
    ).toEqual([]);
  });

  it('fires CityRevolt when happiness below floor for 3y', () => {
    const history = [
      snap(8, 1, { id: 'c1', happiness: 25 }),
      snap(9, 1, { id: 'c1', happiness: 20 }),
      snap(10, 1, { id: 'c1', happiness: 15 }),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    const revolt = fires.find((f) => f.key === 'happiness-revolt');
    expect(revolt).toBeDefined();
    expect(revolt?.event_def_id).toBe('CityRevolt');
    expect(revolt?.city_id).toBe('c1');
  });

  it('does NOT fire CityRevolt if even one year is at floor', () => {
    const history = [
      snap(8, 1, { id: 'c1', happiness: 20 }),
      snap(9, 1, { id: 'c1', happiness: CASCADE_HAPPINESS_FLOOR }),
      snap(10, 1, { id: 'c1', happiness: 15 }),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.key === 'happiness-revolt')).toBeUndefined();
  });

  it('CityRevolt cooldown blocks re-fire within 10y', () => {
    const history = [
      snap(8, 1, { id: 'c1', happiness: 10 }),
      snap(9, 1, { id: 'c1', happiness: 10 }),
      snap(10, 1, { id: 'c1', happiness: 10 }),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: { 'happiness-revolt': 10 - (CASCADE_COOLDOWN_YEARS - 1) },
      rng: noopRng,
    });
    expect(fires.find((f) => f.key === 'happiness-revolt')).toBeUndefined();
  });

  it('CityRevolt fires at exactly cooldown boundary (10y elapsed)', () => {
    const history = [
      snap(8, 1, { id: 'c1', happiness: 10 }),
      snap(9, 1, { id: 'c1', happiness: 10 }),
      snap(10, 1, { id: 'c1', happiness: 10 }),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: { 'happiness-revolt': 10 - CASCADE_COOLDOWN_YEARS },
      rng: noopRng,
    });
    expect(fires.find((f) => f.key === 'happiness-revolt')).toBeDefined();
  });

  it('fires GreatCrash when market below floor for window', () => {
    const history = [
      snap(8, CASCADE_MARKET_FLOOR - 0.05, { id: 'c1' }),
      snap(9, CASCADE_MARKET_FLOOR - 0.1, { id: 'c1' }),
      snap(10, CASCADE_MARKET_FLOOR - 0.15, { id: 'c1' }),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.event_def_id === 'GreatCrash')).toBeDefined();
  });

  it('fires Famine when food_ratio < FLOOR for two consecutive years', () => {
    const history = [
      snap(9, 1, { id: 'c1' }, CASCADE_FOOD_RATIO_FLOOR - 0.05),
      snap(10, 1, { id: 'c1' }, CASCADE_FOOD_RATIO_FLOOR - 0.1),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.event_def_id === 'Famine')).toBeDefined();
  });

  it('fires Famine immediately when food_ratio < HARD_FLOOR (single bad year)', () => {
    const history = [
      snap(10, 1, { id: 'c1' }, CASCADE_FOOD_RATIO_HARD_FLOOR - 0.05),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.event_def_id === 'Famine')).toBeDefined();
  });

  it('does NOT fire Famine when food_ratio is healthy', () => {
    const history = [
      snap(9, 1, { id: 'c1' }, 0.95),
      snap(10, 1, { id: 'c1' }, 1.05),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.event_def_id === 'Famine')).toBeUndefined();
  });

  it('does NOT fire Famine when only one year is below FLOOR', () => {
    const history = [
      snap(9, 1, { id: 'c1' }, 0.95),
      snap(10, 1, { id: 'c1' }, CASCADE_FOOD_RATIO_FLOOR - 0.1),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.event_def_id === 'Famine')).toBeUndefined();
  });

  it('does NOT fire Famine when snapshots lack food_ratio (legacy)', () => {
    const history = [
      snap(9, 1, { id: 'c1' }),
      snap(10, 1, { id: 'c1' }),
    ];
    const fires = evaluateCascades({
      current_year: 10,
      state_history: history,
      cooldowns: {},
      rng: noopRng,
    });
    expect(fires.find((f) => f.event_def_id === 'Famine')).toBeUndefined();
  });

  it('Plague risk rolls when avg_health below floor', () => {
    const history = [
      snap(10, 1, { id: 'c1', health: CASCADE_HEALTH_FLOOR - 5 }),
    ];
    // Use a seed that lands within the 25% probability slice. Try seeds until
    // we find one that fires (deterministic across runs).
    let fired = false;
    for (let s = 1; s < 200; s++) {
      const fires = evaluateCascades({
        current_year: 10,
        state_history: history,
        cooldowns: {},
        rng: makeRng(BigInt(s)),
      });
      if (fires.find((f) => f.event_def_id === 'Plague')) {
        fired = true;
        break;
      }
    }
    expect(fired).toBe(true);
  });
});
