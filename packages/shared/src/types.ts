// CLAUDE GOD — shared types.
//
// Canonical wire/storage types from DESIGN.md. These are the single source of
// truth for cross-package shapes. Prisma enums must mirror the unions below;
// the phase-1 roundtrip test guards parity.

// ─── Enums (string-literal unions) ───────────────────────────────────────────

/** §4.2 — 10 NPC types */
export const PERSON_TYPES = [
  'Farmer',
  'Laborer',
  'Artisan',
  'Merchant',
  'Soldier',
  'Priest',
  'Scholar',
  'Noble',
  'Outlaw',
  'Healer',
] as const;
export type PersonType = (typeof PERSON_TYPES)[number];

/** §14.1 — 10 races. Mixed = `${race_a}-${race_b}` (alphabetical). */
export const RACES = [
  'Caucasian',
  'African American',
  'East Asian',
  'South Asian',
  'Southeast Asian',
  'Hispanic/Latino',
  'Native American',
  'Middle Eastern',
  'Indigenous Australian',
  'Polynesian',
] as const;
export type Race = (typeof RACES)[number];
export type MixedRace = `${Race}-${Race}`;
export type AnyRace = Race | MixedRace;

/** §5.1 — 16 personality tags (1–3 per person). */
export const PERSONALITY_TAGS = [
  'ambitious',
  'cruel',
  'kind',
  'greedy',
  'loyal',
  'vengeful',
  'charismatic',
  'faithful',
  'cunning',
  'stoic',
  'paranoid',
  'lazy',
  'brave',
  'reckless',
  'proud',
  'diligent',
] as const;
export type PersonalityTag = (typeof PERSONALITY_TAGS)[number];

/** §5.2 — 8 state tags (0–5 per person, decay). */
export const STATE_TAGS = [
  'grieving',
  'traumatized',
  'wedded-recently',
  'ruined',
  'windfall',
  'battle-veteran',
  'famous',
  'infamous',
] as const;
export type StateTag = (typeof STATE_TAGS)[number];

/** §3.1 — region resource enum. Biases world-gen seeding only. */
export const REGION_RESOURCES = [
  'farmland',
  'coast',
  'mountains',
  'forest',
  'desert',
  'crossroads',
] as const;
export type RegionResource = (typeof REGION_RESOURCES)[number];

