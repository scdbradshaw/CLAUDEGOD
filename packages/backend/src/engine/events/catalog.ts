// Phase 8 — Event catalog (DESIGN.md §9.2).
//
// The 12 EventDef rows live in code, not in the DB. Each entry encodes:
//   - scope (global / city / faction)
//   - end_condition descriptor (duration vs condition-bound)
//   - default bucket modifiers applied each year while active
//   - real-person target rules (e.g. "Plague kills 2-5 people/year")
//   - headline tone for narrative emission
//   - cascade_key when this event is fireable as a cascade (§9.3)

import type { EventDef, EventType } from '@claude-god/shared';
import {
  CRASH_RECOVER_INDEX,
  FACTION_WAR_FALLBACK_YEARS,
  PLAGUE_CLEAR_PCT,
} from '@claude-god/shared';

export const EVENT_CATALOG: Record<EventType, EventDef> = {
  // ── DISASTERS (city-scoped) ────────────────────────────────────────────────
  Plague: {
    id: 'Plague',
    scope: 'city',
    end_condition: { kind: 'plague-clear', clear_pct: PLAGUE_CLEAR_PCT },
    default_duration: null,
    bucket_modifiers: [
      { mortality_delta: 0.04, happiness_delta: -8 },
    ],
    real_person_target_rules: [
      {
        count_min: 2,
        count_max: 5,
        pool: {},
        apply: { kill: true },
      },
      {
        count_min: 1,
        count_max: 3,
        pool: {},
        apply: { state_tag: 'traumatized' },
      },
    ],
    headline_tone: 'tabloid',
    cascade_key: 'plague-risk',
  },

  Famine: {
    id: 'Famine',
    scope: 'city',
    end_condition: { kind: 'duration', years: 3 },
    default_duration: 3,
    bucket_modifiers: [
      { type: 'Farmer', income_multiplier: 0.5 },
      { mortality_delta: 0.02, happiness_delta: -10 },
    ],
    real_person_target_rules: [
      { count_min: 1, count_max: 3, pool: {}, apply: { kill: true } },
    ],
    headline_tone: 'reportage',
    cascade_key: 'farmer-collapse',
  },

  Fire: {
    id: 'Fire',
    scope: 'city',
    end_condition: { kind: 'duration', years: 1 },
    default_duration: 1,
    bucket_modifiers: [
      { type: 'Artisan', mortality_delta: 0.03 },
      { type: 'Laborer', mortality_delta: 0.03 },
      { happiness_delta: -4 },
    ],
    real_person_target_rules: [
      { count_min: 1, count_max: 4, pool: {}, apply: { kill: true } },
    ],
    headline_tone: 'tabloid',
  },

  Drought: {
    id: 'Drought',
    scope: 'city',
    end_condition: { kind: 'duration', years: 2 },
    default_duration: 2,
    bucket_modifiers: [
      { type: 'Farmer', income_multiplier: 0.7 },
      { type: 'Laborer', income_multiplier: 0.85 },
      { happiness_delta: -3 },
    ],
    real_person_target_rules: [],
    headline_tone: 'reportage',
  },

  // ── CONFLICTS (faction or city-scoped) ─────────────────────────────────────
  FactionWar: {
    id: 'FactionWar',
    scope: 'faction',
    end_condition: {
      kind: 'war-resolved',
      fallback_years: FACTION_WAR_FALLBACK_YEARS,
    },
    default_duration: null,
    bucket_modifiers: [
      { type: 'Soldier', mortality_delta: 0.05 },
      { happiness_delta: -5 },
    ],
    real_person_target_rules: [
      { count_min: 1, count_max: 5, pool: { type: 'Soldier' }, apply: { kill: true } },
      { count_min: 0, count_max: 3, pool: {}, apply: { state_tag: 'battle-veteran' } },
    ],
    headline_tone: 'epic',
  },

  CityRevolt: {
    id: 'CityRevolt',
    scope: 'city',
    end_condition: { kind: 'duration', years: 2 },
    default_duration: 2,
    bucket_modifiers: [
      { mortality_delta: 0.015, happiness_delta: -6, income_multiplier: 0.9 },
    ],
    real_person_target_rules: [
      { count_min: 1, count_max: 3, pool: {}, apply: { kill: true } },
      { count_min: 0, count_max: 2, pool: {}, apply: { state_tag: 'infamous' } },
    ],
    headline_tone: 'tabloid',
    cascade_key: 'happiness-revolt',
  },

  Siege: {
    id: 'Siege',
    scope: 'city',
    end_condition: { kind: 'siege-resolved' },
    default_duration: null,
    bucket_modifiers: [
      { mortality_delta: 0.04, happiness_delta: -12, income_multiplier: 0.6 },
    ],
    real_person_target_rules: [
      { count_min: 2, count_max: 6, pool: {}, apply: { kill: true } },
    ],
    headline_tone: 'epic',
  },

  ReligiousSchism: {
    id: 'ReligiousSchism',
    scope: 'faction', // operates on a religion (group)
    end_condition: { kind: 'duration', years: 1 },
    default_duration: 1,
    bucket_modifiers: [
      { happiness_delta: -3 },
    ],
    real_person_target_rules: [
      { count_min: 0, count_max: 2, pool: { type: 'Priest' }, apply: { state_tag: 'famous' } },
    ],
    headline_tone: 'literary',
    cascade_key: 'religious-schism',
  },

  // ── BOOMS (global or city) ─────────────────────────────────────────────────
  GoldenAge: {
    id: 'GoldenAge',
    scope: 'global',
    end_condition: { kind: 'duration', years: 5 },
    default_duration: 5,
    bucket_modifiers: [
      { happiness_delta: 8, income_multiplier: 1.15 },
    ],
    real_person_target_rules: [
      { count_min: 0, count_max: 2, pool: {}, apply: { state_tag: 'famous' } },
    ],
    headline_tone: 'epic',
  },

  BountifulHarvest: {
    id: 'BountifulHarvest',
    scope: 'city',
    end_condition: { kind: 'duration', years: 1 },
    default_duration: 1,
    bucket_modifiers: [
      { type: 'Farmer', income_multiplier: 1.4 },
      { happiness_delta: 4 },
    ],
    real_person_target_rules: [],
    headline_tone: 'neutral',
  },

  Discovery: {
    id: 'Discovery',
    scope: 'global',
    end_condition: { kind: 'duration', years: 1 },
    default_duration: 1,
    bucket_modifiers: [
      { type: 'Scholar', income_multiplier: 1.2 },
      { happiness_delta: 2 },
    ],
    real_person_target_rules: [
      { count_min: 0, count_max: 1, pool: { type: 'Scholar' }, apply: { state_tag: 'famous' } },
    ],
    headline_tone: 'literary',
  },

  // ── CATASTROPHE (global) ───────────────────────────────────────────────────
  GreatCrash: {
    id: 'GreatCrash',
    scope: 'global',
    end_condition: { kind: 'crash-recovered', threshold: CRASH_RECOVER_INDEX },
    default_duration: null,
    bucket_modifiers: [
      { type: 'Merchant', income_multiplier: 0.5 },
      { type: 'Noble', income_multiplier: 0.7 },
      { happiness_delta: -6 },
    ],
    real_person_target_rules: [
      { count_min: 0, count_max: 3, pool: { type: 'Merchant' }, apply: { state_tag: 'ruined' } },
      { count_min: 0, count_max: 2, pool: { type: 'Noble' }, apply: { state_tag: 'ruined' } },
    ],
    headline_tone: 'literary',
    cascade_key: 'crash',
  },
};

/** Lookup a catalog entry. */
export function getEventDef(id: EventType): EventDef {
  return EVENT_CATALOG[id];
}

/** All EventDefs as a flat list (catalog test enumeration). */
export function listEventDefs(): EventDef[] {
  return Object.values(EVENT_CATALOG);
}
