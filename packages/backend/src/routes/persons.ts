// Persons router (Phase 5).
//
// GET  /api/persons/:id            — fetch one Person
// POST /api/persons/:id/pin        — pin (returns 400 + cap info if over cap)
// POST /api/persons/:id/unpin      — unpin
// (List endpoint exposed under /api/worlds/:world_id/persons via worldsRouter
//  in a follow-up; for Phase 5 we keep listing on this router for parity.)
// GET  /api/persons?world_id=...   — list alive persons (filterable)

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  AGENTIC_ACTION_TYPES,
  PERSON_TYPES,
  PERSONALITY_TAGS,
  type Memory,
} from '@claude-god/shared';
import {
  getPerson,
  listPersons,
  searchPersons,
  pinPerson,
  unpinPerson,
  summonPerson,
  killPerson,
  summonManyPersons,
  killManyPersons,
  previewBulkKill,
  RealPersonCapError,
} from '../services/person.service';
import { getFamilyTree } from '../services/family-tree.service';
import {
  enqueueAction,
  listPersonQueue,
  removeQueuedAction,
} from '../services/action.service';
import { prisma } from '../lib/prisma';

export const personsRouter = Router();

const ListQuery = z.object({
  world_id: z.string().uuid(),
  city_id: z.string().uuid().optional(),
  type: z.enum(PERSON_TYPES).optional(),
  is_pinned: z.enum(['true', 'false']).optional(),
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

personsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const { is_pinned, ...rest } = parsed.data;
  const result = await listPersons({
    ...rest,
    is_pinned: is_pinned == null ? undefined : is_pinned === 'true',
  });
  res.json(result);
});

// ─── Rich search (god-mode picker) ─────────────────────────────────────────

const GroupFilterValueSchema = z.union([z.string().uuid(), z.literal('none')]);

