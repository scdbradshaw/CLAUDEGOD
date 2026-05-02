// Real-person annual income (Phase 10 — DESIGN.md §6.1).
//
// Per-type flat income rate × global event modifiers. The bucket layer is
// already on this curve (Phase 4 income.ts); this module mirrors it for
// real persons.
//
// Modifiers (§6.1):
//   War     → -30% non-Soldier
//   Plague  → -50% all
//   Famine  → -70% Farmer
//   Drought → -40% Farmer + Laborer
//   Boom    → +30% Merchant + Artisan + Noble  (boom = market_index ≥ 1.6)
//
// Multipliers compose multiplicatively. Floors at 0.

import type { PersonType } from '@claude-god/shared';
import { TYPE_INCOME_BASES } from '../income-rates';
import type { ActiveEventTags, RealPersonForEconomy } from './types';

export interface RealIncomeResult {
  /** Per-person new wealth (post-income, pre-investment, pre-dues). */
  updates: Array<{ person_id: string; wealth: number }>;
  /** Diagnostic — total gross income added across all real persons. */
  total_gross: number;
}

export function applyRealPersonIncome(
  persons: Array<Pick<RealPersonForEconomy, 'id' | 'type' | 'wealth'>>,
  events: ActiveEventTags,
): RealIncomeResult {
  const updates: RealIncomeResult['updates'] = [];
  let totalGross = 0;
  for (const p of persons) {
    const base = TYPE_INCOME_BASES[p.type];
    const mult = incomeMultiplierFor(p.type, events);
    const gross = Math.max(0, Math.round(base * mult));
    totalGross += gross;
    updates.push({ person_id: p.id, wealth: p.wealth + gross });
  }
  return { updates, total_gross: totalGross };
}

export function incomeMultiplierFor(type: PersonType, e: ActiveEventTags): number {
  let mult = 1;
  if (e.war && type !== 'Soldier') mult *= 0.7;
  if (e.plague) mult *= 0.5;
  if (e.famine && type === 'Farmer') mult *= 0.3;
  if (e.drought && (type === 'Farmer' || type === 'Laborer')) mult *= 0.6;
  if (e.boom && (type === 'Merchant' || type === 'Artisan' || type === 'Noble')) {
    mult *= 1.3;
  }
  return mult;
}
