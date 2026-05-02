// CLAUDE GOD — shared constants.
//
// Canonical numeric constants from DESIGN.md. Backend MUST import from here
// rather than hardcoding values. If a number changes, change it once here.

import type { StateTag } from './types';

// ─── Real-person cap & churn ─────────────────────────────────────────────────
export const REAL_PERSON_CAP = 6000;
export const ENGINE_CHURN_RATE = 0.02; // 2% target promotions/demotions per year
export const DEMOTION_GRACE_YEARS = 5;

// ─── World seeding & limits ──────────────────────────────────────────────────
export const CITY_SEED_COUNT = 1; // v1: single-city. v2 raises to 5.
export const CITY_HARD_CAP = 15;
export const EVENT_ACTIVE_CAP = 6;
export const CASCADE_COOLDOWN_YEARS = 10;

// ─── Births / memory / bonds ─────────────────────────────────────────────────
export const PREGNANCY_DURATION_YEARS = 1;
export const MEMORY_BUFFER_CAP = 10;
export const DECLARED_BONDS_CAP = 5;

// ─── Tags ────────────────────────────────────────────────────────────────────
export const PERSONALITY_TAG_MIN = 1;
export const PERSONALITY_TAG_MAX = 3;
export const STATE_TAG_MAX = 5;

// ─── Faction / war ───────────────────────────────────────────────────────────
export const WAR_FALLBACK_TIMER_YEARS = 20;
export const FACTION_TAKEOVER_WEALTH_YEARS = 5;
export const FACTION_TAKEOVER_POPULATION_THRESHOLD = 2 / 3;

// ─── Interactions (§15.4) ────────────────────────────────────────────────────
export const INTERACTION_VOLUME_FACTOR = 0.001; // K = N² × factor
export const INTERACTION_VOLUME_CAP = 100;
/** Phase 13a — per-actor / per-target interaction caps each year. */
export const INTERACTION_OUTGOING_CAP = 3;
export const INTERACTION_INCOMING_CAP = 3;
/** Gift transfer is min(actor.wealth × pct, INTERACTION_GIFT_CAP). */
export const INTERACTION_GIFT_PCT = 0.05;
export const INTERACTION_GIFT_CAP = 200;

// ─── Inheritance (§7.4) ──────────────────────────────────────────────────────
export const INHERITANCE_SPOUSE_SHARE = 0.5;
export const WINDFALL_THRESHOLD_MULTIPLIER = 5; // heir wealth > 5× city avg → windfall tag

// ─── Group lifecycle ─────────────────────────────────────────────────────────
export const GROUP_DISSOLUTION_MIN_MEMBERS = 10;
export const GROUP_DISSOLUTION_GRACE_YEARS = 1;
export const GROUP_SCHISM_MIN_MEMBERS = 100;
export const GROUP_SCHISM_CLUSTER_MIN_SIZE = 30;
/** Engine-formed groups capped at this many of each kind per world per year.
 *  God-mode summons are exempt. */
export const GROUP_PER_YEAR_CAP = 3;
/** On creation, seed the group with this many aggregate (bucket) members
 *  drawn from the founding city. Applies to all creation paths. */
export const GROUP_SEED_AGGREGATE_MEMBERS = 10;

// ─── Religion (§8.3) ─────────────────────────────────────────────────────────
/** Per-year share drift for bucket religion_shares. Slower than factions
 *  (FACTION_BUCKET_DRIFT_RATE = 0.05) so word-of-mouth dominates. */
export const RELIGION_BUCKET_DRIFT_RATE = 0.01;
/** Default % of member wealth charged as religion dues. */
export const RELIGION_DEFAULT_COST_PCT = 0.10;
/** Per-tag conversion roll on a friendly/romantic talk. */
export const RELIGION_TALK_PER_TAG_CHANCE = 0.25;
/** Consecutive years with zero matching tags before auto-leave. */
export const RELIGION_UNMATCHED_GRACE_YEARS = 5;
/** Same mechanic for factions — kept symmetric for now; tune independently
 *  later if the competition mechanic warrants harsher / gentler turnover. */
export const FACTION_UNMATCHED_GRACE_YEARS = 5;
/** Hard cap on a religion's wanted_tags slot count (matches PERSONALITY_TAG_MAX
 *  for factions; religions get more slots since they appeal to broader sets). */
export const RELIGION_WANTED_TAGS_MAX = 6;
/** Donation tiers — fraction of donor.wealth gifted to religion treasury. */
export const RELIGION_DONATE_TIER_LOW = 0.01;   // happiness 0–33
export const RELIGION_DONATE_TIER_MID = 0.05;   // happiness 34–66
export const RELIGION_DONATE_TIER_HIGH = 0.10;  // happiness 67–100
/** Donation also bumps donor happiness by this much. */
export const RELIGION_DONATE_HAPPINESS_BUMP = 5;

