// Bucket group-share drift (Phase 7 — DESIGN.md §8.3).
//
// Each year, a bucket's shares of each group drift toward higher-fit groups
// and away from lower-fit groups. Total share is always ≤ 1; the residual is
// implicit "unaffiliated."
//
// Pure: takes current shares + per-group fit map, returns new shares.

import type { GroupShares } from '@claude-god/shared';

/** Default drift step — factions. Religions use a slower override (§8.3). */
const DEFAULT_DRIFT_STEP = 0.05;
const SHARE_CAP = 5;     // max number of distinct group entries per bucket

export interface DriftInput {
  /** Current { groupId: shareFraction } map for one kind (faction OR religion). */
  shares: GroupShares;
  /** { groupId: fit } for active groups of the same kind in this bucket's city. */
  fit: Record<string, number>;
  /** Per-year drift magnitude. Defaults to DEFAULT_DRIFT_STEP (factions). */
  step?: number;
}

/**
 * Drift `shares` by DRIFT_STEP toward the highest-fit group, away from the
 * lowest-fit *currently held* group. Results clamped to [0, 1] and total ≤ 1.
 *
 * Rules:
 *   - If best-fit group not yet held and there's room (or worst-held is
 *     fit=0), promote it: new entry starts at DRIFT_STEP.
 *   - Worst-held group with fit=0 gets bled at -DRIFT_STEP (→ unaffiliated
 *     residual grows).
 *   - Worst-held group with fit>0 still gets bled (smaller) toward the best.
 *   - Cap entries at SHARE_CAP — if at cap, displacement requires bleeding
 *     out an existing entry to zero first.
 */
export function driftBucketShares(input: DriftInput): GroupShares {
  const DRIFT_STEP = input.step ?? DEFAULT_DRIFT_STEP;
  const next: GroupShares = { ...input.shares };
  const heldIds = Object.keys(next);
  const fitEntries = Object.entries(input.fit);
  if (fitEntries.length === 0) return next;

  // Sort fit asc/desc.
  const byFitDesc = [...fitEntries].sort((a, b) => b[1] - a[1]);
  const bestFitId = byFitDesc[0][1] > 0 ? byFitDesc[0][0] : null;

  // Identify worst-held: lowest fit among currently-held entries (treat
  // missing-from-fit-map as 0).
  let worstHeldId: string | null = null;
  let worstHeldFit = Infinity;
  for (const id of heldIds) {
    const f = input.fit[id] ?? 0;
    if (f < worstHeldFit) {
      worstHeldFit = f;
      worstHeldId = id;
    }
  }

  // Bleed worst-held by DRIFT_STEP (capped at its current value).
  if (worstHeldId != null) {
    const cur = next[worstHeldId];
    const bleed = Math.min(DRIFT_STEP, cur);
    next[worstHeldId] = cur - bleed;
    if (next[worstHeldId] <= 1e-9) delete next[worstHeldId];
  }

  // Pour DRIFT_STEP into best-fit (only if its fit > 0).
  if (bestFitId != null) {
    const heldNow = Object.keys(next);
    const alreadyHeld = bestFitId in next;
    if (alreadyHeld) {
      next[bestFitId] = Math.min(1, (next[bestFitId] ?? 0) + DRIFT_STEP);
    } else if (heldNow.length < SHARE_CAP) {
      next[bestFitId] = DRIFT_STEP;
    }
    // else: cap full and best isn't held — wait until bleed clears a slot.
  }

  // Final clamp to ensure total ≤ 1 (unaffiliated residual = 1 - total).
  return clampTotal(next);
}

function clampTotal(shares: GroupShares): GroupShares {
  let total = 0;
  for (const v of Object.values(shares)) total += v;
  if (total <= 1) return shares;
  // Scale down proportionally so the sum is exactly 1.
  const scale = 1 / total;
  const out: GroupShares = {};
  for (const [k, v] of Object.entries(shares)) out[k] = v * scale;
  return out;
}
