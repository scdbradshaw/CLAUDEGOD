// ============================================================
// /api/factions — CRUD + dissolve + transfer leadership
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

const CreateFactionSchema = z.object({
  name:          z.string().min(1).max(120),
  description:   z.string().max(1000).optional(),
  founder_id:    z.string().uuid(),
  /** Optional — defaults to founder_id */
  leader_id:     z.string().uuid().optional(),
  tolerance:     z.number().int().min(0).max(100).default(10),
  virus_profile: VirusProfileSchema.default({}),
  origin:        z.enum(['emergent', 'player', 'event']).default('player'),
});

const PatchFactionSchema = z.object({
  name:           z.string().min(1).max(120).optional(),
  description:    z.string().max(1000).nullable().optional(),
  tolerance:      z.number().int().min(0).max(100).optional(),
  virus_profile:  VirusProfileSchema.optional(),
  leader_id:      z.string().uuid().nullable().optional(),
  cost_per_tick:  z.number().int().min(0).max(1000).optional(),
  trait_minimums: z.record(z.string(), z.number().min(0).max(100)).optional(),
});

const DissolveSchema = z.object({
  reason: z.string().min(1).max(120).default('player'),
});

// ── GET /api/factions ────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const world   = await getActiveWorld();
  const activeQ = req.query.active as string | undefined;
  const where: Prisma.FactionWhereInput = { world_id: world.id };
  if (activeQ === 'true')  where.is_active = true;
  if (activeQ === 'false') where.is_active = false;

  const factions = await prisma.faction.findMany({
    where,
    orderBy: { founded_year: 'asc' },
    include: {
      _count:  { select: { memberships: true } },
      founder: { select: { id: true, name: true } },
      leader:  { select: { id: true, name: true } },
    },
  });

  res.json(factions.map(f => ({
    ...f,
    virus_profile:  f.virus_profile  as unknown as VirusProfile,
    trait_minimums: f.trait_minimums as unknown as Record<string, number>,
    member_count:   f._count.memberships,
    created_at:     f.created_at.toISOString(),
    updated_at:     f.updated_at.toISOString(),
    _count:         undefined,
  })));
});

// ── GET /api/factions/:id ────────────────────────────────────
router.get('/:id', async (req: Request, res: Response) => {
  const faction = await prisma.faction.findUniqueOrThrow({
    where: { id: req.params.id },
    include: {
      founder:     { select: { id: true, name: true, age: true } },
      leader:      { select: { id: true, name: true, age: true } },
      memberships: {
        include: { person: { select: { id: true, name: true, age: true } } },
        orderBy: { alignment: 'desc' },
        take:    200,
      },
    },
  });

  res.json({
    ...faction,
    virus_profile:  faction.virus_profile  as unknown as VirusProfile,
    trait_minimums: faction.trait_minimums as unknown as Record<string, number>,
    member_count:   faction.memberships.length,
    created_at:     faction.created_at.toISOString(),
    updated_at:     faction.updated_at.toISOString(),
  });
});

// ── POST /api/factions ───────────────────────────────────────
router.post('/', validate(CreateFactionSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof CreateFactionSchema>;
  const world = await getActiveWorld();

  const founder = await prisma.person.findUnique({
    where: { id: body.founder_id },
    select: { id: true, health: true },
  });
  if (!founder)            { res.status(404).json({ error: 'Founder not found' }); return; }
  if (founder.health <= 0) { res.status(400).json({ error: 'Founder is deceased' }); return; }

  // If leader_id provided, verify alive; else fall back to founder
  const leaderId = body.leader_id ?? body.founder_id;
  if (leaderId !== body.founder_id) {
    const leader = await prisma.person.findUnique({
      where: { id: leaderId },
      select: { id: true, health: true },
    });
    if (!leader)            { res.status(404).json({ error: 'Leader not found' }); return; }
    if (leader.health <= 0) { res.status(400).json({ error: 'Leader is deceased' }); return; }
  }

  const faction = await prisma.faction.create({
    data: {
      name:          body.name,
      description:   body.description,
      founder_id:    body.founder_id,
      leader_id:     leaderId,
      origin:        body.origin,
      tolerance:     body.tolerance,
      virus_profile: body.virus_profile as Prisma.InputJsonValue,
      founded_year:  world.current_year,
      world_id:      world.id,
    },
  });

  res.status(201).json({
    ...faction,
    virus_profile: faction.virus_profile as unknown as VirusProfile,
    created_at:    faction.created_at.toISOString(),
    updated_at:    faction.updated_at.toISOString(),
  });
});