/** §8.1 — Group kind discriminator. */
export const GROUP_KINDS = ['faction', 'religion'] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** §9.2 — 12 event types. */
export const EVENT_TYPES = [
  // Disasters
  'Plague',
  'Famine',
  'Fire',
  'Drought',
  // Conflicts
  'FactionWar',
  'CityRevolt',
  'Siege',
  'ReligiousSchism',
  // Booms
  'GoldenAge',
  'BountifulHarvest',
  'Discovery',
  // Catastrophe
  'GreatCrash',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** §9.4 — how an event ended. */
export const EVENT_END_REASONS = [
  'expired',
  'manual',
  'condition_met',
  'overridden',
] as const;
export type EventEndReason = (typeof EVENT_END_REASONS)[number];

/** §5.4 — memory tone (routing key for future Claude prompts). */
export const MEMORY_TONES = [
  'tabloid',
  'literary',
  'epic',
  'reportage',
  'neutral',
] as const;
export type MemoryTone = (typeof MEMORY_TONES)[number];

/** §5.5 — declared-bond kinds. */
export const RELATIONSHIP_KINDS = [
  'spouse',
  'lover',
  'rival',
  'ally',
  'nemesis',
] as const;
export type RelationshipKind = (typeof RELATIONSHIP_KINDS)[number];

/** §7.3 — death cause. */
export const DEATH_CAUSES = [
  'old_age',
  'health',
  'event',
  'interaction',
  'accident',
] as const;
export type DeathCause = (typeof DEATH_CAUSES)[number];

/** §11.1 — agentic actions. */
export const AGENTIC_ACTION_TYPES = [
  'marry',
  'murder',
  'found-group',
  'gift',
  'donate',
] as const;
export type AgenticActionType = (typeof AGENTIC_ACTION_TYPES)[number];

/** §15.4 — 4 interaction outcome types. */
export const INTERACTION_TYPES = [
  'friendly',
  'hostile',
  'romantic',
  'transactional',
] as const;
export type InteractionType = (typeof INTERACTION_TYPES)[number];

/** Phase 13a — 6 concrete interaction kinds (the player-visible verbs). */
export const INTERACTION_KINDS = [
  'chat',
  'argue',
  'gift',
  'romance',
  'betray',
  'comfort',
] as const;
export type InteractionKind = (typeof INTERACTION_KINDS)[number];

/** YearRun status. */
export const YEAR_RUN_STATUSES = [
  'pending',
  'running',
  'completed',
  'failed',
] as const;
export type YearRunStatus = (typeof YEAR_RUN_STATUSES)[number];

// ─── Mixed-race helper (§14.2) ───────────────────────────────────────────────

/**
 * Canonicalize a mixed-race pair as `${a}-${b}` with components ordered
 * alphabetically. If the two races are equal, returns the single race
 * (no self-mix). Three-way mixed handled at caller (drop lowest-share component).
 */
export function mixRaces(a: Race, b: Race): AnyRace {
  if (a === b) return a;
  return ([a, b].sort() as [Race, Race]).join('-') as MixedRace;
}

// ─── jsonb payload shapes ────────────────────────────────────────────────────

/** §5.4 — entry in Person.recent_memories (cap MEMORY_BUFFER_CAP, weight-FIFO). */
export interface Memory {
  year: number;
  kind: string;            // free-form short tag, e.g. "battle", "marriage", "betrayal"
  summary: string;         // templated text in v1; Claude rewrites later
  magnitude: number;       // 0.0–1.0, drives weight + state-tag gating
  counterparty_id?: string;
  tone: MemoryTone;
}

/** §5.2 — entry in Person.state_tags. Boolean carrier + set_year (decay anchor). */
export interface StateTagEntry {
  tag: StateTag;
  set_year: number;
}

/** §5.4 — entry in LifeDecadeSummary.ranked_memories. */
export interface RankedDecadeMemory {
  year: number;
  kind: string;
  summary: string;
  magnitude: number;
  tone: MemoryTone;
}

/** §11.4 — entry in Person.action_queue (pinned-only). */
export interface ActionQueueEntry {
  action_type: AgenticActionType;
  target_id?: string;
  params?: Record<string, unknown>;
  scheduled_year: number;
  status: 'queued' | 'fired' | 'failed' | 'skipped';
  failure_reason?: string;
}

/** §9.4 — bucket modifiers applied each year an event is active. */
export interface BucketModifier {
  type?: PersonType;       // narrow to a type, or omit for all
  income_multiplier?: number;
  mortality_delta?: number;
  happiness_delta?: number;
  birth_rate_multiplier?: number;
}

/** §9.4 — rule for naming N real-person targets per year. */
export interface RealPersonTargetRule {
  count_min: number;
  count_max: number;
  pool: { city_id?: string; type?: PersonType; faction_id?: string };
  apply: { state_tag?: StateTag; kill?: boolean; health_delta?: number };
}

/** Bucket race share map: keys are `Race` strings. */
export type RaceShares = Partial<Record<Race, number>>;

/** Bucket personality-tag freq map: all 16 keys. */
export type PersonalityTagFreqs = Record<PersonalityTag, number>;

/** Bucket state-tag freq map: only the 5 high-relevance state tags (§5.3). */
export type BucketStateTagFreqs = Partial<
  Record<'grieving' | 'traumatized' | 'ruined' | 'windfall' | 'infamous', number>
>;

/** Bucket group share map: { groupId: shareFraction }, cap 5 entries. */
export type GroupShares = Record<string, number>;

/** Group attractor config. */
export interface GroupTypeAffinities {
  [type: string]: number;  // PersonType → multiplier (e.g. Soldier: 1.5)
}
export interface GroupStatFloors {
  intelligence_min?: number;
  combat_min?: number;
  wealth_min?: number;
  age_min?: number;
}

// ─── Events catalog (§9) ─────────────────────────────────────────────────────

/** §9 — what kind of target an event scopes against. */
export const EVENT_SCOPES = ['global', 'city', 'faction'] as const;
export type EventScope = (typeof EVENT_SCOPES)[number];

/** §9.3 — cooldown bookkeeping key. Keep short + stable; reused as
 * `WorldEvent.cooldown_key` so the per-(world, key) 10y cooldown
 * can be enforced by querying archived rows. */
export const CASCADE_KEYS = [
  'happiness-revolt',
  'crash',
  'religious-schism',
  'plague-risk',
  'farmer-collapse',
] as const;
export type CascadeKey = (typeof CASCADE_KEYS)[number];

/** §9.4 — descriptor union for an event's end condition. Stored on
 * `WorldEvent.end_condition` as JSON; the engine dispatches on `kind`. */
export type EndConditionDescriptor =
  | { kind: 'duration'; years: number }
  | { kind: 'plague-clear'; clear_pct: number } // ends when infected_pct < clear_pct
  | { kind: 'war-resolved'; fallback_years: number } // army=0 OR years elapsed
  | { kind: 'siege-resolved' } // city falls or relief
  | { kind: 'crash-recovered'; threshold: number }; // market_index ≥ threshold

/** §9 — catalog row for one of the 12 EventTypes. Pure data; lives in code. */
export interface EventDef {
  id: EventType;
  scope: EventScope;
  end_condition: EndConditionDescriptor;
  /** Default `duration_years` set on WorldEvent at drop-time. Null when
   * end_condition is condition-bound (we still set a hard cap separately). */
  default_duration: number | null;
  bucket_modifiers: BucketModifier[];
  real_person_target_rules: RealPersonTargetRule[];
  /** Tone-tag emitted on headline writes for this event. */
  headline_tone: MemoryTone;
  /** Cascade key, if this event is fireable as a cascade. */
  cascade_key?: CascadeKey;
}

/** §6.4 v2 — per-year stock-market signals snapshot, written at end of each
 * year and stored on `World.market_signals_history` (cap 100). Powers the
 * Market UI page's history charts. World-aggregate; per-city breakdown is
 * deferred until v2 multi-city. */
export interface MarketSignalsEntry {
  year: number;
  /** food_produced / food_needed — same value pushed to WorldStateSnapshot. */
  food_ratio: number;
  /** The four signed contributions that summed to this year's market move. */
  delta_food: number;
  delta_labor: number;
  delta_craft: number;
  delta_capital: number;
  /** Diagnostics for the food chart. */
  food_produced: number;
  food_needed: number;
  /** Per-class population + avg wealth, world-aggregate. */
  classes: {
    farmer: { count: number; avg_wealth: number };
    laborer: { count: number; avg_wealth: number };
    artisan: { count: number; avg_wealth: number };
    merchant: { count: number; avg_wealth: number };
  };
}

/** Per-city, per-year snapshot used by the cascade-trigger window. Stored
 * on `World.state_history` (cap-3). */
export interface WorldStateSnapshot {
  year: number;
  market_index: number;
  /** World-aggregate food production / world food demand. Drives the Famine
   *  cascade trigger and is what the stock-market food signal is computed
   *  off. Optional for backward compatibility with pre-stock-market snapshots
   *  already persisted on World.state_history. */
  food_ratio?: number;
  /** city_id → snapshot fields (only what triggers need). */
  cities: Record<
    string,
    {
      avg_happiness: number;
      avg_health: number;
      farmer_count: number;
    }
  >;
}

// ─── Cap-overflow API error (§4.3) ───────────────────────────────────────────

export interface RealPersonCapErrorBody {
  error: 'real_person_cap_reached';
  current: number;
  cap: number;
}

// ─── Agentic actions (§11) ───────────────────────────────────────────────────

/** Result row for one resolved agentic action attempt. Emitted via SSE and
 * persisted in YearRun.event_log so the UI can replay a year's drama. */
export interface AgenticActionResult {
  year: number;
  source: 'queued' | 'engine';
  action_type: AgenticActionType;
  actor_id: string;
  target_id?: string;
  status: 'fired' | 'failed' | 'skipped';
  failure_reason?: string;
}
