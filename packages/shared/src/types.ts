// ============================================================
// SHARED TYPES — used by both backend and frontend
// ============================================================

// --------------- Narrative Tone ---------------

/**
 * Voice routing for Claude narration. Determines the voice prefix
 * injected into headline / memory / decade prompts.
 *
 * - `tabloid`   — scandals, rises/falls, affairs, forced interactions
 * - `literary`  — deaths, births, quiet beats, natural old-age passing
 * - `epic`      — group founded/dissolved/split, decade summaries
 * - `reportage` — bulk chaos (plague, nukes, bulk God Mode filter actions)
 * - `neutral`   — fallback for routine low-magnitude events; terse factual
 */
export type Tone = 'tabloid' | 'literary' | 'epic' | 'reportage' | 'neutral';

export const TONES: readonly Tone[] = ['tabloid', 'literary', 'epic', 'reportage', 'neutral'];

// --------------- Identity Attribute system ---------------

/** 25 identity attributes across 5 categories — the core of who a person IS */
export const IDENTITY_ATTRIBUTES = {
  physical:  ['beauty', 'health', 'strength', 'endurance', 'agility'],
  mental:    ['intelligence', 'creativity', 'memory', 'curiosity', 'cunning'],
  social:    ['charisma', 'empathy', 'humor', 'leadership', 'persuasion'],
  character: ['ambition', 'discipline', 'honesty', 'courage', 'resilience'],
  skills:    ['combat', 'craftsmanship', 'artistry', 'street_smarts', 'survival'],
} as const;

export type IdentityCategoryKey = keyof typeof IDENTITY_ATTRIBUTES;

/** Flat list of all 25 identity attribute keys */
export const ALL_IDENTITY_KEYS = Object.values(IDENTITY_ATTRIBUTES).flat() as string[];

/** Flat map of all 25 identity attribute keys → values (0-100) */
export type TraitSet = Record<string, number>;

// --------------- Global Trait system ---------------

export interface GlobalTraitChild {
  /** minimum possible value */
  min: number;
  /** maximum possible value */
  max: number;
  /** short description */
  description: string;
}

export interface GlobalTraitDef {
  children: Record<string, GlobalTraitChild>;
}

/**
 * 6 world-level forces, each with 4 child attributes.
 * Child ranges determine how positive/negative each force can be —
 * swap -100→0 children for 0→100 ones to tune world mood.
 */
export const GLOBAL_TRAITS = {
  scarcity: {
    children: {
      food_supply:        { min: -100, max: 100,  description: 'famine (-100) → abundance (+100)' },
      water_access:       { min: -100, max: 100,  description: 'drought (-100) → plenty (+100)' },
      material_wealth:    { min:    0, max: 100,  description: 'how much exists in the world' },
      hoarding_pressure:  { min: -100, max:   0,  description: 'pulls society toward selfishness — always negative' },
    },
  },
  war: {
    children: {
      military_strength:    { min:    0, max: 100,  description: 'army power' },
      civilian_casualties:  { min: -100, max:   0,  description: 'death toll — always negative' },
      territorial_control:  { min: -100, max: 100,  description: 'losing ground (-100) → conquering (+100)' },
      morale:               { min: -100, max: 100,  description: 'crushed (-100) → triumphant (+100)' },
    },
  },
  faith: {
    children: {
      devotion:           { min:    0, max: 100,  description: 'how religious the population is' },
      spiritual_comfort:  { min:    0, max: 100,  description: 'faith as a source of peace' },
      zealotry:           { min: -100, max:   0,  description: 'dangerous extremism — always negative' },
      religious_control:  { min: -100, max: 100,  description: 'persecution (-100) → protection (+100)' },
    },
  },
  plague: {
    children: {
      infection_rate:    { min: -100, max:   0,  description: 'spread rate — always negative' },
      mortality_rate:    { min: -100, max:   0,  description: 'death rate — always negative' },
      medical_response:  { min:    0, max: 100,  description: "society's ability to handle it" },
      fear_contagion:    { min: -100, max:   0,  description: 'social panic — always negative' },
    },
  },
  tyranny: {
    children: {
      oppression:   { min: -100, max:   0,  description: 'state violence against citizens — always negative' },
      surveillance: { min: -100, max:   0,  description: 'control of information — always negative' },
      stability:    { min:    0, max: 100,  description: 'order is maintained, even if cruelly' },
      resistance:   { min: -100, max: 100,  description: 'crushed uprising (-100) → full revolution (+100)' },
    },
  },
  discovery: {
    children: {
      technological_advancement: { min:    0, max: 100,  description: 'what tools and weapons exist' },
      knowledge_spread:          { min:    0, max: 100,  description: 'how fast ideas travel' },
      cultural_disruption:       { min: -100, max: 100,  description: 'destabilizing (-100) → liberating (+100)' },
      scientific_heresy:         { min: -100, max: 100,  description: 'challenges old power — dual-natured' },
    },
  },
} as const satisfies Record<string, GlobalTraitDef>;