const SearchBody = z
  .object({
    world_id: z.string().uuid(),
    q: z.string().max(100).optional(),
    race: z.array(z.string().min(1).max(80)).max(40).optional(),
    gender: z.array(z.string().min(1).max(20)).max(8).optional(),
    is_alive: z.boolean().optional(),
    is_pinned: z.boolean().optional(),
    city_ids: z.array(z.string().uuid()).max(40).optional(),
    types: z.array(z.enum(PERSON_TYPES)).max(20).optional(),
    faction_ids: z.array(GroupFilterValueSchema).max(40).optional(),
    religion_ids: z.array(GroupFilterValueSchema).max(40).optional(),
    personality_tags: z.array(z.enum(PERSONALITY_TAGS)).max(20).optional(),
    personality_mode: z.enum(['any', 'all']).optional(),
    age_min: z.number().int().min(0).max(200).optional(),
    age_max: z.number().int().min(0).max(200).optional(),
    wealth_min: z.number().int().optional(),
    wealth_max: z.number().int().optional(),
    intelligence_min: z.number().int().min(0).max(100).optional(),
    intelligence_max: z.number().int().min(0).max(100).optional(),
    combat_min: z.number().int().min(0).max(100).optional(),
    combat_max: z.number().int().min(0).max(100).optional(),
    happiness_min: z.number().int().min(0).max(100).optional(),
    happiness_max: z.number().int().min(0).max(100).optional(),
    health_min: z.number().int().min(0).max(100).optional(),
    health_max: z.number().int().min(0).max(100).optional(),
    sort_by: z
      .enum(['name', 'age', 'wealth', 'intelligence', 'combat', 'happiness', 'created_year'])
      .optional(),
    sort_dir: z.enum(['asc', 'desc']).optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .strict();

personsRouter.post('/search', async (req: Request, res: Response) => {
  const parsed = SearchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const result = await searchPersons(parsed.data);
  res.json(result);
});

// NOTE: Specific GET routes must come before `/:id` so they aren't shadowed.
const KillPreviewQuery = z.object({
  world_id: z.string().uuid(),
  type: z.enum(PERSON_TYPES).optional(),
  is_pinned: z.enum(['true', 'false']).optional(),
  scope: z.enum(['npc', 'real', 'both']).optional(),
});

personsRouter.get('/kill-preview', async (req: Request, res: Response) => {
  const parsed = KillPreviewQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const { is_pinned, ...rest } = parsed.data;
  const result = await previewBulkKill({
    ...rest,
    is_pinned: is_pinned == null ? undefined : is_pinned === 'true',
  });
  res.json(result);
});

personsRouter.get('/:id', async (req: Request, res: Response) => {
  const p = await getPerson(req.params.id);
  if (!p) return res.status(404).json({ error: 'person_not_found' });

  const [relationships, decade_summaries] = await Promise.all([
    prisma.relationship.findMany({
      where: { owner_id: p.id },
      orderBy: { strength: 'desc' },
    }),
    prisma.lifeDecadeSummary.findMany({
      where: { person_id: p.id },
      orderBy: { decade_start_year: 'asc' },
    }),
  ]);

  // ── Parse memories ──────────────────────────────────────────────────────────
  const rawMemories = Array.isArray(p.recent_memories)
    ? (p.recent_memories as unknown as Memory[])
    : [];

  // ── Collect all person IDs to batch-resolve names ───────────────────────────
  const targetIds = relationships.map((r) => r.target_id);
  const counterpartyIds = rawMemories
    .map((m) => m.counterparty_id)
    .filter((id): id is string => Boolean(id));
  const allPersonIds = [...new Set([...targetIds, ...counterpartyIds])];

  // ── Collect group IDs for faction/religion names ────────────────────────────
  const groupIds = [p.faction_id, p.religion_id].filter((id): id is string => Boolean(id));

  // ── Batch-fetch names ────────────────────────────────────────────────────────
  const [personNames, groupNames] = await Promise.all([
    allPersonIds.length > 0
      ? prisma.person.findMany({
          where: { id: { in: allPersonIds } },
          select: { id: true, name: true },
        })
      : [],
    groupIds.length > 0
      ? prisma.group.findMany({
          where: { id: { in: groupIds } },
          select: { id: true, name: true },
        })
      : [],
  ]);

  const personNameMap = new Map(personNames.map((x) => [x.id, x.name]));
  const groupNameMap = new Map(groupNames.map((x) => [x.id, x.name]));

  // ── Enrich relationships ────────────────────────────────────────────────────
  const enrichedRelationships = relationships.map((r) => ({
    ...r,
    target_name: personNameMap.get(r.target_id) ?? null,
  }));

  // ── Enrich memories ─────────────────────────────────────────────────────────
  const enrichedMemories = rawMemories.map((m) => ({
    ...m,
    counterparty_name: m.counterparty_id ? (personNameMap.get(m.counterparty_id) ?? undefined) : undefined,
  }));

  // ── Group name lookups ───────────────────────────────────────────────────────
  const faction_name = p.faction_id ? (groupNameMap.get(p.faction_id) ?? null) : null;
  const religion_name = p.religion_id ? (groupNameMap.get(p.religion_id) ?? null) : null;

  res.json({
    person: { ...p, faction_name, religion_name, recent_memories: enrichedMemories },
    relationships: enrichedRelationships,
    decade_summaries,
  });
});

// ─── PATCH /api/persons/:id — god-mode stat/identity editor ────────────────

const PatchPersonBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    type: z.enum(PERSON_TYPES).optional(),
    gender: z.string().min(1).max(20).optional(),
    race: z.string().min(1).max(80).optional(),
    sexuality: z.number().int().min(0).max(100).optional(),
    age: z.number().int().min(0).optional(),
    wealth: z.number().int().min(0).optional(),
    current_health: z.number().int().min(0).max(100).optional(),
    happiness: z.number().int().min(0).max(100).optional(),
    intelligence: z.number().int().min(0).max(100).optional(),
    combat: z.number().int().min(0).max(100).optional(),
    faction_id: z.string().uuid().nullable().optional(),
    religion_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: 'body must not be empty' });

personsRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = PatchPersonBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }

  const person = await getPerson(req.params.id);
  if (!person) return res.status(404).json({ error: 'person_not_found' });

  const {
    faction_id: newFactionId,
    religion_id: newReligionId,
    ...scalarFields
  } = parsed.data;

  // Build the Prisma update payload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateData: Record<string, any> = { ...scalarFields };

  // ── Validate and apply faction_id change ────────────────────────────────────
  if ('faction_id' in parsed.data) {
    if (newFactionId === null) {
      // Kick from faction
      updateData.faction_id = null;
      updateData.faction_joined_year = null;
      updateData.dues_missed_faction = 0;
    } else {
      // Join a faction — validate group exists, is active, correct kind
      const group = await prisma.group.findUnique({
        where: { id: newFactionId! },
        select: { id: true, is_active: true, kind: true },
      });
      if (!group || !group.is_active || group.kind !== 'faction') {
        return res.status(400).json({ error: 'invalid_faction_id' });
      }
      // Fetch current_year from the person's world
      const world = await prisma.world.findUnique({
        where: { id: person.world_id },
        select: { current_year: true },
      });
      updateData.faction_id = newFactionId;
      updateData.faction_joined_year = world?.current_year ?? 0;
      updateData.dues_missed_faction = 0;
      updateData.unmatched_faction_years = 0;
    }
  }

  // ── Validate and apply religion_id change ───────────────────────────────────
  if ('religion_id' in parsed.data) {
    if (newReligionId === null) {
      // Leave religion
      updateData.religion_id = null;
      updateData.religion_joined_year = null;
      updateData.dues_missed_religion = 0;
    } else {
      const group = await prisma.group.findUnique({
        where: { id: newReligionId! },
        select: { id: true, is_active: true, kind: true },
      });
      if (!group || !group.is_active || group.kind !== 'religion') {
        return res.status(400).json({ error: 'invalid_religion_id' });
      }
      const world = await prisma.world.findUnique({
        where: { id: person.world_id },
        select: { current_year: true },
      });
      updateData.religion_id = newReligionId;
      updateData.religion_joined_year = world?.current_year ?? 0;
      updateData.dues_missed_religion = 0;
      updateData.unmatched_religion_years = 0;
    }
  }

  await prisma.person.update({ where: { id: person.id }, data: updateData });

  const updated = await getPerson(person.id);
  res.json(updated);
});

personsRouter.get('/:id/family', async (req: Request, res: Response) => {
  const tree = await getFamilyTree(req.params.id);
  if (!tree) return res.status(404).json({ error: 'person_not_found' });
  res.json(tree);
});

personsRouter.post('/:id/pin', async (req: Request, res: Response) => {
  try {
    const p = await pinPerson(req.params.id);
    res.json(p);
  } catch (err) {
    if (err instanceof RealPersonCapError) {
      return res.status(400).json({
        error: 'real_person_cap_reached',
        current: err.current,
        cap: err.cap,
      });
    }
    if (err instanceof Error && err.message === 'person_not_found') {
      return res.status(404).json({ error: 'person_not_found' });
    }
    throw err;
  }
});

personsRouter.post('/:id/unpin', async (req: Request, res: Response) => {
  try {
    const p = await unpinPerson(req.params.id);
    res.json(p);
  } catch (err) {
    if (err instanceof Error && /not.?found/i.test(err.message)) {
      return res.status(404).json({ error: 'person_not_found' });
    }
    throw err;
  }
});

// ─── God-mode (Phase 13a.12) ────────────────────────────────────────────────

const SummonBody = z.object({
  world_id: z.string().uuid(),
  city_id: z.string().uuid(),
  type: z.enum(PERSON_TYPES),
  pin: z.boolean().optional(),
});

