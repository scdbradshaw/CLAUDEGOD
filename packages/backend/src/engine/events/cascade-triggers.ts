// Phase 8 — Cascade trigger evaluation (DESIGN.md §9.3).
//
// Reads the 3-year `state_history` ring buffer plus the latest snapshot and
// returns the set of cascade fires that should be considered this year. Each
// fire carries a CascadeKey which the caller pairs with the per-(world, key)
// 10y cooldown to decide whether to actually drop the event.
//
// Pure: no DB. Cooldown lookup is a pre-built map from caller (last-fire year
// per CascadeKey for this world).

import type {
  CascadeKey,
  EventType,
  WorldStateSnapshot,
} from '@claude-god/shared';
import {
  CASCADE_COOLDOWN_YEARS,
  CASCADE_FOOD_RATIO_FLOOR,
  CASCADE_FOOD_RATIO_HARD_FLOOR,
  CASCADE_FOOD_RATIO_WINDOW,
  CASCADE_HAPPINESS_FLOOR,
  CASCADE_HAPPINESS_WINDOW,
  CASCADE_HEALTH_FLOOR,
  CASCADE_MARKET_FLOOR,
  CASCADE_MARKET_WINDOW,
} from '@claude-god/shared';
import type { Rng } from '../../lib/rng';

export interface CascadeFire {
  key: CascadeKey;
  event_def_id: EventType;
  /** City this should attach to (city-scoped fires). Undefined for global. */
  city_id?: string;
  /** Human-readable reason for logs. */
  reason: string;
}

export interface CascadeEvalInput {
  /** Current year being evaluated. The caller pushes the *new* snapshot before
   *  evaluating, so `history[history.length-1].year === current_year`. */
  current_year: number;
  /** Ring buffer of recent snapshots (cap 3). */
  state_history: WorldStateSnapshot[];
  /** Last-fired year for each cascade key in this world. Missing key = never. */
  cooldowns: Partial<Record<CascadeKey, number>>;
  /** PRNG for plague-risk roll. */
  rng: Rng;
}

/** Probability of a Plague firing each year a city is below health floor. */
const PLAGUE_RISK_PCT = 0.25;

export function evaluateCascades(input: CascadeEvalInput): CascadeFire[] {
  const fires: CascadeFire[] = [];
  const { current_year, state_history, cooldowns } = input;
  if (state_history.length === 0) return fires;
  const latest = state_history[state_history.length - 1];

  const onCooldown = (key: CascadeKey): boolean => {
    const last = cooldowns[key];
    return last !== undefined && current_year - last < CASCADE_COOLDOWN_YEARS;
  };

  // ── 1. happiness < 30 for 3y → CityRevolt (worst-mood city) ───────────────
  if (!onCooldown('happiness-revolt') && state_history.length >= CASCADE_HAPPINESS_WINDOW) {
    const window = state_history.slice(-CASCADE_HAPPINESS_WINDOW);
    // For each city present in latest snapshot, check happiness across window.
    let worstCity: { id: string; avg: number } | null = null;
    for (const cityId of Object.keys(latest.cities)) {
      let allBelow = true;
      let sum = 0;
      let count = 0;
      for (const snap of window) {
        const c = snap.cities[cityId];
        if (!c) {
          allBelow = false;
          break;
        }
        if (c.avg_happiness >= CASCADE_HAPPINESS_FLOOR) {
          allBelow = false;
          break;
        }
        sum += c.avg_happiness;
        count += 1;
      }
      if (allBelow && count > 0) {
        const avg = sum / count;
        if (!worstCity || avg < worstCity.avg) worstCity = { id: cityId, avg };
      }
    }
    if (worstCity) {
      fires.push({
        key: 'happiness-revolt',
        event_def_id: 'CityRevolt',
        city_id: worstCity.id,
        reason: `avg_happiness < ${CASCADE_HAPPINESS_FLOOR} for ${CASCADE_HAPPINESS_WINDOW}y`,
      });
    }
  }

  // ── 2. market_index < 0.3 for 3y → GreatCrash (global) ────────────────────
  if (!onCooldown('crash') && state_history.length >= CASCADE_MARKET_WINDOW) {
    const window = state_history.slice(-CASCADE_MARKET_WINDOW);
    if (window.every((s) => s.market_index < CASCADE_MARKET_FLOOR)) {
      fires.push({
        key: 'crash',
        event_def_id: 'GreatCrash',
        reason: `market_index < ${CASCADE_MARKET_FLOOR} for ${CASCADE_MARKET_WINDOW}y`,
      });
    }
  }

  // ── 3. World food_ratio < FLOOR for 2y, or < HARD_FLOOR once → Famine ─────
  // Replaces the Phase-9 farmer-count heuristic — the food_ratio computed in
  // the §6.4 v2 stock-market signals is the true scarcity measure (it folds
  // in event modifiers and region bonuses). Falls back to the oldest farmer-
  // drop heuristic when food_ratio is missing (legacy snapshots).
  if (!onCooldown('farmer-collapse')) {
    const cityForFamine = (): string | undefined =>
      Object.keys(latest.cities)[0]; // v1 single-city — attach to first city.

    const latestRatio = latest.food_ratio;
    if (latestRatio !== undefined && latestRatio < CASCADE_FOOD_RATIO_HARD_FLOOR) {
      fires.push({
        key: 'farmer-collapse',
        event_def_id: 'Famine',
        city_id: cityForFamine(),
        reason: `food_ratio ${latestRatio.toFixed(2)} < ${CASCADE_FOOD_RATIO_HARD_FLOOR}`,
      });
    } else if (state_history.length >= CASCADE_FOOD_RATIO_WINDOW) {
      const window = state_history.slice(-CASCADE_FOOD_RATIO_WINDOW);
      const allHaveRatio = window.every((s) => s.food_ratio !== undefined);
      if (
        allHaveRatio &&
        window.every((s) => (s.food_ratio as number) < CASCADE_FOOD_RATIO_FLOOR)
      ) {
        fires.push({
          key: 'farmer-collapse',
          event_def_id: 'Famine',
          city_id: cityForFamine(),
          reason: `food_ratio < ${CASCADE_FOOD_RATIO_FLOOR} for ${CASCADE_FOOD_RATIO_WINDOW}y`,
        });
      }
    }
  }

  // ── 4. bucket avg_health < 40 in city → Plague risk roll ──────────────────
  if (!onCooldown('plague-risk')) {
    for (const cityId of Object.keys(latest.cities)) {
      const c = latest.cities[cityId];
      if (c.avg_health < CASCADE_HEALTH_FLOOR && input.rng.next() < PLAGUE_RISK_PCT) {
        fires.push({
          key: 'plague-risk',
          event_def_id: 'Plague',
          city_id: cityId,
          reason: `avg_health < ${CASCADE_HEALTH_FLOOR} (rolled risk)`,
        });
        break; // one Plague per evaluation
      }
    }
  }

  // ── 5. faction-share swing >50% in <5y → ReligiousSchism ──────────────────
  // Note: requires per-religion share history, which we don't snapshot in
  // state_history (kept lean). The Phase 7 group lifecycle already detects
  // schism candidates via tag-cluster analysis and stamps `last_schism_year`.
  // Phase 8 will not duplicate that detector here — leaving this branch as a
  // documented no-op until v2 expands the snapshot. The Phase 7 schism path
  // remains the canonical trigger.

  return fires;
}