export type GlobalTraitKey      = keyof typeof GLOBAL_TRAITS;
export type GlobalTraitChildKey = {
  [K in GlobalTraitKey]: keyof typeof GLOBAL_TRAITS[K]['children']
}[GlobalTraitKey];

/** Flat map: globalTraitKey.childKey → current value */
export type GlobalTraitSet = Record<string, number>;

/** Default global trait values — world starts neutral */
export const DEFAULT_GLOBAL_TRAITS: GlobalTraitSet = {
  'scarcity.food_supply':               50,
  'scarcity.water_access':              50,
  'scarcity.material_wealth':           50,
  'scarcity.hoarding_pressure':        -10,

  'war.military_strength':              30,
  'war.civilian_casualties':             0,
  'war.territorial_control':             0,
  'war.morale':                         20,

  'faith.devotion':                     50,
  'faith.spiritual_comfort':            40,
  'faith.zealotry':                    -20,
  'faith.religious_control':            10,

  'plague.infection_rate':               0,
  'plague.mortality_rate':               0,
  'plague.medical_response':            20,
  'plague.fear_contagion':               0,

  'tyranny.oppression':                -30,
  'tyranny.surveillance':              -20,
  'tyranny.stability':                  60,
  'tyranny.resistance':                -10,

  'discovery.technological_advancement': 20,
  'discovery.knowledge_spread':          20,
  'discovery.cultural_disruption':        0,
  'discovery.scientific_heresy':          0,
};

// --------------- Ruleset system ---------------

export interface TraitWeight {
  /** trait key, e.g. 'mercy', 'combat_skill' */
  trait: string;
  /** +1 = helps this interaction, -1 = hurts it */
  sign: 1 | -1;
  /** optional multiplier on top of sign (default 1) */
  multiplier?: number;
}

export interface GlobalAmplifier {
  /** dotted key, e.g. 'war.morale' */
  key: string;
  /** fraction of that global child value added to score */
  multiplier: number;
}

export interface InteractionTypeDef {
  id:                string;
  label:             string;
  /** relative probability weight for random selection */
  weight:            number;
  trait_weights:     TraitWeight[];
  global_amplifiers: GlobalAmplifier[];
  /**
   * Whether a positive-band outcome of this interaction can queue a
   * Pregnancy. Gates the band-level `creates_pregnancy` flag so the same
   * band can be reused across interaction types without unintended births.
   */
  can_conceive?:     boolean;
}

/**
 * Effect packet — a bundle of stat changes (and optional trait drifts)
 * applied to one side of an interaction.
 *
 * `stat_delta` is a [min,max] range rolled once per application; the rolled
 * magnitude is applied to every key in `affects_stats`.
 *
 * `trait_deltas`, when present, applies **permanent** changes to identity
 * attributes — this is the mechanism for trauma / triumph modifiers
 * (Phase 1 step 8). Values are small (±1 to ±3). Unknown keys are skipped.
 */
export interface EffectPacket {
  stat_delta:    [number, number];
  affects_stats: string[];
  trait_deltas?: Record<string, number>;
}

export interface OutcomeBand {
  label:            string;
  /** score must be >= this to qualify (ordered highest → lowest) */
  min_score:        number;
  /** 0-1 relative intensity — drives memory decay + trauma strength */
  magnitude:        number;
  /** Effect applied to the subject (protagonist) of the interaction. */
  subject_effect:    EffectPacket;
  /** Effect applied to the antagonist. Missing = mirror of subject_effect. */
  antagonist_effect?: EffectPacket;
  can_die:          boolean;
  creates_memory:   boolean;
  creates_headline: boolean;

  /**
   * Optional ruleset-level tone override for this band. If present, memories
   * and any related headline generated off this band use this voice.
   * Otherwise the tone service falls back to category-based routing.
   */
  tone?:            Tone;

