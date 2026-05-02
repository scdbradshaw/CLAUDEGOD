// Events router (Phase 8).
//
// GET    /api/events?world_id=...&kind=...&active=...
// GET    /api/events/:id
// POST   /api/events           (player drop / god-override)
// POST   /api/events/:id/end   (manual end)

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { EVENT_TYPES } from '@claude-god/shared';
import { prisma } from '../lib/prisma';
import {
  dropEvent,
  endEventTx,
  getEvent,
  listEvents,
} from '../services/event.service';
import { getEventDef, listEventDefs } from '../engine/events/catalog';

export const eventsRouter = Router();

const ListQuery = z.object({
  world_id: z.string().uuid(),
  kind: z.enum(EVENT_TYPES).optional(),
  active: z.enum(['true', 'false']).optional(),
});

eventsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const { world_id, kind, active } = parsed.data;
  const rows = await listEvents({
    world_id,
    kind,
    active: active === undefined ? undefined : active === 'true',
  });
  res.json({ rows });
});

// God-Mode: read-only event catalog. Must precede '/:id' so it isn't shadowed.
eventsRouter.get('/catalog', async (_req: Request, res: Response) => {
  res.json({ rows: listEventDefs() });
});

eventsRouter.get('/:id', async (req: Request, res: Response) => {
  const ev = await getEvent(req.params.id);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  res.json(ev);
});

const DropBody = z
  .object({
    world_id: z.string().uuid(),
    event_def_id: z.enum(EVENT_TYPES),
    city_id: z.string().uuid().optional(),
    faction_id: z.string().uuid().optional(),
    year: z.number().int().min(0),
  })
  .superRefine((val, ctx) => {
    const def = getEventDef(val.event_def_id);
    if (!def) return;
    if (def.scope === 'city' && !val.city_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'city_id_required_for_city_scoped_event',
      });
    }
    if (def.scope === 'faction' && !val.faction_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'faction_id_required_for_faction_scoped_event',
      });
    }
  });

eventsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = DropBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const result = await dropEvent({ ...parsed.data, source: 'player' });
  if (result.status === 'rejected') {
    return res.status(409).json({ error: 'event_rejected', reason: result.reason });
  }
  if (result.status === 'queued') {
    return res.status(202).json({ status: 'queued' });
  }
  res.status(201).json(result);
});

const EndBody = z.object({ year: z.number().int().min(0) });

eventsRouter.post('/:id/end', async (req: Request, res: Response) => {
  const parsed = EndBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const ev = await getEvent(req.params.id);
  if (!ev) return res.status(404).json({ error: 'event_not_found' });
  if (ev.ended_year != null) {
    return res.status(409).json({ error: 'event_already_ended' });
  }
  await prisma.$transaction((tx) =>
    endEventTx({ event_id: ev.id, year: parsed.data.year, end_reason: 'manual' }, tx),
  );
  res.json({ status: 'ended' });
});
