// Shared test helpers for Phase 10 unit tests.

import type { PersonType } from '@claude-god/shared';
import type { BucketState } from '../../src/engine/bucket-dynamics';
import type {
  GroupForDues,
  RealPersonForEconomy,
} from '../../src/engine/economy';

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

export function makeGroup(overrides: Partial<GroupForDues> = {}): GroupForDues {
  const merged: GroupForDues = {
    id: 'g-1',
    kind: 'faction',
    cost_per_year: 10,
    cost_pct_of_wealth: null,
    is_active: true,
    member_count_cached: 100,
    ...overrides,
  };
  // Religions need a non-zero pct to actually levy dues, mirroring the
  // route-layer default (RELIGION_DEFAULT_COST_PCT = 0.10).
  if (merged.kind === 'religion' && (merged.cost_pct_of_wealth == null || merged.cost_pct_of_wealth === 0)) {
    merged.cost_pct_of_wealth = 0.10;
  }
  return merged;
}

const REAL_DEFAULTS: Omit<RealPersonForEconomy, 'id'> = {
  type: 'Farmer',
  wealth: 100,
  intelligence: 50,
  faction_id: null,
  religion_id: null,
  dues_missed_faction: 0,
  dues_missed_religion: 0,
};

export function makeReal(
  id: string,
  overrides: Partial<RealPersonForEconomy> = {},
): RealPersonForEconomy {
  return { id, ...REAL_DEFAULTS, ...overrides };
}