  /**
   * Event-driven group formation. When present, triggering this band attempts
   * to spawn a new group founded by the subject (or antagonist, per `founder`).
   * Capability gate is bypassed — the ruleset author opted in explicitly.
   */
  creates_group?: {
    kind:            'religion' | 'faction';
    /** Who becomes the founder. Defaults to 'subject'. */
    founder?:        'subject' | 'antagonist';
    /** Optional name prefix, e.g. "Cult of" or "Order of". */
    name_prefix?:    string;
    /** How to derive the virus profile. Currently only founder_standouts. */
    profile_source?: 'founder_standouts';
  };

  /**
   * When true, a successful outcome of this band queues a pregnancy between
   * the subject and antagonist. Resolves at tick = started_tick +
   * PREGNANCY_DURATION_TICKS via createChildFromParents. Ignored if either
   * participant is already in an unresolved pregnancy together.
   */
  creates_pregnancy?: boolean;

  /** @deprecated use subject_effect.stat_delta — retained for legacy rulesets */
  stat_delta?:      [number, number];
  /** @deprecated use subject_effect.affects_stats */
  affects_stats?:   string[];
}

/**
 * One passive drift rule — a per-tick auto-adjustment on a person stat
 * computed from global trait values. Unknown stat keys or global keys
 * are silently skipped so the engine stays fully data-driven.
 */
export interface PassiveDriftRule {
  /** Person stat to drift (e.g. 'health', 'happiness'). Unknown keys are skipped. */
  stat:       string;
  /** Constant added before scaling by inputs (default 0) */
  base?:      number;
  /** Global trait contributions — value * multiplier is summed */
  inputs:     { key: string; multiplier: number }[];
  /** Clamp final drift to this range */
  min:        number;
  max:        number;
}

/**
 * Capability gates — thresholds a person must clear to perform high-stakes
 * actions. Stored in the ruleset so every world can tune them independently.
 * All fields optional; hard-coded fallback constants are used when absent.
 */
export interface CapabilityGates {
  /** Founding a new religion */
  found_religion?: { leadership_min: number; charisma_min: number };
  /** Founding a new faction */
  found_faction?:  { leadership_min: number; charisma_min: number };
  /** Agentic murder action */
  agentic_murder?: { honesty_max: number; bond_max: number };
  /** Agentic marry action */
  agentic_marry?:  { bond_min: number };
  /** Agentic betray action */
  agentic_betray?: { bond_min: number };
  /** Agentic befriend action */
  agentic_befriend?: { bond_min: number; bond_max: number };
  /**
   * Agentic conception — a bonded pair decides to try for a child. Set
   * `enabled: false` to disable the agentic path entirely (interaction-driven
   * conception still works).
   */
  agentic_conceive?: { bond_min?: number; enabled?: boolean };
}

/**
 * Number of ticks from conception to birth. 2 ticks = 1 world year.
 * Kept in shared so the ruleset author and the tick engine agree.
 */
export const PREGNANCY_DURATION_TICKS = 2;

/**
 * Variance applied per identity attribute when averaging parent traits at
 * birth. Child trait = clamp(mean(A, B) + random(-N, N), 0, 100).
 */
export const BIRTH_TRAIT_VARIANCE = 8;

/** Race label used when the two parents have different races. */
export const MIXED_RACE_LABEL = 'Mixed';

export interface RulesetDef {
  version:           number;
  interaction_types: InteractionTypeDef[];
  /** ordered highest min_score → lowest — first match wins */
  outcome_bands:     OutcomeBand[];
  /** Optional per-tick passive drifts applied to every living person */
  passive_drifts?:   PassiveDriftRule[];
  /** Optional capability gate overrides. Falls back to engine defaults when absent. */
  capability_gates?: CapabilityGates;
}

// --------------- Global trait multipliers ---------------

/** Per-global-trait effect multipliers (e.g. { war: 1.5 }) */
export type GlobalTraitMultipliers = Partial<Record<GlobalTraitKey, number>>;

/** Default — all forces at 1× */
export const DEFAULT_GLOBAL_TRAIT_MULTIPLIERS: Record<string, number> = {
  scarcity:  1.0,
  war:       1.0,
  faith:     1.0,
  plague:    1.0,
  tyranny:   1.0,
  discovery: 1.0,
};

// --------------- Tick engine ---------------