// ─── Decade compression ──────────────────────────────────────────────────────
export const DECADE_COMPRESSION_INTERVAL = 10;

// ─── Until-event year cap ────────────────────────────────────────────────────
export const UNTIL_EVENT_HARD_CAP_YEARS = 50;

// ─── Events / cascades (§9.3) ────────────────────────────────────────────────
/** World.state_history ring-buffer size. Cascade triggers need a 3y window. */
export const STATE_HISTORY_CAP = 3;
/** §9.3 — happiness < 30 for 3y → CityRevolt. */
export const CASCADE_HAPPINESS_FLOOR = 30;
export const CASCADE_HAPPINESS_WINDOW = 3;
/** §9.3 — market_index < 0.3 for 3y → GreatCrash. */
export const CASCADE_MARKET_FLOOR = 0.3;
export const CASCADE_MARKET_WINDOW = 3;
/** §9.3 — bucket avg_health < 40 in city → Plague risk. */
export const CASCADE_HEALTH_FLOOR = 40;
/** Replaces CASCADE_FARMER_DROP_PCT — Famine fires when world food_ratio
 *  drops below this for two consecutive years (or below half this once). */
export const CASCADE_FOOD_RATIO_FLOOR = 0.7;
export const CASCADE_FOOD_RATIO_WINDOW = 2;
export const CASCADE_FOOD_RATIO_HARD_FLOOR = 0.5;
/** §9.4 — Plague auto-clear when infected_pct < this. */
export const PLAGUE_CLEAR_PCT = 0.05;
/** §9.4 — GreatCrash auto-clear when market_index ≥ this. */
export const CRASH_RECOVER_INDEX = 0.6;
/** §9.4 — FactionWar fallback timer (when not ended by army=0 or peace). */
export const FACTION_WAR_FALLBACK_YEARS = 20;

// ─── Agentic actions (§11) ───────────────────────────────────────────────────
/** §11.3 — base per-year chance an alive real person tries an action. */
export const AGENTIC_BASE_CHANCE = 0.10;
/** §11.3 — floor / ceiling clamps after tag/age/state modifiers. */
export const AGENTIC_CHANCE_FLOOR = 0.05;
export const AGENTIC_CHANCE_CEILING = 0.50;
/** §11.2 — total weight below this → passive year (no action). */
export const AGENTIC_TOTAL_WEIGHT_THRESHOLD = 1.0;
/** §11.1 gift — pct of actor wealth transferred to target. */
export const GIFT_PCT_MIN = 0.01;
export const GIFT_PCT_MAX = 0.10;
/** §11.5 — murder resolution. Loser takes this much current_health damage
 * (always lethal — death pipeline runs after). Winner picked by combat
 * differential; ties = both die. */
export const MURDER_LETHAL_DAMAGE = 9999;
/** §11.1 found-group — minimum age + treasury-seed drawn from actor wealth. */
export const FOUND_GROUP_MIN_AGE = 30;
export const FOUND_GROUP_TREASURY_SEED = 2500;
/** §11.1 found-group — minimum intelligence to bother. Filters out the
 *  "super mid" founders so only credible players form groups. */
export const FOUND_GROUP_MIN_INTELLIGENCE = 60;

// ─── Faction competition ─────────────────────────────────────────────────────
/** Default fraction of each year's faction dues skimmed by the leader. */
export const FACTION_LEADER_DUES_CUT_DEFAULT = 0.10;
/** Default prize shares for ranks 1–3 (fractions of yearly dues `T`). */
export const FACTION_PRIZE_SHARES_DEFAULT: readonly number[] = [0.15, 0.08, 0.04];
/** Default flat per-member dues for an agentic-founded faction. */
export const FACTION_DEFAULT_COST_PER_YEAR = 50;
/** Minimum tenure before a real member is eligible for a prize (anti-snipe). */
export const FACTION_PRIZE_TENURE_FLOOR_YEARS = 1;
/** v1 metric for ranking faction members. Composite hooks into the same
 *  enum-shaped column for forward-compat without migration. */
export const FACTION_COMPETITION_METRIC_DEFAULT = 'income';

// ─── Economy flows (§6.3) ────────────────────────────────────────────────────
/** §6.3 theft — Outlaw bucket extracts this fraction of each richer same-city
 * bucket's total wealth per year. The full stolen amount is moved to the
 * Outlaw bucket (no void / loss split). */
export const OUTLAW_THEFT_RATE = 0.02;
/** §6.3 trade — per-Merchant fraction of cross-city wealth differential
 * routed each year. v1 is single-city so this is wired-in only. */
