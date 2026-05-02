// Real-person market investment (Phase 10 — DESIGN.md §6.4).
//
// Each year every real person invests `intelligence%` of wealth into the
// global market and earns:
//
//   wealth += invested × (new_index / old_index − 1)
//
// Smart people compound faster (and lose harder).
//
// Pure: returns wealth deltas. The market index drift itself is computed
// once at the bucket-dynamics layer (Phase 4 stepMarket); this module just
// applies the same ratio to real persons.

import type { RealPersonForEconomy } from './types';

export interface RealInvestmentResult {
  /** Per-person new wealth post-investment. */
  updates: Array<{ person_id: string; wealth: number }>;
  /** Diagnostic — net world wealth created (or destroyed) by real-person returns. */
  total_returns: number;
}

export function applyRealPersonInvestment(
  persons: Array<Pick<RealPersonForEconomy, 'id' | 'wealth' | 'intelligence'>>,
  prevIndex: number,
  nextIndex: number,
): RealInvestmentResult {
  if (prevIndex <= 0) {
    // Defensive: division-by-zero guard. Index can't be ≤0 in practice
    // (clamped to MARKET_INDEX_MIN=0.1) but the engine still handles it.
    return {
      updates: persons.map((p) => ({ person_id: p.id, wealth: p.wealth })),
      total_returns: 0,
    };
  }
  const ratio = nextIndex / prevIndex - 1;
  let totalReturns = 0;
  const updates = persons.map((p) => {
    if (p.wealth <= 0) return { person_id: p.id, wealth: p.wealth };
    const invested = p.wealth * (p.intelligence / 100);
    const gain = invested * ratio;
    totalReturns += gain;
    const newWealth = Math.max(0, Math.round(p.wealth + gain));
    return { person_id: p.id, wealth: newWealth };
  });
  return { updates, total_returns: totalReturns };
}
