// ============================================================
// EVENT CATALOG — Static definitions for all 6 world events
// Player activates events from this catalog (max 6 active at once).
// params JSON is validated against each event's ParamSchema at activation.
// ============================================================

// ── Targeting ─────────────────────────────────────────────────────────────
// All events support optional include/exclude targeting so the player
// can scope effects to a subset of the population.

export type TraitKey =
  | 'strength' | 'endurance' | 'agility' | 'resilience'
  | 'intelligence' | 'willpower' | 'intuition' | 'creativity'
  | 'charisma' | 'empathy' | 'loyalty' | 'jealousy'
  | 'ambition' | 'courage' | 'discipline' | 'cunning';

export interface TraitFilter {
  trait: TraitKey;
  threshold: number;        // 0–100
  direction: 'above' | 'below';
}

/** Core identity filters. Each array is "match ANY of these values". */
export interface IdentityFilter {
  races?: string[];
  religions?: string[];     // group name strings
  genders?: string[];
  factions?: string[];      // group name strings
  age_min?: number;
  age_max?: number;
  occupations?: string[];
}

/** Targeting block present on all events that support scoping. */
export interface EventTargeting {
  /** Trait conditions that must all pass (AND logic). */
  trait_filters?: TraitFilter[];
  /** Identity conditions — each array is OR'd, arrays are AND'd together. */
  identity_filters?: IdentityFilter;
  /** If true, negate the whole targeting block (target everyone EXCEPT matches). */
  exclude?: boolean;
}

// ── Shared event field types ───────────────────────────────────────────────

export type EventDefId =
  | 'plague'
  | 'war'
  | 'golden_age'
  | 'great_depression'
  | 'baby_boom'
  | 'robin_hood';

// ── Per-event param shapes ─────────────────────────────────────────────────

export interface PlagueParams {
  /** % chance per tick an eligible person becomes infected (0–100). */
  infection_chance: number;
  /** HP drained per tick while infected. */
  health_drain: number;
  /** Happiness drained per tick while infected. */
  happiness_drain: number;
  /** Recover when current_health rises above this value (0–100). */
  recovery_health_threshold: number;
  /** Recover when happiness rises above this value (0–100). */
  recovery_happiness_threshold: number;
  /** Targeting — who is eligible to be infected. */
  targeting?: EventTargeting;
}

export interface WarGroupRef {
  type: 'faction' | 'religion';
  id: string;
  name: string;
}

export interface WarParams {
  group_a: WarGroupRef;
  group_b: WarGroupRef;
  /** % of each group affected per tick (0–100). */
  percent_affected: number;
  /** Flat HP damage dealt to each affected combatant. */
  flat_damage: number;
  /** Flat gold deducted from each group's balance per tick. */
  cost_per_tick: number;
  /** War ends automatically if a group's balance drops below this. */
  bankruptcy_threshold: number;
}

export interface GoldenAgeParams {
  /** HP healed per tick per eligible person. */
  health_gain: number;
  /** Happiness gained per tick per eligible person. */
  happiness_gain: number;
  /** Money earned bonus per tick per eligible person. */
  money_bonus: number;
  /** Targeting — who receives the golden-age benefits. */
  targeting?: EventTargeting;
}

export interface GreatDepressionParams {
  /** Market floor multiplier — market cannot fall below this fraction of its current index (0–1). */
  market_floor: number;
  /** Money lost per tick per eligible unemployed person. */
  unemployment_drain: number;
  /** Happiness drain per tick per eligible person. */
  happiness_drain: number;
  /** Multiplier applied to job-firing threshold (>1 = easier to fire). */
  firing_multiplier: number;
  /** Targeting — who feels the depression's effects. */
  targeting?: EventTargeting;
}

export interface BabyBoomParams {
  /** % chance per tick any two living eligible people conceive (0–100). */
  conception_chance: number;
  /** Flat happiness boost per tick to everyone in the world. */
  happiness_boost: number;
  // Baby Boom is always universal — no targeting block.
}

export interface RobinHoodParams {
  /** Top X% of earners considered "rich" (e.g. 1 = top 1%). */
  rich_percentile: number;
  /** Bottom X% of earners considered "poor" (e.g. 20 = bottom 20%). */
  poor_percentile: number;
  /** % of the rich person's money transferred per tick (0–100). */
  transfer_percent: number;
  /** Happiness lost by rich per transfer event. */
  rich_happiness_drain: number;
  /** Happiness gained by poor per transfer event. */
  poor_happiness_gain: number;
  // Robin Hood is always universal — no targeting block.
}

