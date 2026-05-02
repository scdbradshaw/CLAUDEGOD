// Phase 4 — bucket-dynamics orchestrator.
//
// Pure function. Takes a snapshot of (world, city, buckets), runs the
// year-phase steps in DESIGN.md §15.3 order that are in scope for Phase 4,
// returns the new snapshot + diagnostics.
//
// In-scope steps:
//   3. Bucket dynamics (income + tax)              — `applyIncomeAndTax`
//   4. Market step (drift + investment returns)    — `stepMarket`
//   5. Births (bucket layer)                        — `applyBirths`
//   6. Deaths (bucket layer)                        — `applyDeaths`
//   (drift)  — slow stat random walk so the world isn't frozen
//
// Out of scope (later phases): interactions, real-person flows,
// theft, trade, dues, events, cascades, groups, agentic actions.

import type { Rng } from '../../lib/rng';
import { applyIncomeAndTax } from './income';
import { stepMarket } from './market';
import { applyBirths } from './births';
import { applyDeaths } from './deaths';
import { applyDrift } from './drift';
import { applyTheft } from '../economy/theft';
import type { ActiveEventTags, GroupForDues } from '../economy/types';
import {
  assertNonNegative,
  assertWealthConserved,
  totalWorldWealth,
} from './invariants';
import type { BucketState, CityState, WorldState } from './types';

export interface BucketDynamicsInput {
  world: WorldState;
  city: CityState;
  buckets: BucketState[];
  rng: Rng;
  /** §6.3 — optional group context. Only the bucket-side dues are computed
   * here (against `Bucket.faction_shares` / `religion_shares`). Real-member
   * dues run in `economy.service.runRealPersonEconomyPhaseTx` afterwards. */
  groups?: GroupForDues[];
  /** §6.4 v2 — class-driven market signals read these. Optional so the
   * orchestrator can be exercised in isolation; missing → no events active. */
  active_events?: ActiveEventTags;
  /**
   * §19 two-tier accounting — map of PersonType → alive real-person count.
   * When provided, bucket-dynamics deaths are applied only to the aggregate-NPC
   * portion of each bucket (count − real_count) so real-person death rolls
   * (archiveAndDeleteTx) don't push bucket.count negative.
   */
  real_person_counts?: Record<string, number>;
}

export interface BucketDynamicsResult {
  world: WorldState;
  city: CityState;
  buckets: BucketState[];
  /** Per-group bucket-side dues collected this year. Caller credits these
   * to Group.treasury along with real-member dues. */
  bucket_dues_by_group: Record<string, number>;
  diagnostics: {
    gross_income: number;
    tax_collected: number;
    dues_collected: number;
    theft_amount: number;
    market_returns: number;
    market_index_before: number;
    market_index_after: number;
    /** §6.4 v2 — class-signals breakdown for the year-pipeline snapshot. */
    delta_food: number;
    delta_labor: number;
    delta_craft: number;
    delta_capital: number;
    food_ratio: number;
    food_produced: number;
    food_needed: number;
    total_births: number;
    total_deaths: number;
    wealth_before: number;
    wealth_after: number;
  };
}

/**
 * Run Phase-4 bucket dynamics for one year. Pure (no DB, no clock). Validates
 * non-negativity + wealth conservation before returning.
 */
export function runBucketDynamics(input: BucketDynamicsInput): BucketDynamicsResult {
  const { rng } = input;

  const wealthBefore = totalWorldWealth(input.buckets, input.city);

  // Step 3a: income + tax
  const inc = applyIncomeAndTax(input.buckets, input.city, rng);

  // Step 3b: bucket-side faction/religion dues — debit from each bucket
  //   per its share-fraction. Real-member dues run in economy.service later.
  //   Treasuries are credited by the year-pipeline caller (group rows live
  //   outside this pure orchestrator's scope).
  const groups = input.groups ?? [];
  const dues = applyBucketDuesDeltas(inc.buckets, groups);
  const afterDuesBuckets = dues.buckets;
  const bucketDuesByGroup = dues.dues_by_group;
  const totalBucketDuesDebited = Object.values(bucketDuesByGroup).reduce(
    (s, v) => s + v,
    0,
  );

  // Step 3c: theft — Outlaw bucket extracts full amount from richer same-city
  // buckets and gains all of it (no void).
  const thf = applyTheft(afterDuesBuckets);

  // Step 4: market drift + investment returns. Class-signals read region +
  // active events; both are optional so existing test fixtures still work.
  const mkt = stepMarket(input.world, thf.buckets, rng, input.city, input.active_events);

  // Step 5: births
  const br = applyBirths(mkt.buckets, rng);

  // Step 6: deaths — pass real_person_counts so only aggregate NPCs are killed.
  const dt = applyDeaths(br.buckets, rng, input.real_person_counts);

  // Stat drift (Phase-4 placeholder for ambient change)
  const drifted = applyDrift(dt.buckets, rng);

  const cityAfter = inc.city;
  const wealthAfter = totalWorldWealth(drifted, cityAfter);

  assertNonNegative(drifted, cityAfter);
  const totalCountAfter = drifted.reduce((s, b) => s + b.count, 0);
  // Dues leave the bucket-wealth pool (they enter group treasuries elsewhere)
  // so subtract them from the conservation equation as a flow-out.
  assertWealthConserved(
    wealthBefore,
    wealthAfter,
    inc.gross_added - totalBucketDuesDebited,
    mkt.market_returns,
    totalCountAfter,
  );

  return {
    world: mkt.world,
    city: cityAfter,
    buckets: drifted,
    bucket_dues_by_group: bucketDuesByGroup,
    diagnostics: {
      gross_income: inc.gross_added,
      tax_collected: inc.tax_collected,
      dues_collected: totalBucketDuesDebited,
      theft_amount: thf.total_stolen,
      market_returns: mkt.market_returns,
      market_index_before: mkt.prev_index,
      market_index_after: mkt.world.market_index,
      delta_food: mkt.signals.delta_food,
      delta_labor: mkt.signals.delta_labor,
      delta_craft: mkt.signals.delta_craft,
      delta_capital: mkt.signals.delta_capital,
      food_ratio: mkt.signals.food_ratio,
      food_produced: mkt.signals.food_produced,
      food_needed: mkt.signals.food_needed,
      total_births: br.total_births,
      total_deaths: dt.total_deaths,
      wealth_before: wealthBefore,
      wealth_after: wealthAfter,
    },
  };
}

