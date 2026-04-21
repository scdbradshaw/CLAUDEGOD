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
import { getActiveWorld } from '../services/time.service';
import { listForPerson as listRelationshipsForPerson } from '../services/relationships.service';
import { Prisma } from '@prisma/client';

const router = Router();

// ── GET /api/characters ──────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
  const skip  = (page - 1) * limit;

  const world = await getActiveWorld();

  const [persons, total] = await Promise.all([
    prisma.person.findMany({
      where:   { world_id: world.id },
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
    prisma.person.count({ where: { world_id: world.id } }),
  ]);

  res.json({
    data:  persons.map((p) => ({ ...p, updated_at: p.updated_at.toISOString() })),
    total,
    page,
    limit,
  });
});

// ── GET /api/characters/search ───────────────────────────────
// Filter-first listing used by the /people page. All filter params are
// optional — absent means no constraint. Kept separate from the lean
// `GET /` so the dashboard keeps its fast path.
//
// Query params:
//   status    = alive | dead | all           (default alive)
//   age_min, age_max                         (inclusive, ints)
//   races     = csv                          (match any)
//   religions = csv                          (match any)
//   factions  = csv of faction UUIDs         (active memberships only)
//   q         = name substring (case-insensitive)
//   sort      = name|age|morality|wealth|influence|health|updated_at
//   order     = asc|desc                     (default desc for updated_at, else asc)
//   page, limit                              (limit capped at 200)
router.get('/search', async (req: Request, res: Response) => {
  const world = await getActiveWorld();

  const page  = Math.max(1, parseInt(req.query.page  as string) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 40));
  const skip  = (page - 1) * limit;

  const status = (req.query.status as string) || 'alive';
  const ageMin = req.query.age_min ? parseInt(req.query.age_min as string) : undefined;
  const ageMax = req.query.age_max ? parseInt(req.query.age_max as string) : undefined;
  const races     = csv(req.query.races);
  const religions = csv(req.query.religions);
  const factions  = csv(req.query.factions);
  const q         = (req.query.q as string)?.trim();

  const sortField = (req.query.sort as string) || 'updated_at';
  const orderDir  = (req.query.order as string) === 'asc' ? 'asc' : (req.query.order as string) === 'desc' ? 'desc' : (sortField === 'updated_at' ? 'desc' : 'asc');

  const SORT_FIELD_MAP: Record<string, keyof Prisma.PersonOrderByWithRelationInput> = {
    name:       'name',
    age:        'age',
    morality:   'morality',
    wealth:     'wealth',
    influence:  'influence',
    health:     'health',
    updated_at: 'updated_at',
  };
  const orderBy: Prisma.PersonOrderByWithRelationInput = {
    [SORT_FIELD_MAP[sortField] ?? 'updated_at']: orderDir as 'asc' | 'desc',
  };

  const where: Prisma.PersonWhereInput = { world_id: world.id };
  if (status === 'alive') where.health = { gt: 0 };
  if (status === 'dead')  where.health = { equals: 0 };
  if (ageMin !== undefined || ageMax !== undefined) {
    where.age = {
      ...(ageMin !== undefined ? { gte: ageMin } : {}),
      ...(ageMax !== undefined ? { lte: ageMax } : {}),
    };
  }
  if (races.length)     where.race     = { in: races };
  if (religions.length) where.religion = { in: religions };
  if (q)                where.name     = { contains: q, mode: 'insensitive' };
  if (factions.length) {
    where.faction_memberships = { some: { faction_id: { in: factions } } };
  }

  const [persons, total] = await Promise.all([
    prisma.person.findMany({
      where, skip, take: limit, orderBy,
      select: {
        id:            true,
        name:          true,
        age:           true,
        gender:        true,
        race:          true,
        religion:      true,
        health:        true,
        morality:      true,
        happiness:     true,
        influence:     true,
        wealth:        true,
        updated_at:    true,
        global_scores: true,
        faction_memberships: {
          select: { faction: { select: { id: true, name: true, is_active: true } } },
        },
      },
    }),
    prisma.person.count({ where }),
  ]);

  res.json({
    data: persons.map(p => ({
      ...p,
      updated_at: p.updated_at.toISOString(),
      factions:   p.faction_memberships
        .filter(m => m.faction.is_active)
        .map(m => ({ id: m.faction.id, name: m.faction.name })),
      faction_memberships: undefined,
    })),
    total, page, limit,
  });
});

