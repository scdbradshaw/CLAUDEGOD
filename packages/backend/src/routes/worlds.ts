// ============================================================
// /api/worlds — World CRUD + activate + archive (Phase 4)
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import {
  DEFAULT_GLOBAL_TRAITS,
  DEFAULT_GLOBAL_TRAIT_MULTIPLIERS,
} from '@civ-sim/shared';

const router = Router();

// ── GET /api/worlds ──────────────────────────────────────────
// Returns all worlds with population counts.
router.get('/', async (_req: Request, res: Response) => {
  const worlds = await prisma.world.findMany({
    orderBy: [{ is_active: 'desc' }, { created_at: 'asc' }],
    include: {
      ruleset: { select: { id: true, name: true } },
      _count:  { select: { persons: true } },
    },
  });

  res.json(worlds.map(w => ({
    id:               w.id,
    name:             w.name,
    description:      w.description,
    is_active:        w.is_active,
    archived_at:      w.archived_at,
    population_tier:  w.population_tier,
    ruleset_id:       w.ruleset_id,
    ruleset_name:     w.ruleset?.name ?? null,
    current_year:     w.current_year,
    tick_count:       w.tick_count,
    total_deaths:     w.total_deaths,
    population:       w._count.persons,
    created_at:       w.created_at,
    updated_at:       w.updated_at,
  })));
});

// ── POST /api/worlds ─────────────────────────────────────────
// Create a new (inactive) world.
router.post('/', async (req: Request, res: Response) => {
  const {
    name,
    description,
    population_tier = 'intimate',
    ruleset_id,
  } = req.body as {
    name:             string;
    description?:     string;
    population_tier?: 'intimate' | 'town' | 'civilization';
    ruleset_id?:      string;
  };

  if (!name?.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }

  const world = await prisma.world.create({
    data: {
      name:                     name.trim(),
      description,
      is_active:                false,
      population_tier:          population_tier as any,
      ruleset_id:               ruleset_id ?? null,
      current_year:             1,
      tick_count:               0,
      total_deaths:             0,
      market_index:             100.0,
      market_trend:             0.015,
      market_volatility:        0.03,
      global_traits:            DEFAULT_GLOBAL_TRAITS,
      global_trait_multipliers: DEFAULT_GLOBAL_TRAIT_MULTIPLIERS,
      active_trait_categories:  [],
    },
  });

  res.status(201).json(world);
});

// ── GET /api/worlds/:id ──────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const world = await prisma.world.findUniqueOrThrow({
    where:   { id: req.params.id },
    include: {
      ruleset: { select: { id: true, name: true } },
      _count:  { select: { persons: true } },
    },
  });
  res.json(world);
});

// ── PATCH /api/worlds/:id ────────────────────────────────────
// Update name, description, ruleset.
router.patch('/:id', async (req: Request, res: Response) => {
  const { name, description, ruleset_id, population_tier } = req.body as {
    name?:             string;
    description?:      string;
    ruleset_id?:       string | null;
    population_tier?:  string;
  };

  const world = await prisma.world.update({
    where: { id: req.params.id },
    data: {
      ...(name            !== undefined && { name }),
      ...(description     !== undefined && { description }),
      ...(ruleset_id      !== undefined && { ruleset_id }),
      ...(population_tier !== undefined && { population_tier: population_tier as any }),
    },
  });

  res.json(world);
});

// ── POST /api/worlds/:id/activate ───────────────────────────
// Switch to a different world. Deactivates all others.
router.post('/:id/activate', async (req: Request, res: Response) => {
  const target = await prisma.world.findUniqueOrThrow({ where: { id: req.params.id } });

  if (target.archived_at) {
    res.status(400).json({ error: 'Cannot activate an archived world' });
    return;
  }

  await prisma.$transaction([
    prisma.world.updateMany({ where: {},                         data: { is_active: false } }),
    prisma.world.update    ({ where: { id: req.params.id },      data: { is_active: true  } }),
  ]);

  const updated = await prisma.world.findUniqueOrThrow({ where: { id: req.params.id } });
  res.json(updated);
});

// ── POST /api/worlds/:id/archive ────────────────────────────
// Archive a world (soft-delete, retains all data).
router.post('/:id/archive', async (req: Request, res: Response) => {
  const target = await prisma.world.findUniqueOrThrow({ where: { id: req.params.id } });

  if (target.is_active) {
    res.status(400).json({ error: 'Cannot archive the active world — activate another world first' });
    return;
  }

  const world = await prisma.world.update({
    where: { id: req.params.id },
    data:  { archived_at: new Date() },
  });

  res.json(world);
});

// ── POST /api/worlds/:id/unarchive ──────────────────────────
router.post('/:id/unarchive', async (req: Request, res: Response) => {
  const world = await prisma.world.update({
    where: { id: req.params.id },
    data:  { archived_at: null },
  });
  res.json(world);
});

// ── DELETE /api/worlds/:id ───────────────────────────────────
// Hard delete — removes all associated persons, groups, etc. via CASCADE.
router.delete('/:id', async (req: Request, res: Response) => {
  const target = await prisma.world.findUniqueOrThrow({ where: { id: req.params.id } });

  if (target.is_active) {
    res.status(400).json({ error: 'Cannot delete the active world' });
    return;
  }

  await prisma.world.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
