// Bucket income + city tax (Phase 4 — DESIGN.md §6.3).
//
// Per-bucket: gross_income = count × type_income × (1 + jitter)
// Tax skim:   tax = gross × tax_rate / 100        → city.treasury
// Net:        bucket_total_wealth += gross − tax  → divided back to avg_wealth.
//
// `avg_wealth` is an Int per Prisma; we operate on `count × avg_wealth` as
// the canonical total, then round back. This avoids the rounding drift you
// get when applying small per-capita gains to an integer column.

import type { Rng } from '../../lib/rng';
import { TYPE_INCOME_BASES, INCOME_JITTER } from '../income-rates';
import type { BucketState, CityState } from './types';

export interface IncomeStepResult {
  buckets: BucketState[];
  city: CityState;
  /** Diagnostic — total gross income produced this step. */
  gross_added: number;
  /** Diagnostic — total tax skimmed. */
  tax_collected: number;
}

/**
 * Apply per-bucket gross income, skim tax to city treasury, leave the rest
 * in the bucket as added avg_wealth. Pure: no inputs mutated.
 */
export function applyIncomeAndTax(
  buckets: BucketState[],
  city: CityState,
  rng: Rng,
): IncomeStepResult {
  const taxRate = clamp(city.tax_rate, 0, 50) / 100;
  let grossAdded = 0;
  let taxCollected = 0;

  const next: BucketState[] = buckets.map((b) => {
    if (b.count <= 0) return { ...b };
    const baseRate = TYPE_INCOME_BASES[b.type];
    const jitter = 1 + (rng.next() * 2 - 1) * INCOME_JITTER;
    const gross = b.count * baseRate * jitter;
    const tax = gross * taxRate;
    const net = gross - tax;

    grossAdded += gross;
    taxCollected += tax;

    const totalWealth = b.count * b.avg_wealth + net;
    const newAvgWealth = Math.max(0, Math.round(totalWealth / b.count));
    return { ...b, avg_wealth: newAvgWealth };
  });

  return {
    buckets: next,
    city: { ...city, treasury: Math.round(city.treasury + taxCollected) },
    gross_added: grossAdded,
    tax_collected: taxCollected,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