export const MERCHANT_TRADE_RATE = 0.01;
/** §6.3 dues — consecutive missed-payment years before a member is kicked
 * from the group (real persons only; bucket members are not kicked). */
export const DUES_KICK_AFTER_MISSES = 3;

// ─── Stock market — class-driven signals (§6.4 v2) ───────────────────────────
// market_index drift each year is the sum of four lower-class output signals
// plus a small residual noise floor. All numbers tunable; buckets sum to a
// roughly normal-distributed delta around 0 for a balanced economy.

/** One Farmer feeds this many mouths in a normal year (before region/event mods). */
export const FARMER_FOOD_PER_HEAD = 1.5;
/** World food demand = world_population × this. 1.0 = one ration per person. */
export const FOOD_PER_CAPITA = 1.0;
/** Linear coefficient on (food_ratio - 1) before clamping. */
export const FOOD_WEIGHT = 0.6;
/** Asymmetric clamps — starvation hurts harder than surplus rewards. */
export const FOOD_MAX_BOOST = 0.15;
export const FOOD_MAX_DRAG = 0.30;

/** Laborer / (Farmer+Artisan) ratio — piecewise band thresholds. */
export const LABOR_RATIO_BOTTLENECK = 0.20;
export const LABOR_RATIO_LOW = 0.35;
export const LABOR_RATIO_HIGH = 0.65;
export const LABOR_RATIO_OVERFULL = 1.00;
/** Δ values for each labor band. */
export const LABOR_DELTA_BOTTLENECK = -0.04;
export const LABOR_DELTA_LOW = -0.01;
export const LABOR_DELTA_HEALTHY = 0.02;
export const LABOR_DELTA_HIGH = 0.01;

/** Artisan count / world population — target share to hit "1.0" signal. */
export const ARTISAN_TARGET_SHARE = 0.10;
/** Artisan avg_wealth / world avg_wealth — target ratio to hit "1.0" signal. */
export const ARTISAN_TARGET_WEALTH_RATIO = 1.6;
/** Linear coefficient on (craft_signal - 1) before clamping. */
export const CRAFT_WEIGHT = 0.10;
export const CRAFT_MAX_BOOST = 0.05;
export const CRAFT_MAX_DRAG = 0.05;

/** Merchant share floor — below this, no capital flows. */
export const MERCHANT_SHARE_FLOOR = 0.03;
export const MERCHANT_DELTA_FLOOR = -0.02;
/** Merchant wealth concentration: wealth_share / count_share.
 *  Healthy band: merchants are about 1.5–3.5× wealthier than average. */
export const MERCHANT_IMBALANCE_HEALTHY_LOW = 1.5;
export const MERCHANT_IMBALANCE_HEALTHY_HIGH = 3.5;
export const MERCHANT_DELTA_HEALTHY = 0.02;
/** Bubble: imbalance > this AND food signal < 0 → drag (hollow boom). */
export const MERCHANT_IMBALANCE_BUBBLE = 5.0;
export const MERCHANT_DELTA_BUBBLE = -0.06;

/** Residual noise applied to the market each year — ±this magnitude. */
export const MARKET_NOISE_HALF = 0.025;

/** Per-city region_resource modifier on producing classes. Multipliers,
 *  not deltas — so 1.0 is neutral. Coast/crossroads are neutral in v1. */
export const REGION_PRODUCTION_BONUS: Record<
  'farmland' | 'coast' | 'mountains' | 'forest' | 'desert' | 'crossroads',
  { farmer: number; laborer: number; artisan: number }
> = {
  farmland:   { farmer: 1.30, laborer: 1.00, artisan: 1.00 },
  forest:     { farmer: 1.00, laborer: 1.20, artisan: 1.00 },
  mountains:  { farmer: 0.85, laborer: 1.00, artisan: 1.20 },
  coast:      { farmer: 1.00, laborer: 1.00, artisan: 1.00 },
  crossroads: { farmer: 1.00, laborer: 1.00, artisan: 1.00 },
  desert:     { farmer: 0.70, laborer: 0.90, artisan: 1.00 },
};

/** Event-driven food-output multipliers, composed with region modifiers. */
export const FOOD_EVENT_MOD_BOUNTY = 1.4;
export const FOOD_EVENT_MOD_DROUGHT = 0.6;
export const FOOD_EVENT_MOD_FAMINE = 0.3;

// ─── State-tag durations (years). Boolean carriers; expire after duration. ───
// Per §5.2. Duration in years from `set_year`.
export const STATE_TAG_DURATIONS: Record<StateTag, number> = {
  grieving: 5,
  traumatized: 10,
  'wedded-recently': 2,
  ruined: 7,
  windfall: 3,
  'battle-veteran': 15,
  famous: 5,
  infamous: 10,
};
