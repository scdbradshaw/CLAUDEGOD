// Per-type base income rates (Phase 4).
//
// Per DESIGN.md §6.1: flat per-type income with global event modifiers.
// Region biases population at world-gen but not income flow, so income
// rates are city-agnostic.
//
// Numbers chosen to roughly match starting `avg_wealth` magnitudes from
// `world.service.ts::TYPE_STAT_BASES` so wealth grows on a reasonable curve.
// Merchants and Nobles dominate income flow per DESIGN.md role powers:
// Merchants are the primary money-makers; Nobles also receive a 20% city
// tax-revenue dividend on top of their base income (see noble-dividend.ts).

import type { PersonType } from '@claude-god/shared';

/** Annual gross income per capita, before tax and market returns. */
export const TYPE_INCOME_BASES: Record<PersonType, number> = {
  Farmer:   5,
  Laborer:  7,
  Artisan:  14,
  Merchant: 30,
  Soldier:  10,
  Priest:   6,
  Scholar:  9,
  Noble:    50,
  Outlaw:   8,
  Healer:   13,
};

/**
 * Income jitter factor (±). Each year per-bucket gross income is multiplied
 * by `1 + uniform(-INCOME_JITTER, +INCOME_JITTER)` so wealth growth varies
 * year-to-year even without events.
 */
export const INCOME_JITTER = 0.05;
