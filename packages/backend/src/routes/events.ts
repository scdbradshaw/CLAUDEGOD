// ============================================================
// /api/events — World event management
// Player activates/deactivates events from the catalog.
// Hard cap: MAX_ACTIVE_EVENTS (6) simultaneous active events.
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { getActiveWorld } from '../services/time.service';
import { EVENT_BY_ID, MAX_ACTIVE_EVENTS } from '@civ-sim/shared';
import type { EventDefId } from '@civ-sim/shared';
import { endEventAndArchive } from '../services/events.service';

const router = Router();

// ── GET /api/events ──────────────────────────────────────────
// Returns all active events for the current world.
router.get('/', async (_req: Request, res: Response) => {
  const world = await getActiveWorld();

  const events = await prisma.worldEvent.findMany({
    where:   { world_id: world.id, is_active: true },
    orderBy: { created_at: 'asc' },
    select: {
      id:              true,
      event_def_id:    true,
      params:          true,
      started_tick:    true,
      started_year:    true,
      duration_years:  true,
      years_remaining: true,
      is_active:       true,
    },
  });

  res.json(events);
});

// ── GET /api/events/history ──────────────────────────────────
// Returns completed events for the current world, newest first.
router.get('/history', async (_req: Request, res: Response) => {
  const world = await getActiveWorld();

  const history = await prisma.eventHistory.findMany({
    where:   { world_id: world.id },
    orderBy: { ended_year: 'desc' },
    select: {
      id:              true,
      event_def_id:    true,
      params:          true,
      started_year:    true,
      ended_year:      true,
      end_reason:      true,
      duration_actual: true,
      created_at:      true,
    },
  });

  res.json(history);
});

// ── POST /api/events ─────────────────────────────────────────
// Activate an event from the catalog.
// Body: { event_def_id: string, params: Record<string, unknown> }
router.post('/', async (req: Request, res: Response) => {
  const { event_def_id, params, duration_years } = req.body as {
    event_def_id:    string;
    params:          Record<string, unknown>;
    duration_years?: number | null;
  };

  if (!event_def_id || !params) {
    res.status(400).json({ error: 'event_def_id and params are required' });
    return;
  }

  // Phase 4: validate duration_years if supplied.
  let resolvedDuration: number | null = null;
  if (duration_years != null) {
    if (typeof duration_years !== 'number' || !Number.isFinite(duration_years) || duration_years <= 0) {
      res.status(400).json({ error: 'duration_years must be a positive number or null for indefinite' });
      return;
    }
    resolvedDuration = duration_years;
  }

  const def = EVENT_BY_ID[event_def_id as EventDefId];
  if (!def) {
    res.status(400).json({
      error:     `Unknown event type: "${event_def_id}"`,
      available: Object.keys(EVENT_BY_ID),
    });
    return;
  }

  const world = await getActiveWorld();

  // Enforce cap
  const activeCount = await prisma.worldEvent.count({
    where: { world_id: world.id, is_active: true },
  });
  if (activeCount >= MAX_ACTIVE_EVENTS) {
    res.status(409).json({
      error: `Maximum ${MAX_ACTIVE_EVENTS} events active at once. Disable one first.`,
    });
    return;
  }

  // Prevent running the same event type twice simultaneously
  const alreadyActive = await prisma.worldEvent.findFirst({
    where: { world_id: world.id, event_def_id, is_active: true },
  });
  if (alreadyActive) {
    res.status(409).json({ error: `"${def.name}" is already active.` });
    return;
  }

  const event = await prisma.worldEvent.create({
    data: {
      world_id:        world.id,
      event_def_id,
      params:          params as never,
      // Effective tick = year_count * 2 + bi_annual_index. Matches the
      // cadence used by Pregnancy.due_tick + the year.service pipeline.
      started_tick:    world.year_count * 2 + world.bi_annual_index,
      started_year:    world.current_year,
      duration_years:  resolvedDuration,
      years_remaining: resolvedDuration ?? 0,
      is_active:       true,
    },
    select: {
      id:              true,
      event_def_id:    true,
      params:          true,
      started_tick:    true,
      started_year:    true,
      duration_years:  true,
      years_remaining: true,
      is_active:       true,
    },
  });

  res.status(201).json(event);
});

// ── DELETE /api/events/:id ───────────────────────────────────
// Player-initiated end. Archives to event_history with end_reason='manual'.
router.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const world  = await getActiveWorld();

  const event = await prisma.worldEvent.findFirst({
    where: { id, world_id: world.id },
  });
  if (!event) {
    res.status(404).json({ error: 'Event not found' });
    return;
  }

  await endEventAndArchive(prisma, id, 'manual', world.current_year);

  res.json({ success: true });
});

export default router;