export type EventParams =
  | PlagueParams
  | WarParams
  | GoldenAgeParams
  | GreatDepressionParams
  | BabyBoomParams
  | RobinHoodParams;

// ── Param field descriptors for UI rendering ──────────────────────────────

export type ParamFieldType = 'number' | 'percent' | 'group_ref';

export interface ParamFieldDef {
  key: string;
  label: string;
  type: ParamFieldType;
  /** For number/percent fields. */
  min?: number;
  max?: number;
  default: number | string;
  description?: string;
}

// ── EventDef ───────────────────────────────────────────────────────────────

export interface EventDef {
  id: EventDefId;
  name: string;
  description: string;
  /** Flavor category for UI color/icon. */
  category: 'negative' | 'positive' | 'chaotic' | 'neutral';
  /** Does this event use the PersonEventStatus infection table? */
  uses_infection: boolean;
  /** Does this event support trait/identity targeting? */
  supports_targeting: boolean;
  /** Ordered list of param fields rendered in the activation form. */
  param_fields: ParamFieldDef[];
  /** Returns a default params object for the activation form. */
  default_params: () => EventParams;
}

// ── Catalog ────────────────────────────────────────────────────────────────

export const EVENT_CATALOG: EventDef[] = [
  // ── 1. Plague ────────────────────────────────────────────────────────
  {
    id: 'plague',
    name: 'Plague',
    description:
      'A contagion spreads through the population. Infected souls suffer health and happiness damage each tick. Survivors recover when they cross the recovery thresholds.',
    category: 'negative',
    uses_infection: true,
    supports_targeting: true,
    param_fields: [
      { key: 'infection_chance', label: 'Infection Chance (%)', type: 'percent', min: 1, max: 100, default: 20, description: 'Chance per tick an eligible person becomes infected.' },
      { key: 'health_drain', label: 'Health Drain / tick', type: 'number', min: 1, max: 50, default: 5, description: 'HP lost per tick while infected.' },
      { key: 'happiness_drain', label: 'Happiness Drain / tick', type: 'number', min: 1, max: 50, default: 3, description: 'Happiness lost per tick while infected.' },
      { key: 'recovery_health_threshold', label: 'Recovery Health Threshold', type: 'number', min: 1, max: 100, default: 60, description: 'Person recovers when health exceeds this value.' },
      { key: 'recovery_happiness_threshold', label: 'Recovery Happiness Threshold', type: 'number', min: 1, max: 100, default: 40, description: 'Person recovers when happiness exceeds this value.' },
    ],
    default_params: (): PlagueParams => ({
      infection_chance: 20,
      health_drain: 5,
      happiness_drain: 3,
      recovery_health_threshold: 60,
      recovery_happiness_threshold: 40,
    }),
  },

  // ── 2. War ───────────────────────────────────────────────────────────
  {
    id: 'war',
    name: 'War',
    description:
      'Two groups clash. Each tick, a percentage of each group is selected for combat and dealt flat damage. War drains group treasuries — bankruptcy or total annihilation ends the conflict.',
    category: 'negative',
    uses_infection: false,
    supports_targeting: false,
    param_fields: [
      { key: 'percent_affected', label: 'Combatants / tick (%)', type: 'percent', min: 1, max: 100, default: 20, description: '% of each group involved in combat each tick.' },
      { key: 'flat_damage', label: 'Flat Damage', type: 'number', min: 1, max: 100, default: 10, description: 'HP damage dealt to each combatant per tick.' },
      { key: 'cost_per_tick', label: 'War Cost / tick (gold)', type: 'number', min: 0, max: 10000, default: 100, description: 'Gold deducted from each group treasury per tick.' },
      { key: 'bankruptcy_threshold', label: 'Bankruptcy Threshold (gold)', type: 'number', min: 0, max: 10000, default: 0, description: 'War ends automatically when a group falls below this balance.' },
    ],
    default_params: (): WarParams => ({
      group_a: { type: 'faction', id: '', name: '' },
      group_b: { type: 'faction', id: '', name: '' },
      percent_affected: 20,
      flat_damage: 10,
      cost_per_tick: 100,
      bankruptcy_threshold: 0,
    }),
  },

  // ── 3. Golden Age ────────────────────────────────────────────────────
  {
    id: 'golden_age',
    name: 'Golden Age',
    description:
      'An era of prosperity. Eligible people gain health, happiness, and bonus income each tick. A rising tide that can be targeted at specific groups.',
    category: 'positive',
    uses_infection: false,
    supports_targeting: true,
    param_fields: [
      { key: 'health_gain', label: 'Health Gain / tick', type: 'number', min: 0, max: 50, default: 3, description: 'HP restored per tick.' },
      { key: 'happiness_gain', label: 'Happiness Gain / tick', type: 'number', min: 0, max: 50, default: 5, description: 'Happiness gained per tick.' },
      { key: 'money_bonus', label: 'Money Bonus / tick', type: 'number', min: 0, max: 5000, default: 50, description: 'Extra gold earned per tick.' },
    ],
    default_params: (): GoldenAgeParams => ({
      health_gain: 3,
      happiness_gain: 5,
      money_bonus: 50,
    }),
  },

  // ── 4. Great Depression ──────────────────────────────────────────────
  {
    id: 'great_depression',
    name: 'Great Depression',
    description:
      'Markets crash, jobs vanish, and morale collapses. Unemployment drains money, jobs become harder to keep, and happiness falls across the board. A market floor prevents total collapse.',
    category: 'negative',
    uses_infection: false,
    supports_targeting: true,
    param_fields: [
      { key: 'market_floor', label: 'Market Floor (0–1)', type: 'number', min: 0.01, max: 0.99, default: 0.3, description: 'Market index cannot fall below this fraction of its current value.' },
      { key: 'unemployment_drain', label: 'Unemployment Drain / tick', type: 'number', min: 0, max: 500, default: 20, description: 'Money lost per tick per unemployed person.' },
      { key: 'happiness_drain', label: 'Happiness Drain / tick', type: 'number', min: 0, max: 50, default: 4, description: 'Happiness lost per tick per eligible person.' },
      { key: 'firing_multiplier', label: 'Firing Multiplier', type: 'number', min: 1, max: 5, default: 1.5, description: 'Multiplier on job-firing threshold — easier to lose a job.' },
    ],
    default_params: (): GreatDepressionParams => ({
      market_floor: 0.3,
      unemployment_drain: 20,
      happiness_drain: 4,
      firing_multiplier: 1.5,
    }),
  },

  // ── 5. Baby Boom ─────────────────────────────────────────────────────
  {
    id: 'baby_boom',
    name: 'Baby Boom',
    description:
      'A surge of new life floods the world. Any two living souls can conceive regardless of relationship status, and the whole world is a little happier for it.',
    category: 'positive',
    uses_infection: false,
    supports_targeting: false, // universal
    param_fields: [
      { key: 'conception_chance', label: 'Conception Chance (%)', type: 'percent', min: 1, max: 100, default: 15, description: '% chance per tick any two eligible people conceive.' },
      { key: 'happiness_boost', label: 'Happiness Boost / tick', type: 'number', min: 0, max: 20, default: 2, description: 'Flat happiness gain for everyone each tick.' },
    ],
    default_params: (): BabyBoomParams => ({
      conception_chance: 15,
      happiness_boost: 2,
    }),
  },

  // ── 6. Robin Hood ────────────────────────────────────────────────────
  {
    id: 'robin_hood',
    name: 'Robin Hood',
    description:
      'Wealth is redistributed from the richest to the poorest. The top percentile loses a fraction of their gold each tick; the bottom percentile receives it. Pure money transfer — markets are unaffected.',
    category: 'chaotic',
    uses_infection: false,
    supports_targeting: false, // universal
    param_fields: [
      { key: 'rich_percentile', label: 'Rich Percentile (top %)', type: 'number', min: 1, max: 20, default: 1, description: 'Top X% of earners classified as rich.' },
      { key: 'poor_percentile', label: 'Poor Percentile (bottom %)', type: 'number', min: 5, max: 50, default: 20, description: 'Bottom X% of earners classified as poor.' },
      { key: 'transfer_percent', label: 'Transfer % per tick', type: 'percent', min: 1, max: 100, default: 10, description: '% of each rich person\'s money transferred per tick.' },
      { key: 'rich_happiness_drain', label: 'Rich Happiness Drain', type: 'number', min: 0, max: 30, default: 5, description: 'Happiness lost by each rich person per tick.' },
      { key: 'poor_happiness_gain', label: 'Poor Happiness Gain', type: 'number', min: 0, max: 30, default: 8, description: 'Happiness gained by each poor person per tick.' },
    ],
    default_params: (): RobinHoodParams => ({
      rich_percentile: 1,
      poor_percentile: 20,
      transfer_percent: 10,
      rich_happiness_drain: 5,
      poor_happiness_gain: 8,
    }),
  },
];

/** O(1) lookup by id. */
export const EVENT_BY_ID: Record<EventDefId, EventDef> = Object.fromEntries(
  EVENT_CATALOG.map((e) => [e.id, e]),
) as Record<EventDefId, EventDef>;

/** Max simultaneous active events per world. */
export const MAX_ACTIVE_EVENTS = 6;
