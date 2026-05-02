// Faction / religion dues (Phase 10 — DESIGN.md §6.3).
//
// Two payment models, branched by group.kind:
//
// FACTION (flat cost_per_year):
//   - If wealth ≥ cost: debit, reset miss-counter to 0.
//   - Else: partial debit; miss-counter++; kick at DUES_KICK_AFTER_MISSES.
//
// RELIGION (cost_pct_of_wealth — § R1):
//   - owed = floor(wealth × pct). Always paid in full out of current wealth.
//   - "Miss" only when owed rounds to 0 (i.e. wealth is essentially 0). The
//     counter still ticks for telemetry, but religions DO NOT KICK BROKE
//     MEMBERS — kicked stays false even at the threshold (per Q-A).
//
// Bucket-member behavior:
//   - Aggregate dues already computed by caller from Bucket.faction_shares /
//     religion_shares; bucket-dynamics handles the per-kind formula.
//   - No kicking — buckets are aggregates; share fractions can drift via
//     existing group-lifecycle phase.
//
// Pure: returns deltas + outcomes; orchestrator persists.

import { DUES_KICK_AFTER_MISSES } from '@claude-god/shared';
import type {
  DuesInput,
  DuesResult,
  DuesGroupOutcome,
  GroupForDues,
  RealMemberDuesOutcome,
  RealPersonForEconomy,
} from './types';

export function applyDues(input: DuesInput): DuesResult {
  const outcomes: DuesGroupOutcome[] = [];
  let totalCollected = 0;
  let totalRealDebited = 0;
  let totalBucketDebited = 0;

  for (const group of input.groups) {
    const isReligion = group.kind === 'religion';
    const flatCost = group.cost_per_year;
    const pct = group.cost_pct_of_wealth ?? 0;
    const hasFreeFaction = !isReligion && flatCost <= 0;
    const hasFreeReligion = isReligion && pct <= 0;

    if (!group.is_active || hasFreeFaction || hasFreeReligion) {
      // Inactive or free groups still emit an empty outcome row so callers
      // can iterate uniformly. Skip the math to avoid touching members.
      outcomes.push({ group_id: group.id, collected: 0, real_member_outcomes: [] });
      continue;
    }

    const realMembers = filterRealMembers(input.realMembers, group);
    const memberOutcomes: RealMemberDuesOutcome[] = [];
    let realCollected = 0;

    for (const m of realMembers) {
      const priorMissed = isReligion ? m.dues_missed_religion : m.dues_missed_faction;

      if (isReligion) {
        // Religion: % of wealth, always full pay (because owed scales with wealth).
        // The only "miss" is when the rounded debit is zero (wealth ≈ 0). We tick
        // the counter for diagnostics but never kick — broke worshippers stay.
        const owed = Math.floor(Math.max(0, m.wealth) * pct);
        if (owed > 0) {
          memberOutcomes.push({
            person_id: m.id,
            paid: owed,
            new_missed_count: 0,
            kicked: false,
          });
          realCollected += owed;
          totalRealDebited += owed;
        } else {
          memberOutcomes.push({
            person_id: m.id,
            paid: 0,
            new_missed_count: priorMissed + 1,
            kicked: false, // religions never kick (Q-A)
          });
        }
      } else {
        // Faction: flat cost; existing 3-strike kick semantics.
        const owed = flatCost;
        if (m.wealth >= owed) {
          memberOutcomes.push({
            person_id: m.id,
            paid: owed,
            new_missed_count: 0,
            kicked: false,
          });
          realCollected += owed;
          totalRealDebited += owed;
        } else {
          const partial = Math.max(0, m.wealth);
          const newMissed = priorMissed + 1;
          const kicked = newMissed >= DUES_KICK_AFTER_MISSES;
          memberOutcomes.push({
            person_id: m.id,
            paid: partial,
            new_missed_count: kicked ? 0 : newMissed,
            kicked,
          });
          realCollected += partial;
          totalRealDebited += partial;
        }
      }
    }

    const bucketDues = Math.max(0, input.bucketDuesByGroup[group.id] ?? 0);
    totalBucketDebited += bucketDues;

    const collected = Math.round(realCollected + bucketDues);
    totalCollected += collected;

    outcomes.push({
      group_id: group.id,
      collected,
      real_member_outcomes: memberOutcomes,
    });
  }

  return {
    outcomes,
    total_collected: totalCollected,
    total_real_debited: totalRealDebited,
    total_bucket_debited: totalBucketDebited,
  };
}

function filterRealMembers(
  members: RealPersonForEconomy[],
  group: GroupForDues,
): RealPersonForEconomy[] {
  if (group.kind === 'faction') {
    return members.filter((m) => m.faction_id === group.id);
  }
  return members.filter((m) => m.religion_id === group.id);
}
