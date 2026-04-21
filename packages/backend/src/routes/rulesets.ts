// ============================================================
// /api/rulesets — CRUD + activate
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import type { RulesetDef } from '@civ-sim/shared';

const router = Router();

// ── Default starter ruleset ──────────────────────────────────
// Built around the 5 default active trait categories:
//   violence_morality, mental_fortitude, identity_pressure,
//   social_survival, philosophy
export const DEFAULT_RULESET: RulesetDef = {
  version: 1,

  interaction_types: [
    {
      id:     'conflict',
      label:  'Conflict',
      weight: 3,
      trait_weights: [
        { trait: 'killing_threshold',            sign:  1 },
        { trait: 'cruelty',                      sign:  1 },
        { trait: 'mercy',                        sign: -1 },
        { trait: 'vengefulness',                 sign:  1 },
        { trait: 'fear_management',              sign:  1 },
        { trait: 'breaking_point',               sign: -1 },
        { trait: 'despair_resistance',           sign:  1 },
      ],
      global_amplifiers: [
        { key: 'war.morale',            multiplier: 0.30 },
        { key: 'war.military_strength', multiplier: 0.20 },
        { key: 'tyranny.oppression',    multiplier: 0.20 },
      ],
    },

    {
      id:     'trade',
      label:  'Trade',
      weight: 3,
      trait_weights: [
        { trait: 'alliance_building',   sign:  1 },
        { trait: 'loyalty',             sign:  1 },
        { trait: 'betrayal_detection',  sign:  1 },
        { trait: 'group_navigation',    sign:  1 },
        { trait: 'justice_belief',      sign:  1 },
        { trait: 'mercy',               sign:  1 },
        { trait: 'nihilism',            sign: -1 },
      ],
      global_amplifiers: [
        { key: 'scarcity.material_wealth',    multiplier: 0.30 },
        { key: 'discovery.knowledge_spread',  multiplier: 0.20 },
        { key: 'tyranny.oppression',          multiplier: 0.15 },
      ],
    },

    {
      id:     'bond',
      label:  'Bond',
      weight: 2,
      trait_weights: [
        { trait: 'loyalty',             sign:  1 },
        { trait: 'alliance_building',   sign:  1 },
        { trait: 'mercy',               sign:  1 },
        { trait: 'justice_belief',      sign:  1 },
        { trait: 'group_navigation',    sign:  1 },
        { trait: 'betrayal_detection',  sign:  1 },
        { trait: 'killing_threshold',   sign: -1 },
        { trait: 'nihilism',            sign: -1 },
      ],
      global_amplifiers: [
        { key: 'faith.spiritual_comfort', multiplier: 0.30 },
        { key: 'tyranny.oppression',      multiplier: 0.15 },
        { key: 'scarcity.food_supply',    multiplier: 0.10 },
      ],
    },

    {
      id:     'survival',
      label:  'Survival',
      weight: 2,
      trait_weights: [
        { trait: 'despair_resistance',              sign:  1 },
        { trait: 'isolation_tolerance',             sign:  1 },
        { trait: 'trauma_recovery',                 sign:  1 },
        { trait: 'fear_management',                 sign:  1 },
        { trait: 'death_acceptance',                sign:  1 },
        { trait: 'loyalty',                         sign:  1 },
        { trait: 'breaking_point',                  sign: -1 },
        { trait: 'self_preservation_vs_principle',  sign:  1 },
      ],
      global_amplifiers: [
        { key: 'scarcity.food_supply',     multiplier: 0.40 },
        { key: 'scarcity.water_access',    multiplier: 0.30 },
        { key: 'plague.infection_rate',    multiplier: 0.30 },
      ],
    },

    {
      id:     'dominance',
      label:  'Dominance',
      weight: 2,
      trait_weights: [
        { trait: 'dignity_retention',               sign:  1 },
        { trait: 'shame_threshold',                 sign:  1 },
        { trait: 'killing_threshold',               sign:  1 },
        { trait: 'vengefulness',                    sign:  1 },
        { trait: 'nihilism',                        sign:  1 },
        { trait: 'breaking_point',                  sign: -1 },
        { trait: 'self_preservation_vs_principle',  sign: -1 },
      ],
      global_amplifiers: [
        { key: 'tyranny.oppression',      multiplier: 0.30 },
        { key: 'war.military_strength',   multiplier: 0.20 },
        { key: 'faith.zealotry',          multiplier: 0.20 },
      ],
    },
  ],

  // Ordered highest → lowest. First match wins.
  outcome_bands: [
    {
      label:            'legendary',
      min_score:         400,
      stat_delta:       [25, 40],
      affects_stats:    ['health', 'happiness', 'reputation'],
      can_die:          false,
      creates_memory:   true,
      creates_headline: true,
    },
    {
      label:            'great',
      min_score:         200,
      stat_delta:       [10, 25],
      affects_stats:    ['health', 'happiness', 'reputation'],
      can_die:          false,
      creates_memory:   true,
      creates_headline: false,
    },
    {
      label:            'minor_good',
      min_score:          50,
      stat_delta:        [3, 10],
      affects_stats:    ['happiness'],
      can_die:          false,
      creates_memory:   false,
      creates_headline: false,
    },
    {
      label:            'neutral',
      min_score:         -50,
      stat_delta:        [-2, 2],
      affects_stats:    [],
      can_die:          false,
      creates_memory:   false,
      creates_headline: false,
    },
    {
      label:            'minor_bad',
      min_score:        -200,
      stat_delta:       [-15, -5],
      affects_stats:    ['happiness', 'health'],
      can_die:          false,
      creates_memory:   false,
      creates_headline: false,
    },
    {
      label:            'severe',
      min_score:        -400,
      stat_delta:       [-30, -15],
      affects_stats:    ['health', 'happiness', 'reputation'],
      can_die:          false,
      creates_memory:   true,
      creates_headline: false,
    },
    {
      label:            'catastrophic',
      min_score:        -Infinity,
      stat_delta:       [-60, -30],
      affects_stats:    ['health', 'happiness', 'reputation'],
      can_die:          true,
      creates_memory:   true,
      creates_headline: true,
    },
  ],
};

