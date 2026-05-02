// Phase 8 — Apply event bucket modifiers (DESIGN.md §9.4).
//
// Pure function: takes a list of active events (already scoped to a city /
// world / faction) plus the buckets they affect, and returns a per-bucket
// delta map that callers can apply on top of the base bucket-dynamics step.
//
// Stacking rules:
//   - income_multiplier:        product across matching events
//   - birth_rate_multiplier:    product across matching events
//   - mortality_delta:          sum across matching events
//   - happiness_delta:          sum across matching events
//
// "Matching" = modifier has no `type` (applies to all buckets in scope) OR
// modifier.type === bucket.type.

import type { BucketModifier, PersonType } from '@claude-god/shared';

export interface ActiveEventScoped {
  /** Subset of `BucketModifier[]` that should hit these buckets. Caller is
   *  responsible for scope-filtering events to the relevant city/global. */
  bucket_modifiers: BucketModifier[];
}

export interface BucketLite {
  type: PersonType;
}

export interface BucketDelta {
  income_multiplier: number;
  birth_rate_multiplier: number;
  mortality_delta: number;
  happiness_delta: number;
}

export type BucketDeltaMap = Record<PersonType, BucketDelta>;

const ZERO: BucketDelta = {
  income_multiplier: 1,
  birth_rate_multiplier: 1,
  mortality_delta: 0,
  happiness_delta: 0,
};

/** Empty (identity) delta — useful in tests. */
export function zeroDelta(): BucketDelta {
  return { ...ZERO };
}

/**
 * Stack modifiers from `events` onto each bucket in `buckets`. Returns a map
 * keyed by PersonType. Buckets not present in `buckets` are absent from the
 * map (callers should default-skip).
 */
export function applyEventModifiers(
  buckets: BucketLite[],
  events: ActiveEventScoped[],
): BucketDeltaMap {
  const out = {} as BucketDeltaMap;
  for (const b of buckets) {
    out[b.type] = { ...ZERO };
  }
  for (const ev of events) {
    for (const m of ev.bucket_modifiers) {
      for (const b of buckets) {
        if (m.type !== undefined && m.type !== b.type) continue;
        const d = out[b.type];
        if (m.income_multiplier !== undefined) d.income_multiplier *= m.income_multiplier;
        if (m.birth_rate_multiplier !== undefined)
          d.birth_rate_multiplier *= m.birth_rate_multiplier;
        if (m.mortality_delta !== undefined) d.mortality_delta += m.mortality_delta;
        if (m.happiness_delta !== undefined) d.happiness_delta += m.happiness_delta;
      }
    }
  }
  return out;
}
