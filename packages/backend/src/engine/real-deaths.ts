// Real-person death roll (Phase 5 — DESIGN.md §7.3).
//
//   death_chance = base(age) + (1 − current_health/100) × 0.1 + event_bonus
//
// Phase 5 ignores `event_bonus` (events arrive in Phase 8). The base curve
// is a smooth ramp anchored on:
//   age 20 → ~0.5%/yr   age 40 → ~1%/yr   age 60 → ~3%/yr
//   age 75 → ~10%/yr    age 90 → ~50%/yr
//
// Pure: returns `{ deaths, survivors }`. No DB.

import type { DeathCause } from '@claude-god/shared';
import type { Rng } from '../lib/rng';

/** Slim subset of Person the death roll needs. */
export interface DeathRollPerson {
  id: string;
  age: number;
  current_health: number;
}

export interface DeathRollResult {
  /** Persons who died this year, with cause assigned. */
  deaths: { id: string; cause: DeathCause }[];
  /** IDs of persons who survived. */
  survivor_ids: string[];
}

/** Smooth age-mortality curve. Returns annual base chance ∈ [0, 1). */
export function baseAgeChance(age: number): number {
  if (age <= 0) return 0;
  // Gompertz-ish: doubles roughly every ~8 years past 30.
  // Tuned by hand to land on the anchor points above.
  const A = 0.0008; // base
  const B = 0.085;  // slope
  return Math.min(0.95, A * Math.exp(B * Math.max(0, age - 20)));
}

export function deathChance(age: number, health: number): number {
  const healthDeficit = 1 - clamp01(health / 100);
  return clamp01(baseAgeChance(age) + healthDeficit * 0.1);
}

export function rollRealDeaths(persons: DeathRollPerson[], rng: Rng): DeathRollResult {
  const deaths: { id: string; cause: DeathCause }[] = [];
  const survivors: string[] = [];
  for (const p of persons) {
    const chance = deathChance(p.age, p.current_health);
    if (rng.next() < chance) {
      deaths.push({ id: p.id, cause: causeFor(p) });
    } else {
      survivors.push(p.id);
    }
  }
  return { deaths, survivor_ids: survivors };
}

function causeFor(p: DeathRollPerson): DeathCause {
  // Phase 5: no events / interactions yet — old_age vs health.
  if (p.current_health < 40) return 'health';
  if (p.age >= 70) return 'old_age';
  // Younger w/ ok health that still rolls is "accident".
  return 'accident';
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