export interface TickTopScore {
  protagonist_name: string;
  score:            number;
  outcome:          string;
}

export interface TickResult {
  tick_number:             number;
  world_year:              number;
  interactions_processed:  number;
  deaths_this_tick:        number;
  births_this_tick:        number;
  /** Market return as a percentage (e.g. 2.1 = +2.1%) */
  market_return_pct:       number;
  new_market_index:        number;
  /** Best score per interaction type id */
  top_scores:              Record<string, TickTopScore>;
  /** Phase 7 Wave 3 — agentic actions that fired on year-boundary ticks. */
  agentic_actions?:        AgenticActionLog[];
}

/** One deliberate action taken by a high-agency agent during the yearly pass. */
export interface AgenticActionLog {
  kind:          'befriend' | 'betray' | 'marry' | 'murder';
  agent_id:      string;
  agent_name:    string;
  target_id:     string;
  target_name:   string;
  killed_target: boolean;
}

// --------------- Economy ---------------

export interface EconomyState {
  market_index:             number;
  market_trend:             number;
  market_volatility:        number;
  tick_count:               number;
  total_deaths:             number;
  current_year:             number;
  global_trait_multipliers: Record<string, number>;
  /** Current world global trait child values e.g. { "war.morale": 20 } */
  global_traits:            Record<string, number>;
}

// --------------- City (Phase 7) ---------------
// Every world has exactly one city. Future multi-city support will replace
// the @@unique(world_id) with a `city_id` column on Person / DeceasedPerson.

export interface City {
  id:           string;
  name:         string;
  description:  string | null;
  founded_year: number;
  world_id:     string;
  created_at:   string;
  updated_at:   string;
}

export interface CityWithStats extends City {
  population:  number;
  dead_total:  number;
}

// --------------- Deceased person ---------------

export interface DeceasedPerson {
  id:                    string;
  name:                  string;
  age_at_death:          number;
  world_year:            number;
  cause:                 string;
  final_health:          number;
  final_wealth:          number;
  peak_positive_outcome: string | null;
  peak_negative_outcome: string | null;
  died_at:               string;
}

// --------------- Enums ---------------

export enum Sexuality {
  HETEROSEXUAL = 'HETEROSEXUAL',
  HOMOSEXUAL   = 'HOMOSEXUAL',
  BISEXUAL     = 'BISEXUAL',
  ASEXUAL      = 'ASEXUAL',
  PANSEXUAL    = 'PANSEXUAL',
  OTHER        = 'OTHER',
}

// --------------- Sub-shapes ---------------

/** One entry in a character's criminal history */
export interface CriminalRecord {
  offense:   string;
  date:      string;                              // ISO-8601 date string
  severity:  'minor' | 'moderate' | 'severe';
  status:    'pending' | 'convicted' | 'acquitted';
  notes?:    string;
}

// --------------- Core entity ---------------

/**
 * Full Person entity as returned from the API.
 * All 0-100 stats are typed as integers; wealth is a float.
 */
export interface Person {
  id:                  string;   // UUID
  name:                string;

  // ── Demographic ──────────────────────────────────────────
  sexuality:           Sexuality;
  gender:              string;
  race:                string;
  occupation:          string;
  age:                 number;   // years (int)
  death_age:           number;   // age at which natural death occurs (int)

  // ── Social ───────────────────────────────────────────────
  relationship_status: string;
  religion:            string;
  criminal_record:     CriminalRecord[];

  // ── Vital stat ───────────────────────────────────────────
  /// Life/death column, synced from traits.health. 0 = dead.
  health:              number;

  // ── Other ────────────────────────────────────────────────
  physical_appearance: string;
  wealth:              number;   // float, no upper bound
  traits:              TraitSet; // 25 identity attributes (0-100) — beauty, strength, cunning, etc.
  /** Personal global force scores, keyed by "force.child" e.g. "war.morale" */
  global_scores:       Record<string, number>;

  // ── Timestamps ───────────────────────────────────────────
  created_at:          string;   // ISO-8601
  updated_at:          string;   // ISO-8601
}

// --------------- Memory Bank ---------------

/** Emotional valence of a memory */
export type EmotionalImpact =
  | 'traumatic'
  | 'negative'
  | 'neutral'
  | 'positive'
  | 'euphoric';

