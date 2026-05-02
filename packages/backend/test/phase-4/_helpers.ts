// Shared test helpers for Phase 4 unit tests.

import type { PersonType } from '@claude-god/shared';
import type { BucketState } from '../../src/engine/bucket-dynamics';

const DEFAULTS: Omit<BucketState, 'type'> = {
  count: 100,
  avg_age: 30,
  birth_rate: 0.02,
  death_rate: 0.018,
  avg_wealth: 50,
  avg_intelligence: 50,
  avg_combat: 50,
  avg_health: 80,
  avg_happiness: 50,
  avg_sexuality: 70,
};

export function makeBucket(type: PersonType, overrides: Partial<BucketState> = {}): BucketState {
  return { type, ...DEFAULTS, ...overrides };
}
