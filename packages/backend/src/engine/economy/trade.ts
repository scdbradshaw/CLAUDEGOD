// Cross-city Merchant trade (Phase 10 — DESIGN.md §6.3).
//
// Per §6.3: "Merchant bucket size in city X × wealth-differential with
// another city Y produces a flow `wealth_X → wealth_Y`. Merchant bucket
// pockets the differential."
//
// v1 ships single-city (CITY_SEED_COUNT=1) so this is effectively a no-op,
// but the math + tests live here so multi-city activation is automatic.
//
// Math:
//   For each ordered city pair (X, Y) where X.avg_wealth > Y.avg_wealth:
//     flow_total = X.merchantBucket.count × (X.avg_wealth − Y.avg_wealth)
//                  × MERCHANT_TRADE_RATE
//     merchant_cut = flow_total × MERCHANT_TRADE_RATE  (Merchant pockets a slice)
//     net_to_Y     = flow_total − merchant_cut
//   Apply: X.allButMerchant lose flow_total proportionally to wealth-share.
//          Y.allBuckets gain net_to_Y proportionally to wealth-share.
//          X.merchantBucket avg_wealth gains merchant_cut / merchant_count.
//
// Conserves world wealth. Pure.

import { MERCHANT_TRADE_RATE } from '@claude-god/shared';
import type { BucketState } from '../bucket-dynamics/types';

export interface CityForTrade {
  city_id: string;
  buckets: BucketState[];
}

export interface TradeStepResult {
  cities: CityForTrade[];
  total_routed: number;
  flows: Array<{
    from_city: string;
    to_city: string;
    flow: number;
    merchant_cut: number;
  }>;
}

export function applyTrade(cities: CityForTrade[]): TradeStepResult {
  // No-op for the v1 single-city case (and trivially for empty input).
  if (cities.length < 2) {
    return {
      cities: cities.map((c) => ({
        city_id: c.city_id,
        buckets: c.buckets.map((b) => ({ ...b })),
      })),
      total_routed: 0,
      flows: [],
    };
  }

  // Snapshot avg_wealth + merchant counts up front so all flows compute against
  // the same starting state (otherwise pair order matters).
  const snapshots = cities.map((c) => {
    const merchant = c.buckets.find((b) => b.type === 'Merchant');
    const totalWealth = c.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
    const totalCount = c.buckets.reduce((s, b) => s + b.count, 0);
    const avgWealth = totalCount > 0 ? totalWealth / totalCount : 0;
    return {
      city_id: c.city_id,
      merchantCount: merchant?.count ?? 0,
      avgWealth,
    };
  });

  // Per-city net deltas keyed by `${city_id}:${type}` → wealth delta (signed).
  const deltas = new Map<string, number>();
  const flows: TradeStepResult['flows'] = [];
  let totalRouted = 0;

  for (let i = 0; i < snapshots.length; i++) {
    for (let j = 0; j < snapshots.length; j++) {
      if (i === j) continue;
      const from = snapshots[i];
      const to = snapshots[j];
      if (from.avgWealth <= to.avgWealth) continue;
      if (from.merchantCount <= 0) continue;

      const diff = from.avgWealth - to.avgWealth;
      const flowTotal = from.merchantCount * diff * MERCHANT_TRADE_RATE;
      if (flowTotal <= 0) continue;

      const merchantCut = flowTotal * MERCHANT_TRADE_RATE;
      const netToY = flowTotal - merchantCut;
      totalRouted += flowTotal;
      flows.push({
        from_city: from.city_id,
        to_city: to.city_id,
        flow: flowTotal,
        merchant_cut: merchantCut,
      });

      // Distribute losses across non-Merchant buckets in `from` city,
      // proportional to each bucket's wealth-share.
      const fromCity = cities[i];
      const fromNonMerchantWealth = fromCity.buckets
        .filter((b) => b.type !== 'Merchant')
        .reduce((s, b) => s + b.count * b.avg_wealth, 0);
      if (fromNonMerchantWealth > 0) {
        for (const b of fromCity.buckets) {
          if (b.type === 'Merchant') continue;
          const share = (b.count * b.avg_wealth) / fromNonMerchantWealth;
          addDelta(deltas, fromCity.city_id, b.type, -flowTotal * share);
        }
      }
      // Credit Merchant bucket with the cut.
      addDelta(deltas, fromCity.city_id, 'Merchant', merchantCut);

      // Distribute gains across all `to` city buckets proportional to
      // wealth-share (richer buckets gain more — trade favours the prosperous).
      const toCity = cities[j];
      const toTotalWealth = toCity.buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);
      if (toTotalWealth > 0) {
        for (const b of toCity.buckets) {
          const share = (b.count * b.avg_wealth) / toTotalWealth;
          addDelta(deltas, toCity.city_id, b.type, netToY * share);
        }
      }
    }
  }

  // Apply deltas back to bucket avg_wealth (Int with rounding).
  const outCities: CityForTrade[] = cities.map((c) => ({
    city_id: c.city_id,
    buckets: c.buckets.map((b) => {
      if (b.count <= 0) return { ...b };
      const key = `${c.city_id}:${b.type}`;
      const delta = deltas.get(key) ?? 0;
      if (delta === 0) return { ...b };
      const totalWealth = b.count * b.avg_wealth + delta;
      const newAvg = Math.max(0, Math.round(totalWealth / b.count));
      return { ...b, avg_wealth: newAvg };
    }),
  }));

  return { cities: outCities, total_routed: totalRouted, flows };
}

function addDelta(
  m: Map<string, number>,
  cityId: string,
  type: BucketState['type'],
  delta: number,
): void {
  const key = `${cityId}:${type}`;
  m.set(key, (m.get(key) ?? 0) + delta);
}
