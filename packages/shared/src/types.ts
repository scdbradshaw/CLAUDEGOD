// ============================================================
// SHARED TYPES — used by both backend and frontend
// ============================================================

// --------------- Trait system ---------------

/** All 25 categories, each with exactly 4 traits (100 total) */
export const TRAIT_CATEGORIES = {
  physical_vitality:    ['strength', 'endurance', 'immunity', 'pain_tolerance'],
  combat:               ['aggression', 'combat_skill', 'tactical_mind', 'weapon_affinity'],
  hunting_tracking:     ['tracking', 'stealth', 'patience', 'prey_instinct'],
  survival_craft:       ['foraging', 'fire_mastery', 'tool_making', 'shelter_building'],
  senses_perception:    ['awareness', 'night_vision', 'danger_sense', 'pattern_recognition'],
  endurance_grit:       ['hunger_tolerance', 'thirst_tolerance', 'cold_tolerance', 'sleep_deprivation_resistance'],
  speed_agility:        ['reflexes', 'agility', 'stamina', 'escape_instinct'],
  healing_medicine:     ['wound_recovery', 'disease_resistance', 'medical_knowledge', 'poison_tolerance'],
  navigation_territory: ['wayfinding', 'map_memory', 'territory_sense', 'weather_reading'],
  resource_management:  ['stockpiling', 'rationing', 'scarcity_memory', 'waste_aversion'],
  threat_assessment:    ['predator_awareness', 'human_threat_reading', 'ambush_sense', 'risk_calculation'],
  adaptation:           ['environmental_flexibility', 'diet_flexibility', 'climate_tolerance', 'skill_acquisition_speed'],
  mental_fortitude:     ['despair_resistance', 'isolation_tolerance', 'trauma_recovery', 'fear_management'],
  instinct:             ['fight_or_flight', 'gut_accuracy', 'herd_instinct', 'survival_drive'],
  social_survival:      ['alliance_building', 'loyalty', 'betrayal_detection', 'group_navigation'],
  leadership:           ['command_presence', 'decision_speed', 'sacrifice_willingness', 'group_cohesion'],
  deception_evasion:    ['lying_ability', 'concealment', 'identity_masking', 'misdirection'],
  dominance_submission: ['dominance_drive', 'submission_threshold', 'territory_aggression', 'status_reading'],
  reproduction_legacy:  ['fertility', 'mate_selection', 'offspring_investment', 'bloodline_pride'],
  wealth_trade:         ['accumulation_drive', 'negotiation', 'barter_skill', 'debt_tolerance'],
  violence_morality:    ['killing_threshold', 'cruelty', 'mercy', 'vengefulness'],
  risk_courage:         ['risk_tolerance', 'courage_under_threat', 'recklessness', 'boldness'],
  identity_pressure:    ['shame_threshold', 'dignity_retention', 'self_preservation_vs_principle', 'breaking_point'],
  culture_meaning:      ['ritual_importance', 'oral_tradition', 'music', 'myth_making'],
  philosophy:           ['death_acceptance', 'nihilism', 'justice_belief', 'destiny_belief'],
} as const;

export type TraitCategoryKey = keyof typeof TRAIT_CATEGORIES;

/** The 5 categories active by default */
export const DEFAULT_ACTIVE_CATEGORIES: TraitCategoryKey[] = [
  'violence_morality',
  'mental_fortitude',
  'identity_pressure',
  'social_survival',
  'philosophy',
];

/** Flat map of all 100 trait keys → values */
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
}

export interface OutcomeBand {
  label:            string;
  /** score must be >= this to qualify (ordered highest → lowest) */
  min_score:        number;
  /** [min, max] applied to affected stats — negative for bad outcomes */
  stat_delta:       [number, number];
  /** which core stats can be modified */
  affects_stats:    string[];
  can_die:          boolean;
  creates_memory:   boolean;
  creates_headline: boolean;
}

export interface RulesetDef {
  version:           number;
  interaction_types: InteractionTypeDef[];
  /** ordered highest min_score → lowest — first match wins */
  outcome_bands:     OutcomeBand[];
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

// --------------- Deceased person ---------------

export interface DeceasedPerson {
  id:                    string;
  name:                  string;
  age_at_death:          number;
  world_year:            number;
  cause:                 string;
  final_health:          number;
  final_wealth:          number;
  final_happiness:       number;
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
  age:                 number;   // years (int)
  lifespan:            number;   // expected max age (int)

  // ── Social ───────────────────────────────────────────────
  relationship_status: string;
  religion:            string;
  criminal_record:     CriminalRecord[];

  // ── Stats (0 – 100) ──────────────────────────────────────
  health:              number;
  morality:            number;
  happiness:           number;
  reputation:          number;
  influence:           number;
  intelligence:        number;

  // ── Other ────────────────────────────────────────────────
  physical_appearance: string;
  wealth:              number;   // float, no upper bound
  traits:              TraitSet; // all 100 survival/philosophy traits (0-100)
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
  timestamp:        string;   // ISO-8601
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
  happiness:     number;
  wealth:        number;
  updated_at:    string;
  global_scores: Record<string, number>;
}

export interface PaginatedResponse<T> {
  data:  T[];
  total: number;
  page:  number;
  limit: number;
}
