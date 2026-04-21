// ============================================================
// /api/characters — CRUD + delta endpoint
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { applyDelta, addCriminalRecord } from '../services/simulation.service';
import { validate } from '../middleware/validate';
import {
  CreatePersonSchema,
  DeltaRequestSchema,
  CriminalRecordRequestSchema,
  BulkCreateSchema,
  type CriminalRecord,
} from '../types/person';
import { generateCharacter, ARCHETYPE_LABELS } from '../services/character-gen.service';
import { getWorldState } from '../services/time.service';
import { Prisma } from '@prisma/client';

const router = Router();

// ── GET /api/characters ──────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const skip  = (page - 1) * limit;

  const [persons, total] = await Promise.all([
    prisma.person.findMany({
      skip,
      take:    limit,
      orderBy: { updated_at: 'desc' },
      select: {
        id:            true,
        name:          true,
        age:           true,
        health:        true,
        happiness:     true,
        wealth:        true,
        updated_at:    true,
        global_scores: true,
      },
    }),
    prisma.person.count(),
  ]);

  res.json({
    data:  persons.map((p) => ({ ...p, updated_at: p.updated_at.toISOString() })),
    total,
    page,
    limit,
  });
});

// ── GET /api/characters/:id ──────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { memory_bank: { orderBy: { timestamp: 'desc' }, take: 50 } },
  });

  res.json({
    ...person,
    criminal_record: person.criminal_record as CriminalRecord[],
    created_at: person.created_at.toISOString(),
    updated_at: person.updated_at.toISOString(),
    memory_bank: person.memory_bank.map((m) => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    })),
  });
});

// ── GET /api/characters/seed ─────────────────────────────────
// Seeds 100 random characters if the world is empty, no-op otherwise.
router.get('/seed', async (_req: Request, res: Response) => {
  const existing = await prisma.person.count();
  if (existing > 0) {
    res.json({ seeded: false, count: existing });
    return;
  }

  const world      = await getWorldState();
  const worldTraits = world.global_traits as Record<string, number>;
  const people = Array.from({ length: 100 }, () => generateCharacter(undefined, worldTraits));

  const result = await prisma.person.createMany({
    data: people.map(p => ({
      ...p,
      criminal_record: p.criminal_record as Prisma.InputJsonValue,
      traits:          p.traits          as Prisma.InputJsonValue,
      global_scores:   p.global_scores   as Prisma.InputJsonValue,
    })),
  });

  res.status(201).json({ seeded: true, count: result.count });
});

// ── POST /api/characters/bulk ────────────────────────────────
router.post('/bulk', validate(BulkCreateSchema), async (req: Request, res: Response) => {
  const { count, archetype } = req.body as { count: number; archetype?: string };

  if (archetype && !ARCHETYPE_LABELS.includes(archetype)) {
    res.status(400).json({ error: `Unknown archetype. Valid: ${ARCHETYPE_LABELS.join(', ')}` });
    return;
  }

  const world       = await getWorldState();
  const worldTraits = world.global_traits as Record<string, number>;
  const people = Array.from({ length: count }, () => generateCharacter(archetype, worldTraits));

  const result = await prisma.person.createMany({
    data: people.map(p => ({
      ...p,
      criminal_record: p.criminal_record as Prisma.InputJsonValue,
      traits:          p.traits          as Prisma.InputJsonValue,
      global_scores:   p.global_scores   as Prisma.InputJsonValue,
    })),
    skipDuplicates: false,
  });

  res.status(201).json({ created: result.count });
});

// ── POST /api/characters ─────────────────────────────────────
router.post('/', validate(CreatePersonSchema), async (req: Request, res: Response) => {
  const { criminal_record, ...rest } = req.body;

  const person = await prisma.person.create({
    data: {
      ...rest,
      criminal_record: (criminal_record ?? []) as Prisma.InputJsonValue,
    },
  });

  res.status(201).json({
    ...person,
    criminal_record: person.criminal_record as CriminalRecord[],
    created_at: person.created_at.toISOString(),
    updated_at: person.updated_at.toISOString(),
  });
});

// ── POST /api/characters/:id/delta ───────────────────────────
// Applies a simulation delta (with rules enforced unless force=true)
router.post(
  '/:id/delta',
  validate(DeltaRequestSchema),
  async (req: Request, res: Response) => {
    const { delta, event_summary, emotional_impact, force } = req.body;

    const result = await applyDelta({
      personId: req.params.id,
      delta,
      event_summary,
      emotional_impact,
      force: force === true,
    });

    res.json(result);
  },
);

// ── POST /api/characters/:id/criminal-record ─────────────────
router.post(
  '/:id/criminal-record',
  validate(CriminalRecordRequestSchema),
  async (req: Request, res: Response) => {
    const { record, event_summary } = req.body;

    const result = await addCriminalRecord(req.params.id, record, event_summary);
    res.json(result);
  },
);

// ── GET /api/characters/:id/memory ───────────────────────────
router.get('/:id/memory', async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
  const skip  = (page - 1) * limit;

  const [entries, total] = await Promise.all([
    prisma.memoryBank.findMany({
      where:   { person_id: req.params.id },
      orderBy: { timestamp: 'desc' },
      skip,
      take:    limit,
    }),
    prisma.memoryBank.count({ where: { person_id: req.params.id } }),
  ]);

  res.json({
    data:  entries.map((e) => ({ ...e, timestamp: e.timestamp.toISOString() })),
    total,
    page,
    limit,
  });
});

// ── DELETE /api/characters/:id ───────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.person.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
