// Phase 9 — per-action weighted-random selection (DESIGN.md §11.2).
//
// For each qualifying action, weight = base × tag_match × state_modifier ×
// opportunity. If the actor isn't eligible for an action, weight is 0.
// `pickAction` returns null if total weight < AGENTIC_TOTAL_WEIGHT_THRESHOLD.

import {
  AGENTIC_ACTION_TYPES,
  AGENTIC_TOTAL_WEIGHT_THRESHOLD,
  type AgenticActionType,
} from '@claude-god/shared';
import type { Rng } from '../../lib/rng';
import {
  donateEligibility,
  foundGroupEligibility,
  giftEligibility,
  marryEligibility,
  murderEligibility,
  type EligibilityCtx,
} from './eligibility';
import type { PersonSnapshot } from './types';

export interface WeightedPick {
  action_type: AgenticActionType;
  target_id?: string;
  params?: Record<string, unknown>;
}

/** Per-action eligibility result + weight. */
export interface ActionWeight {
  action_type: AgenticActionType;
  weight: number;
  target_id?: string;
  params?: Record<string, unknown>;
}

export function actionWeights(
  actor: PersonSnapshot,
  ctx: EligibilityCtx,
): ActionWeight[] {
  const tags = actor.personality_tags;
  const states = actor.state_tags;
  const out: ActionWeight[] = [];

  // marry — base 1.0, charismatic ×1.5, kind ×1.2, faithful ×1.2; opportunity
  // ×2 if has lover bond (already required for eligibility).
  const marryE = marryEligibility(actor, ctx);
  if (marryE.ok) {
    let w = 1.0;
    if (tags.includes('charismatic')) w *= 1.5;
    if (tags.includes('kind')) w *= 1.2;
    if (tags.includes('faithful')) w *= 1.2;
    if (states.includes('grieving')) w *= 0.3;
    if (states.includes('wedded-recently')) w = 0;
    out.push({ action_type: 'marry', weight: w, target_id: marryE.target.id });
  } else {
    out.push({ action_type: 'marry', weight: 0 });
  }

  // murder — base 0.4 (rare); cruel ×3, vengeful ×3, ambitious ×1.5;
  // traumatized ×1.5, ruined ×1.3, grieving ×0.5; opportunity already
  // baked in by eligibility (must have a rival/nemesis).
  // Soldier class gets a combat edge: ×1.6 (trained for violence).
  const murderE = murderEligibility(actor, ctx);
  if (murderE.ok) {
    let w = 0.4;
    if (tags.includes('cruel')) w *= 3;
    if (tags.includes('vengeful')) w *= 3;
    if (tags.includes('ambitious')) w *= 1.5;
    if (tags.includes('brave')) w *= 1.4;
    if (tags.includes('reckless')) w *= 1.5;
    if (tags.includes('kind')) w *= 0.2;
    if (tags.includes('loyal')) w *= 0.5;
    if (tags.includes('paranoid')) w *= 1.3;
    if (actor.type === 'Soldier') w *= 1.6;
    if (states.includes('traumatized')) w *= 1.5;
    if (states.includes('ruined')) w *= 1.3;
    if (states.includes('grieving')) w *= 0.5;
    out.push({ action_type: 'murder', weight: w, target_id: murderE.target.id });
  } else {
    out.push({ action_type: 'murder', weight: 0 });
  }

  // found-group — base 0.5; ambitious ×3, charismatic ×2, faithful ×2;
  // famous ×1.5; loyal ×0.3 (loyal stays).
  // Class bias per role-power spec: Priests heavily skew toward religion;
  // Merchants/Scholars/Nobles heavily skew toward faction.
  const fgE = foundGroupEligibility(actor);
  if (fgE.ok) {
    let w = 0.5;
    if (tags.includes('ambitious')) w *= 3;
    if (tags.includes('charismatic')) w *= 2;
    if (tags.includes('faithful')) w *= 2;
    if (tags.includes('proud')) w *= 1.5;
    if (tags.includes('cunning')) w *= 1.3;
    if (tags.includes('loyal')) w *= 0.3;
    if (tags.includes('lazy')) w *= 0.3;
    if (fgE.kind === 'religion' && actor.type === 'Priest') w *= 4;
    if (
      fgE.kind === 'faction' &&
      (actor.type === 'Merchant' ||
        actor.type === 'Scholar' ||
        actor.type === 'Noble')
    ) {
      w *= 3;
    }
    if (states.includes('famous')) w *= 1.5;
    out.push({
      action_type: 'found-group',
      weight: w,
      params: { kind: fgE.kind },
    });
  } else {
    out.push({ action_type: 'found-group', weight: 0 });
  }

  // gift — base 1.0; kind ×2, loyal ×1.5, charismatic ×1.2, faithful ×1.2;
  // greedy ×0.2; windfall ×2.
  const giftE = giftEligibility(actor, ctx);
  if (giftE.ok) {
    let w = 1.0;
    if (tags.includes('kind')) w *= 2;
    if (tags.includes('loyal')) w *= 1.5;
    if (tags.includes('charismatic')) w *= 1.2;
    if (tags.includes('faithful')) w *= 1.2;
    if (tags.includes('greedy')) w *= 0.2;
    if (states.includes('windfall')) w *= 2;
    out.push({ action_type: 'gift', weight: w, target_id: giftE.target.id });
  } else {
    out.push({ action_type: 'gift', weight: 0 });
  }

  // donate — base 0.6; faithful ×3, kind ×1.3, charismatic ×1.2; greedy ×0.2;
  // happiness scales it (high-happiness donors give freely; sad donors don't).
  // target_id = religion id (group, not person — executor handles the load).
  const donateE = donateEligibility(actor);
  if (donateE.ok) {
    let w = 0.6;
    if (tags.includes('faithful')) w *= 3;
    if (tags.includes('kind')) w *= 1.3;
    if (tags.includes('charismatic')) w *= 1.2;
    if (tags.includes('greedy')) w *= 0.2;
    // 0.5× at happiness 0, 1.0× at 50, 1.5× at 100 — gentle linear.
    w *= 0.5 + actor.happiness / 100;
    out.push({ action_type: 'donate', weight: w, target_id: donateE.religion_id });
  } else {
    out.push({ action_type: 'donate', weight: 0 });
  }

  return out;
}

/** Weighted random pick across eligible actions. Returns null on passive year. */
export function pickAction(weights: ActionWeight[], rng: Rng): WeightedPick | null {
  const total = weights.reduce((s, w) => s + w.weight, 0);
  if (total < AGENTIC_TOTAL_WEIGHT_THRESHOLD) return null;
  let roll = rng.uniform(0, total);
  for (const w of weights) {
    if (w.weight <= 0) continue;
    if (roll < w.weight) {
      return {
        action_type: w.action_type,
        target_id: w.target_id,
        params: w.params,
      };
    }
    roll -= w.weight;
  }
  // Fallback (shouldn't be reachable given total > 0).
  const last = weights.filter((w) => w.weight > 0).pop();
  if (!last) return null;
  return {
    action_type: last.action_type,
    target_id: last.target_id,
    params: last.params,
  };
}

// Re-export so tests don't need a separate import path.
export { AGENTIC_ACTION_TYPES };