/** One logged change event attached to a character */
export interface MemoryEntry {
  id:               string;   // UUID
  person_id:        string;
  event_summary:    string;
  emotional_impact: EmotionalImpact;
  /** The delta that triggered this memory (partial snapshot of changed fields) */
  delta_applied:    PersonDelta;
  /** 0.0-1.0 — how extreme the triggering outcome was. Top/bottom band = 1.0. */
  magnitude:        number;
  /** Counterparty person id for grudge/loyalty weighting (null for solo events). */
  counterparty_id:  string | null;
  timestamp:        string;   // ISO-8601
  world_year:       number | null;
}

// --------------- Inner Circle ---------------

export type InnerCircleRelation =
  | 'parent'
  | 'child'
  | 'sibling'
  | 'spouse'
  | 'lover'
  | 'close_friend'
  | 'rival'
  | 'enemy';

export interface InnerCircleLink {
  id:            string;
  owner_id:      string;
  target_id:     string;
  relation_type: InnerCircleRelation;
  bond_strength: number;   // 0-100
  created_at:    string;
  updated_at:    string;
}

// --------------- Groups (Religions, Factions) ---------------

export type GroupOrigin = 'emergent' | 'player' | 'event';

/**
 * Virus profile — a map of trait/global-score keys to threshold rules.
 * Any key can be referenced — identity attributes (e.g. 'charisma'),
 * global score keys (e.g. 'faith.devotion'), or future extensions.
 * Unknown keys are silently skipped by the matching engine.
 *
 * Example:
 *   {
 *     "charisma":        { "min": 60 },
 *     "faith.devotion":  { "min": 70 },
 *     "morality":        { "min": 20, "max": 80 }
 *   }
 */
export interface VirusThreshold {
  min?: number;
  max?: number;
}
export type VirusProfile = Record<string, VirusThreshold>;

export interface Religion {
  id:               string;
  name:             string;
  description:      string | null;
  founder_id:       string | null;
  origin:           GroupOrigin;
  tolerance:        number;
  virus_profile:    VirusProfile;
  founded_year:     number;
  is_active:        boolean;
  dissolved_year:   number | null;
  dissolved_reason: string | null;
  created_at:       string;
  updated_at:       string;
}

export interface ReligionMembership {
  id:          string;
  religion_id: string;
  person_id:   string;
  joined_year: number;
  alignment:   number;
  created_at:  string;
  updated_at:  string;
}

export interface Faction {
  id:               string;
  name:             string;
  description:      string | null;
  founder_id:       string | null;
  leader_id:        string | null;
  origin:           GroupOrigin;
  tolerance:        number;
  virus_profile:    VirusProfile;
  founded_year:     number;
  is_active:        boolean;
  dissolved_year:   number | null;
  dissolved_reason: string | null;
  split_from_id:    string | null;
  created_at:       string;
  updated_at:       string;
}

export interface FactionMembership {
  id:                    string;
  faction_id:            string;
  person_id:             string;
  joined_year:           number;
  alignment:             number;
  split_pressure_ticks:  number;
  created_at:            string;
  updated_at:            string;
}

// --------------- World (Phase 4) ---------------

export type PopulationTier = 'intimate' | 'town' | 'civilization';

export interface World {
  id:                       string;
  name:                     string;
  description:              string | null;
  is_active:                boolean;
  archived_at:              string | null;
  population_tier:          PopulationTier;
  ruleset_id:               string | null;
  current_year:             number;
  tick_count:               number;
  total_deaths:             number;
  market_index:             number;
  market_trend:             number;
  market_volatility:        number;
  global_traits:            Record<string, number>;
  global_trait_multipliers: Record<string, number>;
  created_at:               string;
  updated_at:               string;
}

/** Returned by GET /api/worlds (list view — adds population + ruleset_name) */
export interface WorldListItem extends Omit<World, 'global_traits' | 'global_trait_multipliers'> {
  population:   number;
  ruleset_name: string | null;
}

// --------------- Delta / Mutation types ---------------

/** Fields that can be changed via the Simulation Service or God Mode.
 *  criminal_record uses its own endpoints so it is excluded here. */
export type MutablePersonFields = Omit<
  Person,
  'id' | 'criminal_record' | 'created_at' | 'updated_at'
>;

/** A partial update — only the fields that are changing */
export type PersonDelta = Partial<MutablePersonFields>;

