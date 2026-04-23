// ============================================================
// /api/religions — CRUD + dissolve
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { validate } from '../middleware/validate';
import { getActiveWorld } from '../services/time.service';
import type { VirusProfile } from '@civ-sim/shared';

const router = Router();

// ── Shared schemas ──────────────────────────────────────────

const VirusThresholdSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
}).refine(v => v.min !== undefined || v.max !== undefined, {
  message: 'Threshold must set at least one of min/max',
});

const VirusProfileSchema = z.record(z.string(), VirusThresholdSchema);

const CreateReligionSchema = z.object({
  name:          z.string().min(1).max(120),
  description:   z.string().max(1000).optional(),
  founder_id:    z.string().uuid(),
  tolerance:     z.number().int().min(0).max(100).default(10),
  virus_profile: VirusProfileSchema.default({}),
  origin:        z.enum(['emergent', 'player', 'event']).default('player'),
});

const PatchReligionSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  description:    z.string().max(1000).nullable().optional(),
  tolerance:      z.number().int().min(0).max(100).optional(),
  virus_profile:  VirusProfileSchema.optional(),
  cost_per_tick:  z.number().int().min(0).max(1000).optional(),
  trait_minimums: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

const DissolveSchema = z.object({
  reason: z.string().min(1).max(120).default('player'),
});

// ── GET /api/religions ───────────────────────────────────────
// Query: ?active=true|false (default: all)
router.get('/', async (req: Request, res: Response) => {
  const world   = await getActiveWorld();
  const activeQ = req.query.active as string | undefined;
  const where: Prisma.ReligionWhereInput = { world_id: world.id };
  if (activeQ === 'true')  where.is_active = true;
  if (activeQ === 'false') where.is_active = false;

  const religions = await prisma.religion.findMany({
    where,
    orderBy: { founded_year: 'asc' },
    include: {
      _count: { select: { memberships: true } },
      founder: { select: { id: true, name: true } },
    },
  });

  res.json(religions.map(r => ({
    ...r,
    virus_profile:  r.virus_profile  as unknown as VirusProfile,
    trait_minimums: r.trait_minimums as unknown as Record<string, number>,
    member_count:   r._count.memberships,
    created_at:     r.created_at.toISOString(),
    updated_at:     r.updated_at.toISOString(),
    _count:         undefined,
  })));
});

// ── GET /api/religions/:id ───────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const religion = await prisma.religion.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      founder:     { select: { id: true, name: true, age: true } },
      memberships: {
        include: { person: { select: { id: true, name: true, age: true } } },
        orderBy: { alignment: 'desc' },
        take:    200,
      },
    },
  });

  res.json({
    ...religion,
    virus_profile:  religion.virus_profile  as unknown as VirusProfile,
    trait_minimums: religion.trait_minimums as unknown as Record<string, number>,
    member_count:   religion.memberships.length,
    created_at:     religion.created_at.toISOString(),
    updated_at:     religion.updated_at.toISOString(),
  });
});

// ── POST /api/religions ──────────────────────────────────────
// Player-authored creation. Emergent creation happens in the tick engine.
router.post('/', validate(CreateReligionSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof CreateReligionSchema>;
  const world = await getActiveWorld();

  // Verify founder exists and is alive
  const founder = await prisma.person.findUnique({
    where: { id: body.founder_id },
    select: { id: true, current_health: true },
  });
  if (!founder)            { res.status(404).json({ error: 'Founder not found' }); return; }
  if (founder.current_health <= 0) { res.status(400).json({ error: 'Founder is deceased' }); return; }

  const religion = await prisma.religion.create({
    data: {
      name:          body.name,
      description:   body.description,
      founder_id:    body.founder_id,
      origin:        body.origin,
      tolerance:     body.tolerance,
      virus_profile: body.virus_profile as Prisma.InputJsonValue,
      founded_year:  world.current_year,
      world_id:      world.id,
    },
  });

  res.status(201).json({
    ...religion,
    virus_profile: religion.virus_profile as unknown as VirusProfile,
    created_at:    religion.created_at.toISOString(),
    updated_at:    religion.updated_at.toISOString(),
  });
});

// ── PATCH /api/religions/:id ─────────────────────────────────
router.patch('/:id', validate(PatchReligionSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof PatchReligionSchema>;

  const updateData: Prisma.ReligionUpdateInput = {};
  if (body.name           !== undefined) updateData.name           = body.name;
  if (body.description    !== undefined) updateData.description    = body.description;
  if (body.tolerance      !== undefined) updateData.tolerance      = body.tolerance;
  if (body.cost_per_tick  !== undefined) updateData.cost_per_tick  = body.cost_per_tick;
  if (body.virus_profile  !== undefined) updateData.virus_profile  = body.virus_profile as Prisma.InputJsonValue;
  if (body.trait_minimums !== undefined) updateData.trait_minimums = body.trait_minimums as Prisma.InputJsonValue;

  const religion = await prisma.religion.update({
    where: { id: req.params.id },
    data:  updateData,
  });

  res.json({
    ...religion,
    virus_profile:  religion.virus_profile  as unknown as VirusProfile,
    trait_minimums: religion.trait_minimums as unknown as Record<string, number>,
    created_at:     religion.created_at.toISOString(),
    updated_at:     religion.updated_at.toISOString(),
  });
});

// ── POST /api/religions/:id/members ─────────────────────────
// Add a person to the religion.
router.post('/:id/members',
  validate(z.object({ person_id: z.string().uuid() })),
  async (req: Request, res: Response) => {
    const world  = await getActiveWorld();
    const person = await prisma.person.findUnique({
      where: { id: req.body.person_id },
      select: { id: true, current_health: true },
    });
    if (!person)            { res.status(404).json({ error: 'Person not found' }); return; }
    if (person.current_health <= 0) { res.status(400).json({ error: 'Person is deceased' }); return; }

    const membership = await prisma.religionMembership.upsert({
      where:  { religion_id_person_id: { religion_id: req.params.id, person_id: req.body.person_id } },
      create: { religion_id: req.params.id, person_id: req.body.person_id, joined_year: world.current_year },
      update: {},
    });
    res.status(201).json(membership);
  },
);

// ── DELETE /api/religions/:id/members/:personId ──────────────
// Remove (kick) a person from the religion.
router.delete('/:id/members/:personId', async (req: Request, res: Response) => {
  await prisma.religionMembership.deleteMany({
    where: { religion_id: req.params.id, person_id: req.params.personId },
  });
  res.status(204).send();
});

// ── POST /api/religions/:id/dissolve ────────────────────────
// Soft dissolve — marks is_active=false, records reason + year.
router.post('/:id/dissolve', validate(DissolveSchema), async (req: Request, res: Response) => {
  const { reason } = req.body as z.infer<typeof DissolveSchema>;
  const world = await getActiveWorld();

  const religion = await prisma.religion.update({
    where: { id: req.params.id },
    data:  {
      is_active:        false,
      dissolved_year:   world.current_year,
      dissolved_reason: reason,
    },
  });

  res.json({
    ...religion,
    virus_profile: religion.virus_profile as unknown as VirusProfile,
    created_at:    religion.created_at.toISOString(),
    updated_at:    religion.updated_at.toISOString(),
  });
});

// ── DELETE /api/religions/:id ────────────────────────────────
// Hard delete — cascades memberships. Reserved for player cleanup.
router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.religion.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