// ── PATCH /api/factions/:id ──────────────────────────────────
router.patch('/:id', validate(PatchFactionSchema), async (req: Request, res: Response) => {
  const body = req.body as z.infer<typeof PatchFactionSchema>;

  const updateData: Prisma.FactionUpdateInput = {};
  if (body.name           !== undefined) updateData.name           = body.name;
  if (body.description    !== undefined) updateData.description    = body.description;
  if (body.tolerance      !== undefined) updateData.tolerance      = body.tolerance;
  if (body.cost_per_tick  !== undefined) updateData.cost_per_tick  = body.cost_per_tick;
  if (body.virus_profile  !== undefined) updateData.virus_profile  = body.virus_profile as Prisma.InputJsonValue;
  if (body.trait_minimums !== undefined) updateData.trait_minimums = body.trait_minimums as Prisma.InputJsonValue;
  if (body.leader_id !== undefined) {
    updateData.leader = body.leader_id === null
      ? { disconnect: true }
      : { connect: { id: body.leader_id } };
  }

  const faction = await prisma.faction.update({
    where: { id: req.params.id },
    data:  updateData,
  });

  res.json({
    ...faction,
    virus_profile:  faction.virus_profile  as unknown as VirusProfile,
    trait_minimums: faction.trait_minimums as unknown as Record<string, number>,
    created_at:     faction.created_at.toISOString(),
    updated_at:     faction.updated_at.toISOString(),
  });
});

// ── POST /api/factions/:id/members ───────────────────────────
// Add a person to the faction.
router.post('/:id/members',
  validate(z.object({ person_id: z.string().uuid() })),
  async (req: Request, res: Response) => {
    const world  = await getActiveWorld();
    const person = await prisma.person.findUnique({
      where: { id: req.body.person_id },
      select: { id: true, health: true },
    });
    if (!person)            { res.status(404).json({ error: 'Person not found' }); return; }
    if (person.health <= 0) { res.status(400).json({ error: 'Person is deceased' }); return; }

    const membership = await prisma.factionMembership.upsert({
      where:  { faction_id_person_id: { faction_id: req.params.id, person_id: req.body.person_id } },
      create: { faction_id: req.params.id, person_id: req.body.person_id, joined_year: world.current_year },
      update: {},
    });
    res.status(201).json(membership);
  },
);

// ── DELETE /api/factions/:id/members/:personId ───────────────
// Remove (kick) a person from the faction.
router.delete('/:id/members/:personId', async (req: Request, res: Response) => {
  await prisma.factionMembership.deleteMany({
    where: { faction_id: req.params.id, person_id: req.params.personId },
  });
  res.status(204).send();
});

// ── POST /api/factions/:id/dissolve ─────────────────────────
router.post('/:id/dissolve', validate(DissolveSchema), async (req: Request, res: Response) => {
  const { reason } = req.body as z.infer<typeof DissolveSchema>;
  const world = await getActiveWorld();

  const faction = await prisma.faction.update({
    where: { id: req.params.id },
    data:  {
      is_active:        false,
      dissolved_year:   world.current_year,
      dissolved_reason: reason,
    },
  });

  res.json({
    ...faction,
    virus_profile: faction.virus_profile as unknown as VirusProfile,
    created_at:    faction.created_at.toISOString(),
    updated_at:    faction.updated_at.toISOString(),
  });
});

// ── DELETE /api/factions/:id ─────────────────────────────────
router.delete('/:id', async (req: Request, res: Response) => {
  await prisma.faction.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
