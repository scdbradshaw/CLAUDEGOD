// Promotion / demotion planner (Phase 5 — DESIGN.md §4.3).
//
// Pure planner. Given the current alive real-person list, the bucket
// catalogue, and the cap, produce:
//   - demotions: which persons to demote this year
//   - promotions: which (city, type) buckets to promote one person from
//
// Honors the 6,000 cap and the 5-year demotion grace window. Phase 5
// uses a *simplified* eligibility set — the additional gates from §4.3
// (no leadership, no real-spouse, no strong bonds) come online in
// later phases as those subsystems land.

import type { PersonType } from '@claude-god/shared';
import { REAL_PERSON_CAP, ENGINE_CHURN_RATE, DEMOTION_GRACE_YEARS } from '@claude-god/shared';
import type { Rng } from '../lib/rng';

/** Subset of Person the planner reads. */
export interface ChurnPerson {
  id: string;
  is_pinned: boolean;
  /** Year of last event/interaction touching this person. null = never. */
  last_event_year: number | null;
  /** Used by demotion priority — older first. */
  created_year: number;
}

/** Subset of Bucket the planner reads. */
export interface ChurnBucket {
  city_id: string;
  type: PersonType;
  count: number;
  avg_wealth: number;
}

export interface ChurnPlanInput {
  persons: ChurnPerson[];
  buckets: ChurnBucket[];
  /** Current world year — used for the 5-year grace check. */
  year: number;
  rng: Rng;
  cap?: number;
  /** Override the engine churn rate (tests). */
  churn_rate?: number;
}

export interface PromotionPick {
  city_id: string;
  type: PersonType;
}

export interface ChurnPlan {
  /** Person IDs to demote (auto-only — no pin overrides here). */
  demotion_ids: string[];
  /** (city, type) tuples each producing one materialization. */
  promotion_picks: PromotionPick[];
  /** Diagnostic — promotion target set this year (post-cap clamping). */
  promotion_budget: number;
  /** Diagnostic — how many would-be promotions were skipped due to cap. */
  promotions_skipped_for_cap: number;
}

/**
 * Plan a year of churn. Order:
 *   1. Compute promotion_budget = round(real_count × churn_rate).
 *   2. Find demotion-eligible persons (unpinned + last_event_year + grace).
 *   3. If real_count == cap, must demote at least promotion_budget persons
 *      to make room (cap-overflow rule §4.3). If insufficient demotion-
 *      eligible, skip excess promotions.
 *   4. Pick demotions: take the *least valuable* eligible first
 *      (oldest by created_year, no events ever). Already-targeted ones
 *      shouldn't be in the input — caller filters by `is_alive`.
 *   5. Pick promotions: weighted by `bucket.avg_wealth × bucket.count`
 *      (DESIGN §4.3.3 "wealth percentile"). Budget split across all
 *      non-empty buckets.
 */
export function planChurn(input: ChurnPlanInput): ChurnPlan {
  const cap = input.cap ?? REAL_PERSON_CAP;
  const rate = input.churn_rate ?? ENGINE_CHURN_RATE;

  const realCount = input.persons.length;
  // Natural target: 2% of current pool. Plus a small warm-up floor so an
  // empty world doesn't take 50 years to grow a real-person pool.
  const natural = Math.round(realCount * rate);
  const warmupFloor = realCount < 50 ? 5 : 1;
  const promotionBudget = Math.max(natural, warmupFloor);

  const eligible = input.persons.filter((p) => isDemotionEligible(p, input.year));
  const slack = cap - realCount;

  // How many we must demote to make room for the promotion budget.
  const requiredDemotions = Math.max(0, promotionBudget - slack);
  const actualDemotions = Math.min(requiredDemotions, eligible.length);
  const promotions = Math.min(promotionBudget, slack + actualDemotions);
  const skipped = promotionBudget - promotions;

  // Demotion order: oldest, then no-event-ever, then random tiebreak.
  const sortedEligible = [...eligible].sort((a, b) => {
    if (a.created_year !== b.created_year) return a.created_year - b.created_year;
    const aQuiet = a.last_event_year ?? -Infinity;
    const bQuiet = b.last_event_year ?? -Infinity;
    return aQuiet - bQuiet;
  });
  const demotionIds = sortedEligible.slice(0, actualDemotions).map((p) => p.id);

  // Promotions: weighted-random over buckets.
  const picks = pickPromotions(input.buckets, promotions, input.rng);

  return {
    demotion_ids: demotionIds,
    promotion_picks: picks,
    promotion_budget: promotionBudget,
    promotions_skipped_for_cap: skipped,
  };
}

export function isDemotionEligible(person: ChurnPerson, year: number): boolean {
  if (person.is_pinned) return false;
  // 5-year quiet window. Never-touched also eligible (last_event_year=null).
  if (person.last_event_year != null && year - person.last_event_year < DEMOTION_GRACE_YEARS) {
    return false;
  }
  return true;
}

/** Weighted-random picks of (city, type) by `avg_wealth × count`, with replacement. */
function pickPromotions(
  buckets: ChurnBucket[],
  n: number,
  rng: Rng,
): PromotionPick[] {
  const usable = buckets.filter((b) => b.count > 0);
  if (usable.length === 0 || n <= 0) return [];

  const weights = usable.map((b) => Math.max(1, b.avg_wealth) * b.count);
  const total = weights.reduce((s, w) => s + w, 0);

  const picks: PromotionPick[] = [];
  for (let i = 0; i < n; i++) {
    let r = rng.next() * total;
    let chosen = usable[usable.length - 1];
    for (let j = 0; j < usable.length; j++) {
      r -= weights[j];
      if (r <= 0) {
        chosen = usable[j];
        break;
      }
    }
    picks.push({ city_id: chosen.city_id, type: chosen.type });
  }
  return picks;
}
