// ============================================================
// TICK SCORING HELPERS (Round 5)
// ------------------------------------------------------------
// Pure / near-pure helpers shared by the tick protagonist loop and the
// /api/interactions/force route. Extracted so both code paths stay in
// sync on scoring, outcome selection, effect resolution, and memory
// valence semantics.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type {
  GlobalTraitSet,
  InteractionTypeDef,
  OutcomeBand,
  EffectPacket,
  TraitSet,
} from '@civ-sim/shared';

/** Cap on grudge-weighted score adjustment from accumulated memories. */
export const MAX_GRUDGE_BONUS     = 80;
/** Relationship-memory lookback limit per subject-counterparty pair. */
export const GRUDGE_MEMORY_LIMIT  = 8;

export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

export function pickInteractionType(types: InteractionTypeDef[]): InteractionTypeDef {
  const total = types.reduce((s, t) => s + t.weight, 0);
  let roll = Math.random() * total;
  for (const t of types) {
    roll -= t.weight;
    if (roll <= 0) return t;
  }
  return types[types.length - 1];
}

/**
 * Core scoring function — fully data-driven.
 *  - Global amplifiers: each `force.child` value times its multiplier.
 *  - Trait weights: per-identity-attribute contribution from the protagonist.
 *    Unknown keys are silently skipped so mismatched rulesets don't crash.
 *  - Grudge bonus: aggregate memory valence between subject and antagonist.
 */
export function computeScore(
  type:              InteractionTypeDef,
  protagonistTraits: TraitSet,
  globalTraits:      GlobalTraitSet,
  multipliers:       Record<string, number>,
  grudgeBonus:       number,
): number {
  let score = 0;

  for (const amp of type.global_amplifiers) {
    const forceKey = amp.key.split('.')[0];
    const raw      = globalTraits[amp.key] ?? 0;
    const mult     = multipliers[forceKey] ?? 1.0;
    score += raw * amp.multiplier * mult;
  }

  for (const tw of type.trait_weights) {
    const val = protagonistTraits[tw.trait];
    if (val === undefined) continue;
    score += val * tw.sign * (tw.multiplier ?? 1);
  }

  score += grudgeBonus;
  return Math.round(score);
}

export function findBand(score: number, bands: OutcomeBand[]): OutcomeBand {
  for (const band of bands) {
    if (score >= band.min_score) return band;
  }
  return bands[bands.length - 1];
}

/**
 * Resolve a band's subject/antagonist effect packets. Legacy v2 rulesets
 * (single stat_delta/affects_stats) are upgraded on the fly — subject
 * gets the packet as-is, antagonist gets the inverse.
 */
export function getEffects(band: OutcomeBand): {
  subject:    EffectPacket;
  antagonist: EffectPacket;
} {
  if (band.subject_effect) {
    const subject = band.subject_effect;
    const antagonist = band.antagonist_effect ?? {
      stat_delta:    [-subject.stat_delta[1], -subject.stat_delta[0]],
      affects_stats: subject.affects_stats,
    };
    return { subject, antagonist };
  }
  const statDelta    = band.stat_delta    ?? [0, 0];
  const affectsStats = band.affects_stats ?? [];
  return {
    subject:    { stat_delta: statDelta, affects_stats: affectsStats },
    antagonist: {
      stat_delta:    [-statDelta[1], -statDelta[0]],
      affects_stats: affectsStats,
    },
  };
}

/** Apply one EffectPacket to the unified trait delta accumulator. */
export function applyEffectPacket(
  traitAcc: Record<string, Record<string, number>>,
  personId: string,
  packet:   EffectPacket,
) {
  if (packet.affects_stats.length > 0) {
    const mag = randInt(packet.stat_delta[0], packet.stat_delta[1]);
    traitAcc[personId] ??= {};
    for (const key of packet.affects_stats) {
      traitAcc[personId][key] = (traitAcc[personId][key] ?? 0) + mag;
    }
  }
  if (packet.trait_deltas) {
    traitAcc[personId] ??= {};
    for (const [key, d] of Object.entries(packet.trait_deltas)) {
      traitAcc[personId][key] = (traitAcc[personId][key] ?? 0) + d;
    }
  }
}

export function emotionalImpactForMagnitude(
  score:     number,
  magnitude: number,
): 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric' {
  if (score >= 0) {
    if (magnitude >= 0.9) return 'euphoric';
    if (magnitude >= 0.4) return 'positive';
    return 'neutral';
  }
  if (magnitude >= 0.9) return 'traumatic';
  if (magnitude >= 0.4) return 'negative';
  return 'neutral';
}

export function invertImpact(
  impact: 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric',
): 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric' {
  switch (impact) {
    case 'euphoric':  return 'traumatic';
    case 'positive':  return 'negative';
    case 'negative':  return 'positive';
    case 'traumatic': return 'euphoric';
    default:          return 'neutral';
  }
}

const IMPACT_VALENCE: Record<string, number> = {
  traumatic:  -2,
  negative:   -1,
  neutral:     0,
  positive:    1,
  euphoric:    2,
};

/**
 * Looks up recent memories between `personId` and `counterpartyId` and
 * returns a signed bonus in score space. Positive valence boosts the
 * score; negative drags it down. Magnitude scales each memory so trauma
 * weighs more than minor events. Clamped to [-MAX, +MAX].
 */
export async function computeGrudgeBonus(
  prisma:         PrismaClient,
  personId:       string,
  counterpartyId: string,
): Promise<number> {
  const memories = await prisma.memoryBank.findMany({
    where:   { person_id: personId, counterparty_id: counterpartyId },
    orderBy: { timestamp: 'desc' },
    take:    GRUDGE_MEMORY_LIMIT,
    select:  { emotional_impact: true, magnitude: true },
  });
  if (memories.length === 0) return 0;
  let total = 0;
  for (const m of memories) {
    const valence = IMPACT_VALENCE[m.emotional_impact] ?? 0;
    total += valence * m.magnitude * 25;
  }
  return Math.max(-MAX_GRUDGE_BONUS, Math.min(MAX_GRUDGE_BONUS, total));
}
