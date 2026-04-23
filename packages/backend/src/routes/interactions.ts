// ============================================================
// /api/interactions — Player-direct interactions
// /force, /steal, /gift remain synchronous and immediate.
// The old /tick handler was removed in Phase 7 cleanup; the
// async year pipeline lives in services/year.service.ts and is
// exposed via /api/years/advance.
// ============================================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { toneForOutcomeBand } from '../services/tone.service';
import {
  ALL_IDENTITY_KEYS,
  TRAUMA_SCORE_PENALTY,
  type GlobalTraitSet,
  type RulesetDef,
  type TraitSet,
} from '@civ-sim/shared';

// Global forces are scrapped — pass empty objects so amplifiers are no-ops.
const EMPTY_GLOBAL_TRAITS: GlobalTraitSet  = {} as GlobalTraitSet;
const EMPTY_TRAIT_MULTS: Record<string, number> = {};

import {
  computeScore,
  findBand,
  getEffects,
  applyEffectPacket,
  emotionalImpactForMagnitude,
  invertImpact,
  computeGrudgeBonus,
} from '../tick/scoring';
import { getActiveWorld } from '../services/time.service';
import { writeMemoriesBatch } from '../services/memory.service';
import { manualSteal, manualGift } from '../services/economy.service';

const router = Router();

// ── POST /api/interactions/force ────────────────────────────
//
// Run exactly one interaction between two specific people with a
// specific interaction type — all three chosen by the player.
// Bypasses the random antagonizer picker.
//
// Body: { subject_id, antagonist_id, interaction_type_id }
//
// Returns: { subject, antagonist, interaction_type, score, outcome, memories }

router.post('/force', async (req: Request, res: Response) => {
  const { subject_id, antagonist_id, interaction_type_id } = req.body;

  if (!subject_id || !antagonist_id || !interaction_type_id) {
    res.status(400).json({ error: 'subject_id, antagonist_id, and interaction_type_id are required' });
    return;
  }
  if (subject_id === antagonist_id) {
    res.status(400).json({ error: 'Subject and antagonist must be different people' });
    return;
  }

  // Load both persons
  const [subject, antagonist] = await Promise.all([
    prisma.person.findUnique({
      where: { id: subject_id },
      select: {
        id: true, name: true, money: true, age: true, death_age: true,
        traits: true, global_scores: true, current_health: true, trauma_score: true,
      },
    }),
    prisma.person.findUnique({
      where: { id: antagonist_id },
      select: {
        id: true, name: true, money: true, age: true, death_age: true,
        traits: true, global_scores: true, current_health: true, trauma_score: true,
      },
    }),
  ]);

  if (!subject) { res.status(404).json({ error: `Subject ${subject_id} not found` }); return; }
  if (!antagonist) { res.status(404).json({ error: `Antagonist ${antagonist_id} not found` }); return; }

  // Load world state + active ruleset
  const world = await getActiveWorld();
  const rulesetRow = await prisma.ruleset.findFirst({ where: { is_active: true } });
  if (!rulesetRow) { res.status(400).json({ error: 'No active ruleset' }); return; }
  const rules = rulesetRow.rules as unknown as RulesetDef;

  // Find the requested interaction type
  const iType = rules.interaction_types.find((t) => t.id === interaction_type_id);
  if (!iType) {
    res.status(400).json({
      error: `Interaction type "${interaction_type_id}" not found in active ruleset`,
      available: rules.interaction_types.map((t) => ({ id: t.id, label: t.label })),
    });
    return;
  }

  // Score
  const grudgeBonus   = await computeGrudgeBonus(prisma, subject.id, antagonist.id);
  const subjectTraits = (subject.traits ?? {}) as TraitSet;
  const traumaPenalty = Math.round((subject.trauma_score ?? 0) * TRAUMA_SCORE_PENALTY);
  const score         = computeScore(iType, subjectTraits, EMPTY_GLOBAL_TRAITS, EMPTY_TRAIT_MULTS, grudgeBonus) - traumaPenalty;
  const band          = findBand(score, rules.outcome_bands);

  // Effects — unified traitDeltas accumulator
  const traitDeltas: Record<string, Record<string, number>> = {};
  const { subject: subjectPacket, antagonist: antaPacket } = getEffects(band);
  applyEffectPacket(traitDeltas, subject.id,    subjectPacket);
  applyEffectPacket(traitDeltas, antagonist.id, antaPacket);

  // Persist delta + memory in one transaction
  const summary   = `Forced: ${iType.label} between ${subject.name} and ${antagonist.name} — ${band.label} (${score})`;
  const emotional = emotionalImpactForMagnitude(score, band.magnitude ?? 0.5);
  const magnitude = band.magnitude ?? 0.5;

  await prisma.$transaction(async (tx) => {
    for (const [pid, td] of Object.entries(traitDeltas)) {
      const person = pid === subject.id ? subject : antagonist;
      const existingTraits = (person.traits ?? {}) as Record<string, number>;
      const newTraits: Record<string, number> = { ...existingTraits };
      let traitsChanged = false;
      let newHealth: number | undefined;

      for (const [trait, d] of Object.entries(td)) {
        if (trait === 'current_health') {
          newHealth = Math.max(0, Math.min(100, (person.current_health ?? 100) + d));
          continue;
        }
        if (!ALL_IDENTITY_KEYS.includes(trait)) continue;
        const cur  = newTraits[trait] ?? 50;
        const next = Math.max(0, Math.min(100, cur + d));
        if (next !== cur) { newTraits[trait] = next; traitsChanged = true; }
      }

      const updateData: Record<string, unknown> = {};
      if (traitsChanged) updateData.traits = newTraits as unknown as Prisma.InputJsonValue;
      if (newHealth !== undefined) updateData.current_health = newHealth;

      if (Object.keys(updateData).length > 0) {
        await tx.person.update({ where: { id: pid }, data: updateData });
      }
    }

    // Memory entries
    if (band.creates_memory) {
      const tone = toneForOutcomeBand(band, iType);
      await writeMemoriesBatch(tx, [
        {
          personId:        subject.id,
          eventSummary:    summary,
          emotionalImpact: emotional,
          deltaApplied:    { score, band: band.label },
          magnitude,
          counterpartyId:  antagonist.id,
          worldYear:       world.current_year,
          tone,
          ageAtEvent:      subject.age,
          eventKind:       'interaction',
        },
        {
          personId:        antagonist.id,
          eventSummary:    `Forced: ${iType.label} with ${subject.name} — ${band.label} (${score})`,
          emotionalImpact: invertImpact(emotional),
          deltaApplied:    { score, band: band.label },
          magnitude,
          counterpartyId:  subject.id,
          worldYear:       world.current_year,
          tone,
          ageAtEvent:      antagonist.age,
          eventKind:       'interaction',
        },
      ]);
    }
  });

  res.json({
    subject_name:       subject.name,
    antagonist_name:    antagonist.name,
    interaction_type:   { id: iType.id, label: iType.label },
    score,
    grudge_bonus:       grudgeBonus,
    outcome:            band.label,
    magnitude,
    creates_memory:     band.creates_memory,
    subject_traits_changed:    traitDeltas[subject.id] ?? {},
    antagonist_traits_changed: traitDeltas[antagonist.id] ?? {},
  });
});