personsRouter.post('/summon', async (req: Request, res: Response) => {
  const parsed = SummonBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const created = await summonPerson(parsed.data);
    res.status(201).json(created);
  } catch (err) {
    if (err instanceof RealPersonCapError) {
      return res.status(400).json({
        error: 'real_person_cap_reached',
        current: err.current,
        cap: err.cap,
      });
    }
    if (err instanceof Error) {
      if (err.message === 'world_not_found') {
        return res.status(404).json({ error: 'world_not_found' });
      }
      if (err.message.startsWith('bucket_not_found')) {
        return res.status(404).json({ error: 'bucket_not_found' });
      }
    }
    throw err;
  }
});

const SummonBulkBody = z.object({
  world_id: z.string().uuid(),
  city_id: z.string().uuid(),
  type: z.enum(PERSON_TYPES),
  count: z.number().int().min(1).max(10_000),
  pin: z.boolean().optional(),
});

personsRouter.post('/summon-bulk', async (req: Request, res: Response) => {
  const parsed = SummonBulkBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await summonManyPersons(parsed.data);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'world_not_found') {
        return res.status(404).json({ error: 'world_not_found' });
      }
      if (err.message.startsWith('bucket_not_found')) {
        return res.status(404).json({ error: 'bucket_not_found' });
      }
    }
    throw err;
  }
});

const KillBulkBody = z.object({
  world_id: z.string().uuid(),
  type: z.enum(PERSON_TYPES).optional(),
  is_pinned: z.boolean().optional(),
  scope: z.enum(['npc', 'real', 'both']).optional(),
  limit: z.number().int().min(1).max(10_000),
});

personsRouter.post('/kill-bulk', async (req: Request, res: Response) => {
  const parsed = KillBulkBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const result = await killManyPersons(parsed.data);
    res.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'world_not_found') {
      return res.status(404).json({ error: 'world_not_found' });
    }
    throw err;
  }
});


personsRouter.post('/:id/kill', async (req: Request, res: Response) => {
  try {
    const result = await killPerson(req.params.id);
    res.json(result);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'person_not_found') {
        return res.status(404).json({ error: 'person_not_found' });
      }
      if (err.message === 'person_already_dead') {
        return res.status(400).json({ error: 'person_already_dead' });
      }
    }
    throw err;
  }
});

// ─── Action queue (Phase 9) ────────────────────────────────────────────────

const EnqueueBody = z.object({
  action_type: z.enum(AGENTIC_ACTION_TYPES),
  target_id: z.string().uuid().optional(),
  params: z.record(z.unknown()).optional(),
  scheduled_year: z.number().int().min(0),
});

personsRouter.get('/:id/queue', async (req: Request, res: Response) => {
  const queue = await listPersonQueue(req.params.id);
  if (queue == null) return res.status(404).json({ error: 'person_not_found' });
  res.json({ queue });
});

personsRouter.post('/:id/queue', async (req: Request, res: Response) => {
  const parsed = EnqueueBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const queue = await enqueueAction({
      person_id: req.params.id,
      entry: parsed.data,
    });
    res.status(201).json({ queue });
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'person_not_found') {
        return res.status(404).json({ error: 'person_not_found' });
      }
      if (err.message === 'person_not_pinned') {
        return res.status(400).json({ error: 'person_not_pinned' });
      }
      if (err.message === 'invalid_action_type') {
        return res.status(400).json({ error: 'invalid_action_type' });
      }
    }
    throw err;
  }
});

personsRouter.delete('/:id/queue/:scheduled_year', async (req: Request, res: Response) => {
  const year = Number.parseInt(req.params.scheduled_year, 10);
  if (!Number.isFinite(year)) {
    return res.status(400).json({ error: 'invalid_scheduled_year' });
  }
  try {
    const queue = await removeQueuedAction(req.params.id, year);
    res.json({ queue });
  } catch (err) {
    if (err instanceof Error && err.message === 'person_not_found') {
      return res.status(404).json({ error: 'person_not_found' });
    }
    throw err;
  }
});
