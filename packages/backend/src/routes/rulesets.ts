// ============================================================
// /api/rulesets — CRUD + activate
// ============================================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import type { RulesetDef } from '@civ-sim/shared';

const router = Router();

// ── Default starter ruleset ──────────────────────────────────
// Trait weights reference the 16 identity attributes in IDENTITY_ATTRIBUTES
// (4 categories × 4 traits: body/mind/heart/drive). Any unknown trait key
// is silently skipped, so rulesets can evolve ahead of the attribute schema.
export const DEFAULT_RULESET: RulesetDef = {
  version: 6,

  interaction_types: [
    {
      id:     'conflict',
      label:  'Conflict',
      weight: 3,
      trait_weights: [
        { trait: 'strength',   sign:  1 },
        { trait: 'endurance',  sign:  1 },
        { trait: 'courage',    sign:  1 },
        { trait: 'cunning',    sign:  1 },
        { trait: 'discipline', sign:  1 },
        { trait: 'empathy',    sign: -1 },
        { trait: 'resilience', sign:  1 },
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
        { trait: 'charisma',     sign:  1 },
        { trait: 'intelligence', sign:  1 },
        { trait: 'cunning',      sign:  1 },
        { trait: 'ambition',     sign:  1 },
        { trait: 'discipline',   sign:  1 },
        { trait: 'loyalty',      sign:  1 },  // trustworthy trading partners close deals
      ],
      global_amplifiers: [
        { key: 'scarcity.material_wealth',   multiplier: 0.30 },
        { key: 'discovery.knowledge_spread', multiplier: 0.20 },
        { key: 'tyranny.oppression',         multiplier: 0.15 },
      ],
    },

    {
      id:     'bond',
      label:  'Bond',
      weight: 2,
      trait_weights: [
        { trait: 'empathy',    sign:  1 },
        { trait: 'charisma',   sign:  1 },
        { trait: 'loyalty',    sign:  1 },
        { trait: 'willpower',  sign:  1 },
        { trait: 'discipline', sign:  1 },
        { trait: 'cunning',    sign: -1 },
        { trait: 'jealousy',   sign: -1 },
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
        { trait: 'endurance',  sign:  1 },
        { trait: 'resilience', sign:  1 },
        { trait: 'agility',    sign:  1 },
        { trait: 'courage',    sign:  1 },
        { trait: 'cunning',    sign:  1 },
        { trait: 'intuition',  sign:  1 },
      ],
      global_amplifiers: [
        { key: 'scarcity.food_supply',  multiplier: 0.40 },
        { key: 'scarcity.water_access', multiplier: 0.30 },
        { key: 'plague.infection_rate', multiplier: 0.30 },
      ],
    },

    {
      id:     'dominance',
      label:  'Dominance',
      weight: 2,
      trait_weights: [
        { trait: 'ambition',   sign:  1 },
        { trait: 'charisma',   sign:  1 },
        { trait: 'strength',   sign:  1 },
        { trait: 'willpower',  sign:  1 },
        { trait: 'cunning',    sign:  1 },
        { trait: 'empathy',    sign: -1 },
        { trait: 'loyalty',    sign: -1 },  // low loyalty enables ruthless play
      ],
      global_amplifiers: [
        { key: 'tyranny.oppression',    multiplier: 0.30 },
        { key: 'war.military_strength', multiplier: 0.20 },
        { key: 'faith.zealotry',        multiplier: 0.20 },
      ],
    },

    // Conception — intimate path into the births system. Only interaction
    // type with `can_conceive: true`, so only this type's positive bands
    // can ever queue a Pregnancy (see interactions.ts §3d).
    {
      id:     'conception',
      label:  'Intimacy',
      weight: 1,
      can_conceive: true,
      trait_weights: [
        { trait: 'charisma',     sign:  1 },
        { trait: 'empathy',      sign:  1 },
        { trait: 'loyalty',      sign:  1 },
        { trait: 'ambition',     sign:  1 },
        { trait: 'willpower',    sign:  1 },
        { trait: 'intelligence', sign:  1, multiplier: 0.5 },
      ],
      global_amplifiers: [
        { key: 'faith.spiritual_comfort', multiplier: 0.20 },
        { key: 'scarcity.food_supply',    multiplier: 0.15 },
        { key: 'plague.infection_rate',   multiplier: 0.15 },
      ],
    },
  ],

  // Ordered highest → lowest. First match wins.
  // Each band has *two* effect packets — subject_effect and antagonist_effect —
  // so world rules can modify the two sides of an interaction independently.
  // affects_stats entries that match person columns (e.g. current_health) are
  // applied directly to that column; trait keys go into the JSONB merge.
  outcome_bands: [
    {
      label:     'legendary',
      min_score:  400,
      magnitude:  1.0,
      subject_effect: {
        stat_delta:    [25, 40],
        affects_stats: ['current_health', 'resilience', 'charisma', 'ambition'],
        trait_deltas:  { courage: 2, ambition: 1, resilience: 1 },
      },
      antagonist_effect: {
        stat_delta:    [-25, -10],
        affects_stats: ['charisma', 'resilience'],
      },
      can_die:          false,
      creates_memory:   true,
      creates_headline: true,
    },
    {
      label:     'great',
      min_score:  200,
      magnitude:  0.75,
      subject_effect: {
        stat_delta:    [10, 25],
        affects_stats: ['current_health', 'resilience', 'charisma'],
      },
      antagonist_effect: {
        stat_delta:    [-10, -3],
        affects_stats: ['charisma', 'resilience'],
      },
      can_die:            false,
      creates_memory:     true,
      creates_headline:   false,
      // Only fires as a conception when the interaction type opts in
      // via `can_conceive` — see interactions.ts §3d gating.
      creates_pregnancy:  true,
    },
    {
      label:     'minor_good',
      min_score:   50,
      magnitude:  0.35,
      subject_effect: {
        stat_delta:    [3, 10],
        affects_stats: ['resilience'],
      },
      antagonist_effect: {
        stat_delta:    [-3, 0],
        affects_stats: ['resilience'],
      },
      can_die:          false,
      creates_memory:   false,
      creates_headline: false,
    },
    {
      label:     'neutral',
      min_score:  -50,
      magnitude:  0.0,
      subject_effect: {
        stat_delta:    [-2, 2],
        affects_stats: [],
      },
      can_die:          false,
      creates_memory:   false,
      creates_headline: false,
    },
    {
      label:     'minor_bad',
      min_score: -200,
      magnitude:  0.35,
      subject_effect: {
        stat_delta:    [-15, -5],
        affects_stats: ['current_health', 'resilience'],
      },
      antagonist_effect: {
        stat_delta:    [-3, 3],
        affects_stats: ['resilience'],
      },
      can_die:          false,
      creates_memory:   false,
      creates_headline: false,
    },
    {
      label:     'severe',
      min_score: -400,
      magnitude:  0.75,
      subject_effect: {
        stat_delta:    [-30, -15],
        affects_stats: ['current_health', 'resilience', 'charisma'],
        trait_deltas:  { courage: -1, resilience: -1 },
      },
      antagonist_effect: {
        stat_delta:    [-5, 5],
        affects_stats: ['charisma'],
      },
      can_die:          false,
      creates_memory:   true,
      creates_headline: false,
    },
    {
      label:     'catastrophic',
      min_score: -Infinity,
      magnitude:  1.0,
      subject_effect: {
        stat_delta:    [-60, -30],
        affects_stats: ['current_health', 'resilience', 'charisma'],
        trait_deltas:  { courage: -2, resilience: -2, empathy: -1 },
      },
      antagonist_effect: {
        stat_delta:    [-15, 5],
        affects_stats: ['charisma', 'loyalty'],
      },
      can_die:          true,
      creates_memory:   true,
      creates_headline: true,
    },
  ],

  capability_gates: {
    found_religion:   { ambition_min: 60, charisma_min: 55 },
    found_faction:    { ambition_min: 60, charisma_min: 55 },
    agentic_murder:   { loyalty_max: 25, bond_max: 15 },
    agentic_marry:    { bond_min: 80 },
    agentic_betray:   { bond_min: 75 },
    agentic_befriend: { bond_min: 55, bond_max: 74 },
    agentic_conceive: { bond_min: 60, enabled: true },
  },

  // Applied to every living person each tick. Formula per stat:
  //   drift = clamp(base + Σ(global[key] × multiplier), min, max)
  // 'current_health' applies directly to the column; trait keys hit JSONB.
  passive_drifts: [
    {
      stat: 'current_health',
      base:  0,
      inputs: [
        { key: 'plague.infection_rate', multiplier: 0.05 },
        { key: 'scarcity.food_supply',  multiplier: 0.01 },
      ],
      min: -5, max: 2,
    },
    {
      stat: 'resilience',
      base:  0,
      inputs: [
        { key: 'faith.spiritual_comfort', multiplier: 0.02 },
        { key: 'tyranny.oppression',      multiplier: 0.02 },
      ],
      min: -3, max: 2,
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
    return;
  }
  // Auto-upgrade the system-owned "Default" ruleset if it predates DEFAULT_RULESET.version.
  // User-authored rulesets are never touched.
  const sysDefault = await prisma.ruleset.findFirst({ where: { name: 'Default' } });
  if (sysDefault) {
    const existing = sysDefault.rules as unknown as { version?: number };
    if (!existing.version || existing.version < DEFAULT_RULESET.version) {
      await prisma.ruleset.update({
        where: { id: sysDefault.id },
        data:  { rules: DEFAULT_RULESET as object },
      });
    }
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

// ── POST /api/rulesets/:id/clone ────────────────────────────
router.post('/:id/clone', async (req: Request, res: Response) => {
  const source = await prisma.ruleset.findUniqueOrThrow({ where: { id: req.params.id } });
  const clone = await prisma.ruleset.create({
    data: {
      name:        `${source.name} (copy)`,
      description: source.description,
      is_active:   false,
      rules:       source.rules as Prisma.InputJsonValue,
    },
  });
  res.status(201).json(clone);
});

// ── DELETE /api/rulesets/:id ─────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  const target = await prisma.ruleset.findUniqueOrThrow({ where: { id: req.params.id } });
  if (target.is_active) { res.status(400).json({ error: 'Cannot delete the active ruleset' }); return; }
  await prisma.ruleset.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
