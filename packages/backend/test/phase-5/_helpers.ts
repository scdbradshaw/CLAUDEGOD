// Shared test helpers for Phase 5 unit tests.

import type { PersonType, Race } from '@claude-god/shared';
import type { BucketState } from '../../src/engine/bucket-dynamics/types';

const BUCKET_DEFAULTS: Omit<BucketState, 'type'> = {
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
  return { type, ...BUCKET_DEFAULTS, ...overrides };
}

export function evenRaceShares(): Record<Race, number> {
  return {
    Caucasian: 0.1,
    'African American': 0.1,
    'East Asian': 0.1,
    'South Asian': 0.1,
    'Southeast Asian': 0.1,
    'Hispanic/Latino': 0.1,
    'Native American': 0.1,
    'Middle Eastern': 0.1,
    'Indigenous Australian': 0.1,
    Polynesian: 0.1,
  };
}
