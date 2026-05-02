// Civic defense rating (role-power: working class + soldier defend the city).
//
// Per the role-power spec, working-class people contribute a small share of
// civic defense (logistics, walls, militia conscription) while Soldiers are
// the primary contributors. Output is a flat per-type fraction of population
// summed and clamped to [0, DEFENSE_RATING_MAX].
//
// This recomputes city.defense_rating each year from current populations —
// it is a derived snapshot, not a stateful counter.

import type { PersonType } from '@claude-god/shared';

/** Per-type contribution to defense_rating per capita. Soldier dominates. */
export const DEFENSE_PER_CAPITA: Partial<Record<PersonType, number>> = {
  Farmer: 0.002,
  Laborer: 0.003,
  Artisan: 0.005,
  Soldier: 0.02,
};

export const DEFENSE_RATING_MAX = 100;
export const DEFENSE_RATING_MIN = 0;

/** Total persons of one type, across the bucket aggregate + real persons. */
export interface DefensePopulation {
  type: PersonType;
  total_count: number;
}

/** Compute the city's new defense_rating from per-type populations. */
export function computeDefenseRating(populations: DefensePopulation[]): number {
  let raw = 0;
  for (const p of populations) {
    const factor = DEFENSE_PER_CAPITA[p.type];
    if (!factor) continue;
    raw += p.total_count * factor;
  }
  const rounded = Math.round(raw);
  if (rounded < DEFENSE_RATING_MIN) return DEFENSE_RATING_MIN;
  if (rounded > DEFENSE_RATING_MAX) return DEFENSE_RATING_MAX;
  return rounded;
}
