// ============================================================
// /api/characters — CRUD + delta endpoint
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
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
        wealth:        true,
        updated_at:    true,
        global_scores: true,
        traits:        true,
        occupation:    true,
        race:          true,
        religion:      true,
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
//   sort      = name|age|wealth|health|updated_at
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
    wealth:     'wealth',
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
        wealth:        true,
        traits:        true,
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

// ── Seed counts per population tier ──────────────────────────
const SEED_COUNT_BY_TIER: Record<'intimate' | 'town' | 'civilization', number> = {
  intimate:      250,
  town:          2000,
  civilization:  5000,
};

// ── GET /api/characters/seed ─────────────────────────────────
// NOTE: must be registered BEFORE /:id to avoid being swallowed by the
// dynamic route.
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

// ── GET /api/characters/:id/lineage (Round 2) ────────────────
// Returns immediate genealogy: parents (by parent_a_id/parent_b_id) and
// children (reverse of either self-relation). Dead parents/children are
// NOT included — the self-relations are SET NULL on delete and only living
// persons stay in the `persons` table (deceased migrate to deceased_persons).
router.get('/:id/lineage', async (req: Request, res: Response) => {
  const person = await prisma.person.findUnique({
    where:  { id: req.params.id },
    select: {
      parent_a: { select: { id: true, name: true, age: true, health: true, race: true, religion: true } },
      parent_b: { select: { id: true, name: true, age: true, health: true, race: true, religion: true } },
      children_a: { select: { id: true, name: true, age: true, health: true, race: true, religion: true } },
      children_b: { select: { id: true, name: true, age: true, health: true, race: true, religion: true } },
    },
  });
  if (!person) { res.status(404).json({ error: 'Person not found' }); return; }

  const parents = [person.parent_a, person.parent_b].filter((p): p is NonNullable<typeof p> => p !== null);
  // Dedupe children in case both parent slots point at the same subject
  // (shouldn't happen, but cheap to guard).
  const childMap = new Map<string, typeof person.children_a[number]>();
  for (const c of [...person.children_a, ...person.children_b]) childMap.set(c.id, c);
  const children = [...childMap.values()].sort((a, b) => a.age - b.age);

  res.json({ parents, children });
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

// ── POST /api/characters/bulk-kill ───────────────────────────
// Randomly selects N living persons and kills them (god mode).
// Creates DeceasedPerson records + updates world death count.
router.post('/bulk-kill',
  validate(z.object({ count: z.number().int().min(1).max(1000) })),
  async (req: Request, res: Response) => {
    try {
      const world = await getActiveWorld();
      const count = req.body.count as number;

      const targets = await prisma.$queryRaw<
        Array<{ id: string; name: string; age: number; wealth: number }>
      >(
        Prisma.sql`
          SELECT id, name, age, wealth
          FROM persons
          WHERE world_id = ${world.id}::uuid AND health > 0
          ORDER BY RANDOM()
          LIMIT ${Prisma.raw(String(count))}
        `
      );

      if (targets.length === 0) {
        res.json({ killed: 0, names: [] });
        return;
      }

      const ids = targets.map((t) => t.id);

      await prisma.$transaction(async (tx) => {
        await tx.deceasedPerson.createMany({
          data: targets.map((p) => ({
            name:         p.name,
            age_at_death: p.age,
            world_year:   world.current_year,
            cause:        'god_mode',
            final_health: 0,
            final_wealth: typeof p.wealth === 'number' ? p.wealth : parseFloat(String(p.wealth)),
            world_id:     world.id,
          })),
        });
        await tx.person.deleteMany({ where: { id: { in: ids } } });
        await tx.world.update({
          where: { id: world.id },
          data:  { total_deaths: { increment: targets.length } },
        });
      });

      res.json({ killed: targets.length, names: targets.map((t) => t.name) });
    } catch (err) {
      console.error('[bulk-kill] error:', err);
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  },
);

export default router;