/** Request body for POST /characters/:id/delta */
export interface DeltaRequest {
  delta:         PersonDelta;
  event_summary: string;
  emotional_impact: EmotionalImpact;
  /** When true, skip simulation rules (God Mode) */
  force?:        boolean;
  /** Optional Chronicler voice override for the memory entry. */
  tone?:         Tone;
}

/** Request body for POST /characters/:id/criminal-record */
export interface CriminalRecordEntry {
  record: CriminalRecord;
  event_summary: string;
}

/** Response shape for all character mutations */
export interface MutationResult {
  person:        Person;
  memory_entry:  MemoryEntry;
}

// --------------- List / search ---------------

export interface CharacterListItem {
  id:            string;
  name:          string;
  age:           number;
  health:        number;
  wealth:        number;
  updated_at:    string;
  global_scores: Record<string, number>;
}

/**
 * Richer list item returned by GET /api/characters/search — carries the
 * fields the /people filter UI needs to render filter chips and card icons
 * without N+1-ing a second fetch per card.
 */
export interface PeopleListItem {
  id:            string;
  name:          string;
  age:           number;
  gender:        string;
  race:          string;
  religion:      string;
  health:        number;
  wealth:        number;
  updated_at:    string;
  global_scores: Record<string, number>;
  /** Subset of identity traits for quick display (from traits JSONB) */
  traits:        Record<string, number>;
  factions:      { id: string; name: string }[];
}

export type PeopleStatus = 'alive' | 'dead' | 'all';
export type PeopleSortField =
  | 'name'
  | 'age'
  | 'wealth'
  | 'health'
  | 'updated_at';

export interface PeopleSearchParams {
  status?:    PeopleStatus;
  age_min?:   number;
  age_max?:   number;
  /** comma-separated list server-side; arrays client-side */
  races?:     string[];
  religions?: string[];
  factions?:  string[];
  q?:         string;
  sort?:      PeopleSortField;
  order?:     'asc' | 'desc';
  page?:      number;
  limit?:     number;
}

export interface PaginatedResponse<T> {
  data:  T[];
  total: number;
  page:  number;
  limit: number;
}

// --------------- Bulk Filter Actions ---------------

/** Numeric comparison operators */
type NumericOp = 'lt' | 'lte' | 'gt' | 'gte';

/**
 * One filter clause. All clauses in a FilterQuery are AND-composed.
 *
 * Scalar fields: age, health, wealth
 * Demographic fields: race, occupation, religion, gender
 * JSONB dot-paths: trait.<key>  (identity attributes, 0-100)
 *                  global_score.<key>  (e.g. "war.morale")
 */
export type FilterClause =
  | { field: 'age' | 'health' | 'wealth'; op: NumericOp; value: number }
  | { field: 'age' | 'health' | 'wealth'; op: 'between'; min: number; max: number }
  | { field: 'race' | 'occupation' | 'religion' | 'gender'; op: 'eq'; value: string }
  | { field: 'race' | 'occupation' | 'religion' | 'gender'; op: 'in'; values: string[] }
  | { field: `trait.${string}`; op: NumericOp; value: number }
  | { field: `trait.${string}`; op: 'between'; min: number; max: number }
  | { field: `global_score.${string}`; op: NumericOp; value: number }
  | { field: `global_score.${string}`; op: 'between'; min: number; max: number };

/** AND-composed list of filter clauses */
export type FilterQuery = FilterClause[];

/**
 * One field in the bulk delta.
 * mode 'set'   → overwrite with exact value
 * mode 'nudge' → add signed value to current (clamped after application)
 */
export interface BulkDeltaField {
  mode:  'set' | 'nudge';
  value: number;
}

/**
 * Request body for POST /api/god-mode/bulk
 *
 * `delta` keys are person field names (e.g. "health", "wealth") or dotted
 * trait paths (e.g. "trait.charisma"). String demographic fields only accept
 * mode 'set' and the value is ignored — use a separate string field instead.
 *
 * Numeric stats (health, etc.) are clamped 0-100 after application.
 * Wealth is unclamped. Trait values are clamped 0-100.
 */
export interface BulkActionRequest {
  filters:          FilterQuery;
  delta:            Record<string, BulkDeltaField>;
  event_summary:    string;
  emotional_impact: EmotionalImpact;
  /** Optional Chronicler voice override; defaults to reportage for bulk actions. */
  tone?:            Tone;
}

/** Response shape for POST /api/god-mode/bulk */
export interface BulkActionResult {
  matched:                number;
  affected:               number;
  memory_entries_created: number;
}