/**
 * Compute and apply bucket-side dues in one pass, returning both the new
 * buckets and the **actual** per-group totals debited (post-clamp).
 *
 * Per-bucket per-group raw debit:
 *   - Faction:  count × share × cost_per_year
 *   - Religion: count × share × avg_wealth × pct  (§ R1)
 *
 * Each bucket's combined debit is clamped at `count × avg_wealth` (a bucket
 * can't pay more than it has). When clamping fires, every group's slice of
 * that bucket is scaled down proportionally and the returned `dues_by_group`
 * reflects the actual (reduced) collection — so wealth conservation holds
 * and group treasuries get credited only what was really paid.
 */
function applyBucketDuesDeltas(
  buckets: BucketState[],
  groups: GroupForDues[],
): { buckets: BucketState[]; dues_by_group: Record<string, number> } {
  const activeGroups = groups.filter((g) => {
    const isReligion = g.kind === 'religion';
    const pct = g.cost_pct_of_wealth ?? 0;
    return g.is_active && (isReligion ? pct > 0 : g.cost_per_year > 0);
  });

  // Initialize dues totals (preserve key-presence for every group passed in).
  const duesByGroup: Record<string, number> = {};
  for (const g of groups) duesByGroup[g.id] = 0;

  if (activeGroups.length === 0) {
    return { buckets: buckets.map((b) => ({ ...b })), dues_by_group: duesByGroup };
  }

  // Per-bucket × per-active-group raw debit matrix using the SAME formulas
  // that produce the per-group totals — so by construction Σ over buckets
  // equals each group's headline total before clamping.
  const rawDebits: number[][] = buckets.map((b) => {
    if (b.count <= 0) return activeGroups.map(() => 0);
    return activeGroups.map((g) => {
      const isReligion = g.kind === 'religion';
      const shares = isReligion ? b.religion_shares : b.faction_shares;
      const share = shares?.[g.id] ?? 0;
      if (share <= 0) return 0;
      if (isReligion) {
        const pct = g.cost_pct_of_wealth ?? 0;
        return b.count * share * b.avg_wealth * pct;
      }
      return b.count * share * g.cost_per_year;
    });
  });

  // Clamp per-bucket: total debit cannot exceed bucket's available wealth.
  // When the cap binds, scale each group's slice proportionally so the
  // distribution stays fair and conservation tracks actual debits.
  const clampedDebits: number[][] = rawDebits.map((row, i) => {
    const b = buckets[i];
    const sum = row.reduce((s, v) => s + v, 0);
    if (sum <= 0) return row;
    const available = b.count * b.avg_wealth;
    if (sum <= available) return row;
    const scale = available / sum;
    return row.map((v) => v * scale);
  });

  // Sum actual debits per group.
  for (let gi = 0; gi < activeGroups.length; gi++) {
    let total = 0;
    for (let bi = 0; bi < buckets.length; bi++) {
      total += clampedDebits[bi][gi];
    }
    duesByGroup[activeGroups[gi].id] = total;
  }

  // Apply per-bucket debits.
  const nextBuckets = buckets.map((b, i) => {
    if (b.count <= 0) return { ...b };
    const debit = clampedDebits[i].reduce((s, v) => s + v, 0);
    if (debit <= 0) return { ...b };
    const totalWealth = Math.max(0, b.count * b.avg_wealth - debit);
    const newAvg = Math.round(totalWealth / b.count);
    return { ...b, avg_wealth: newAvg };
  });

  return { buckets: nextBuckets, dues_by_group: duesByGroup };
}

export type { BucketState, CityState, WorldState } from './types';