// ── POST /api/interactions/steal ────────────────────────────
// Player-triggered theft: transfer 10-30% of victim's money to the thief,
// damage the victim's bond toward the thief, write memories for both.
//
// Body: { thief_id, victim_id }

router.post('/steal', async (req: Request, res: Response) => {
  const { thief_id, victim_id } = req.body;
  if (!thief_id || !victim_id) {
    res.status(400).json({ error: 'thief_id and victim_id are required' });
    return;
  }
  if (thief_id === victim_id) {
    res.status(400).json({ error: 'Cannot steal from yourself' });
    return;
  }

  try {
    const world = await getActiveWorld();
    const result = await manualSteal(prisma, thief_id, victim_id, world.current_year);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

// ── POST /api/interactions/gift ──────────────────────────────
// Player-triggered gift: transfer `amount` from donor to recipient,
// boost recipient's bond toward donor, write memories for both.
//
// Body: { donor_id, recipient_id, amount }

router.post('/gift', async (req: Request, res: Response) => {
  const { donor_id, recipient_id, amount } = req.body;
  if (!donor_id || !recipient_id || amount === undefined) {
    res.status(400).json({ error: 'donor_id, recipient_id, and amount are required' });
    return;
  }
  if (donor_id === recipient_id) {
    res.status(400).json({ error: 'Cannot gift to yourself' });
    return;
  }
  const amt = Math.floor(Number(amount));
  if (isNaN(amt) || amt <= 0) {
    res.status(400).json({ error: 'amount must be a positive integer' });
    return;
  }

  try {
    const world = await getActiveWorld();
    const result = await manualGift(prisma, donor_id, recipient_id, amt, world.current_year);
    res.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

export default router;
