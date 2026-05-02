import { describe, it, expect } from 'vitest';
import { actChance } from '../../src/engine/agentic/frequency';
import {
  AGENTIC_BASE_CHANCE,
  AGENTIC_CHANCE_CEILING,
  AGENTIC_CHANCE_FLOOR,
} from '@claude-god/shared';
import { states, tags } from './_factory';

describe('actChance', () => {
  it('returns base chance for a neutral 30y/o', () => {
    expect(
      actChance({ age: 30, personality_tags: [], state_tags: [] }),
    ).toBeCloseTo(AGENTIC_BASE_CHANCE + 0.05, 3); // age band +5%
  });

  it('clamps to floor for heavily-grieving 70y/o', () => {
    expect(
      actChance({
        age: 70,
        personality_tags: [],
        state_tags: [states.grieving, states.traumatized],
      }),
    ).toBe(AGENTIC_CHANCE_FLOOR);
  });

  it('clamps to ceiling for ambitious vengeful 25y/o', () => {
    expect(
      actChance({
        age: 25,
        personality_tags: [tags.ambitious, tags.vengeful, tags.cruel, tags.charismatic],
        state_tags: [states.windfall],
      }),
    ).toBe(AGENTIC_CHANCE_CEILING);
  });

  it('age <18 takes a small penalty', () => {
    const a = actChance({ age: 12, personality_tags: [], state_tags: [] });
    const b = actChance({ age: 30, personality_tags: [], state_tags: [] });
    expect(a).toBeLessThan(b);
  });

  it('windfall raises chance, grieving lowers it', () => {
    const w = actChance({ age: 30, personality_tags: [], state_tags: [states.windfall] });
    const g = actChance({ age: 30, personality_tags: [], state_tags: [states.grieving] });
    expect(w).toBeGreaterThan(g);
  });
});