function csv(v: unknown): string[] {
  if (typeof v !== 'string' || !v.trim()) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

// ── GET /api/characters/:id ──────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const person = await prisma.person.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { memory_bank: { orderBy: { timestamp: 'desc' }, take: 50 } },
  });

  res.json({
    ...person,
    criminal_record: person.criminal_record as unknown as CriminalRecord[],
    created_at: person.created_at.toISOString(),
    updated_at: person.updated_at.toISOString(),
    memory_bank: person.memory_bank.map((m) => ({
      ...m,
      timestamp: m.timestamp.toISOString(),
    })),
  });
});

// ── GET /api/characters/:id/relationships (Phase 7 Wave 2) ───
// Returns the owner's outgoing relationship graph — strongest-from-neutral
// edges first. Used by CharacterDetail's new Relationships panel.
router.get('/:id/relationships', async (req: Request, res: Response) => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? 24)) || 24);
  const rows = await listRelationshipsForPerson(req.params.id, limit);
  res.json(rows);
});

// ── Seed counts per population tier ──────────────────────────
// Drives GET /api/characters/seed — an empty world seeds to the middle
// of its tier's range, giving the player something to work with without
// over-committing. A /bulk call can still stretch higher post-seed.
const SEED_COUNT_BY_TIER: Record<'intimate' | 'town' | 'civilization', number> = {
  intimate:      250,
  town:          2000,
  civilization:  5000,
};

// ── GET /api/characters/seed ─────────────────────────────────
router.get('/seed', async (_req: Request, res: Response) => {
  const world = await getActiveWorld();
  const existing = await prisma.person.count({ where: { world_id: world.id } });
  if (existing > 0) {
    res.json({ seeded: false, count: existing });
    return;
  }

  const worldTraits = world.global_traits as Record<string, number>;
  const seedCount = SEED_COUNT_BY_TIER[world.population_tier as keyof typeof SEED_COUNT_BY_TIER] ?? 250;
  const people = Array.from({ length: seedCount }, () => generateCharacter(undefined, worldTraits));

  const result = await prisma.person.createMany({
    data: people.map(p => ({
      ...p,
      world_id:        world.id,
      criminal_record: p.criminal_record as Prisma.InputJsonValue,
      traits:          p.traits          as Prisma.InputJsonValue,
      global_scores:   p.global_scores   as Prisma.InputJsonValue,
    })),
  });

  res.status(201).json({ seeded: true, count: result.count, tier: world.population_tier });
});

// ── POST /api/characters/bulk ────────────────────────────────
router.post('/bulk', validate(BulkCreateSchema), async (req: Request, res: Response) => {
  const { count, archetype } = req.body as { count: number; archetype?: string };

  if (archetype && !ARCHETYPE_LABELS.includes(archetype)) {
    res.status(400).json({ error: `Unknown archetype. Valid: ${ARCHETYPE_LABELS.join(', ')}` });
    return;
  }

  const world       = await getActiveWorld();
  const worldTraits = world.global_traits as Record<string, number>;
  const people = Array.from({ length: count }, () => generateCharacter(archetype, worldTraits));

  const result = await prisma.person.createMany({
    data: people.map(p => ({
      ...p,
      world_id:        world.id,
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
  const world = await getActiveWorld();

  const person = await prisma.person.create({
    data: {
      ...rest,
      world_id:        world.id,
      criminal_record: (criminal_record ?? []) as Prisma.InputJsonValue,
    },
  });

  res.status(201).json({
    ...person,
    criminal_record: person.criminal_record as unknown as CriminalRecord[],
    created_at: person.created_at.toISOString(),
    updated_at: person.updated_at.toISOString(),
  });
});

// ── POST /api/characters/:id/delta ───────────────────────────
router.post(
  '/:id/delta',
  validate(DeltaRequestSchema),
  async (req: Request, res: Response) => {
    const { delta, event_summary, emotional_impact, force, tone } = req.body;

    const result = await applyDelta({
      personId: req.params.id,
      delta,
      event_summary,
      emotional_impact,
      force: force === true,
      tone,
    });

    res.json(result);
  },
);

// ── POST /api/characters/:id/criminal-record ─────────────────
router.post(
  '/:id/criminal-record',
  validate(CriminalRecordRequestSchema),
  async (req: Request, res: Response) => {
    const { record, event_summary, tone } = req.body;
    const result = await addCriminalRecord(req.params.id, record, event_summary, tone);
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