// ── Helpers ──────────────────────────────────────────────────

async function ensureDefaultExists() {
  const count = await prisma.ruleset.count();
  if (count === 0) {
    await prisma.ruleset.create({
      data: {
        name:        'Default',
        description: 'Generic starter ruleset — conflict, trade, bond, survival, dominance',
        is_active:   true,
        rules:       DEFAULT_RULESET as object,
      },
    });
  }
}

// ── GET /api/rulesets ────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  await ensureDefaultExists();
  const rulesets = await prisma.ruleset.findMany({
    orderBy: { created_at: 'asc' },
    select: { id: true, name: true, description: true, is_active: true, created_at: true, updated_at: true },
  });
  res.json(rulesets);
});

// ── GET /api/rulesets/active ─────────────────────────────────
router.get('/active', async (_req: Request, res: Response) => {
  await ensureDefaultExists();
  const ruleset = await prisma.ruleset.findFirst({ where: { is_active: true } });
  if (!ruleset) { res.status(404).json({ error: 'No active ruleset' }); return; }
  res.json(ruleset);
});

// ── GET /api/rulesets/:id ────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const ruleset = await prisma.ruleset.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(ruleset);
});

// ── POST /api/rulesets ───────────────────────────────────────
router.post('/', async (req: Request, res: Response) => {
  const { name, description, rules } = req.body as {
    name: string; description?: string; rules: RulesetDef;
  };
  if (!name || !rules) { res.status(400).json({ error: 'name and rules are required' }); return; }

  const ruleset = await prisma.ruleset.create({
    data: { name, description, is_active: false, rules: rules as object },
  });
  res.status(201).json(ruleset);
});

// ── PATCH /api/rulesets/:id ──────────────────────────────────
router.patch('/:id', async (req: Request, res: Response) => {
  const { name, description, rules } = req.body as {
    name?: string; description?: string; rules?: RulesetDef;
  };
  const ruleset = await prisma.ruleset.update({
    where: { id: req.params.id },
    data:  {
      ...(name        !== undefined && { name }),
      ...(description !== undefined && { description }),
      ...(rules       !== undefined && { rules: rules as object }),
    },
  });
  res.json(ruleset);
});

// ── POST /api/rulesets/:id/activate ─────────────────────────
router.post('/:id/activate', async (req: Request, res: Response) => {
  await prisma.$transaction([
    prisma.ruleset.updateMany({ where: {},               data: { is_active: false } }),
    prisma.ruleset.update    ({ where: { id: req.params.id }, data: { is_active: true  } }),
  ]);
  const ruleset = await prisma.ruleset.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(ruleset);
});

// ── DELETE /api/rulesets/:id ─────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const target = await prisma.ruleset.findUniqueOrThrow({ where: { id: req.params.id } });
  if (target.is_active) { res.status(400).json({ error: 'Cannot delete the active ruleset' }); return; }
  await prisma.ruleset.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
