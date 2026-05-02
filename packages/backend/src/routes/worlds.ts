// Worlds router (Phase 2).
//
// POST /worlds       — create + seed a new world
// GET  /worlds/:id   — fetch world + city + buckets

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { GROUP_KINDS, REGION_RESOURCES } from '@claude-god/shared';
import { createWorld, getWorld, listWorlds, updateWorld } from '../services/world.service';
import { prisma } from '../lib/prisma';

export const worldsRouter = Router();

const CreateWorldBody = z.object({
  name: z.string().min(1).max(100),
  city_name: z.string().min(1).max(100),
  region_resource: z.enum(REGION_RESOURCES).optional(),
  seed_population: z.number().int().min(0).max(1_000_000).optional(),
  /** BigInt over JSON: accept string of digits and parse. */
  random_seed_root: z
    .string()
    .regex(/^\d+$/)
    .optional(),
});

worldsRouter.get('/', async (_req: Request, res: Response) => {
  const rows = await listWorlds();
  res.json({ worlds: rows });
});

worldsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateWorldBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const { random_seed_root, ...rest } = parsed.data;
  const result = await createWorld({
    ...rest,
    random_seed_root: random_seed_root != null ? BigInt(random_seed_root) : undefined,
  });
  res.status(201).json(serializeWorldResponse(result));
});

worldsRouter.get('/:id', async (req: Request, res: Response) => {
  const result = await getWorld(req.params.id);
  if (!result) return res.status(404).json({ error: 'world_not_found' });
  res.json(serializeWorldResponse(result));
});

const PatchWorldBody = z
  .object({
    name: z.string().min(1).max(100).optional(),
    prejudice_against_same_sex: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'no_fields_to_update' });

worldsRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = PatchWorldBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const updated = await updateWorld(req.params.id, parsed.data);
  if (!updated) return res.status(404).json({ error: 'world_not_found' });
  res.json({ world: updated });
});

// ─── Mini list endpoints (for picker dropdowns) ───────────────────────────

worldsRouter.get('/:id/cities-mini', async (req: Request, res: Response) => {
  const cities = await prisma.city.findMany({
    where: { world_id: req.params.id },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
  res.json({ cities });
});

const GroupsMiniQuery = z.object({
  kind: z.enum(GROUP_KINDS).optional(),
  active: z.enum(['true', 'false']).optional(),
});

worldsRouter.get('/:id/groups-mini', async (req: Request, res: Response) => {
  const parsed = GroupsMiniQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const where: Record<string, unknown> = { world_id: req.params.id };
  if (parsed.data.kind) where.kind = parsed.data.kind;
  if (parsed.data.active !== undefined) {
    where.is_active = parsed.data.active === 'true';
  }
  const groups = await prisma.group.findMany({
    where,
    select: { id: true, name: true, kind: true, is_active: true },
    orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
  });
  res.json({ groups });
});

/** BigInt is not JSON-serializable; emit it as a decimal string. */
function serializeWorldResponse(result: {
  world: { random_seed_root: bigint } & Record<string, unknown>;
  city: unknown;
  buckets: unknown;
}) {
  const { random_seed_root, ...rest } = result.world;
  return {
    world: { ...rest, random_seed_root: random_seed_root.toString() },
    city: result.city,
    buckets: result.buckets,
  };
}
