// Phase 9 — small factories for snapshot-shaped fixtures.

import type {
  PersonSnapshot,
  BondSnapshot,
} from '../../src/engine/agentic/types';
import type { PersonalityTag, RelationshipKind, StateTag } from '@claude-god/shared';

export function makePerson(overrides: Partial<PersonSnapshot> = {}): PersonSnapshot {
  return {
    id: 'p1',
    age: 30,
    city_id: 'c1',
    type: 'Farmer',
    gender: 'male',
    sexuality: 100,
    spouse_id: null,
    wealth: 1000,
    combat: 50,
    intelligence: 50,
    happiness: 50,
    is_pinned: false,
    faction_id: null,
    religion_id: null,
    personality_tags: [],
    state_tags: [],
    ...overrides,
  };
}

export function makeBond(overrides: Partial<BondSnapshot> = {}): BondSnapshot {
  return {
    owner_id: 'p1',
    target_id: 'p2',
    kind: 'lover',
    strength: 70,
    ...overrides,
  };
}

export const tags = {
  ambitious: 'ambitious' as PersonalityTag,
  cruel: 'cruel' as PersonalityTag,
  kind: 'kind' as PersonalityTag,
  greedy: 'greedy' as PersonalityTag,
  loyal: 'loyal' as PersonalityTag,
  vengeful: 'vengeful' as PersonalityTag,
  charismatic: 'charismatic' as PersonalityTag,
  faithful: 'faithful' as PersonalityTag,
};

export const states = {
  grieving: 'grieving' as StateTag,
  traumatized: 'traumatized' as StateTag,
  windfall: 'windfall' as StateTag,
  ruined: 'ruined' as StateTag,
  weddedRecently: 'wedded-recently' as StateTag,
};

export const bondKinds = {
  spouse: 'spouse' as RelationshipKind,
  lover: 'lover' as RelationshipKind,
  ally: 'ally' as RelationshipKind,
  rival: 'rival' as RelationshipKind,
  nemesis: 'nemesis' as RelationshipKind,
};
