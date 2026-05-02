// Groups router (Phase 7).
//
// GET    /api/groups?world_id=...&kind=...&active=...
// GET    /api/groups/:id
// POST   /api/groups
// POST   /api/groups/:id/dissolve   (god-mode)

import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  GROUP_KINDS,
  PERSON_TYPES,
  PERSONALITY_TAGS,
  RELIGION_DEFAULT_COST_PCT,
  FACTION_COMPETITION_METRIC_DEFAULT,
  FACTION_DEFAULT_COST_PER_YEAR,
  type Memory,
} from '@claude-god/shared';
import { prisma } from '../lib/prisma';
import {
  createGroup,
  dissolveGroupTx,
  summonFounderAndFaction,
  summonFounderAndReligion,
} from '../services/group.service';
import { RealPersonCapError } from '../services/person.service';
import { appendMemoryTx } from '../services/memory.service';

export const groupsRouter = Router();

const ListQuery = z.object({
  world_id: z.string().uuid(),
  kind: z.enum(GROUP_KINDS).optional(),
  active: z.enum(['true', 'false']).optional(),
});

groupsRouter.get('/', async (req: Request, res: Response) => {
  const parsed = ListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const { world_id, kind, active } = parsed.data;
  const where: Record<string, unknown> = { world_id };
  if (kind) where.kind = kind;
  if (active !== undefined) where.is_active = active === 'true';
  const rows = await prisma.group.findMany({
    where,
    orderBy: [{ is_active: 'desc' }, { founded_year: 'asc' }],
  });
  res.json({ rows });
});

groupsRouter.get('/:id', async (req: Request, res: Response) => {
  const group = await prisma.group.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ error: 'group_not_found' });

  const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';
  const memberCountReal = await prisma.person.count({
    where: { world_id: group.world_id, is_alive: true, [fkField]: group.id },
  });

  // Resolve founder + leader names so the UI can show "Brother Asha" instead
  // of an opaque UUID prefix. Founder may be archived (dead); fall back to
  // the BiographyArchive in that case.
  const personIds = [group.founder_id, group.leader_id].filter(
    (x): x is string => !!x,
  );
  const persons = personIds.length
    ? await prisma.person.findMany({
        where: { id: { in: personIds } },
        select: { id: true, name: true, is_alive: true },
      })
    : [];
  const personMap = new Map(persons.map((p) => [p.id, p]));
  const missingIds = personIds.filter((id) => !personMap.has(id));
  const archived = missingIds.length
    ? await prisma.biographyArchive.findMany({
        where: { person_id: { in: missingIds } },
        select: { person_id: true, name: true },
      })
    : [];
  const archiveMap = new Map(archived.map((a) => [a.person_id, a.name]));
  const resolveName = (
    id: string | null,
  ): { name: string | null; alive: boolean } => {
    if (!id) return { name: null, alive: false };
    const live = personMap.get(id);
    if (live) return { name: live.name, alive: live.is_alive };
    const arch = archiveMap.get(id);
    return { name: arch ?? null, alive: false };
  };
  const founder = resolveName(group.founder_id);
  const leader = resolveName(group.leader_id);

  res.json({
    group,
    member_count_real: memberCountReal,
    founder_name: founder.name,
    founder_alive: founder.alive,
    leader_name: leader.name,
    leader_alive: leader.alive,
  });
});

const TypeAffinitiesSchema = z.record(z.enum(PERSON_TYPES), z.number().min(0).max(10));
const StatFloorsSchema = z.object({
  intelligence_min: z.number().int().min(0).max(100).optional(),
  combat_min: z.number().int().min(0).max(100).optional(),
  wealth_min: z.number().int().min(0).optional(),
  age_min: z.number().int().min(0).max(120).optional(),
});

const CreateGroupBody = z
  .object({
    world_id: z.string().uuid(),
    kind: z.enum(GROUP_KINDS),
    name: z.string().min(1).max(120),
    founder_id: z.string().uuid().nullable().optional(),
    leader_id: z.string().uuid().nullable().optional(),
    founded_year: z.number().int().min(0),
    wanted_tags: z.array(z.enum(PERSONALITY_TAGS)).min(1).max(8),
    type_affinities: TypeAffinitiesSchema.default({}),
    stat_floors: StatFloorsSchema.default({}),
    cost_per_year: z.number().int().min(0).max(100_000).default(0),
    /** Religion-only — fraction of member wealth charged annually (§ R1). 0–0.5. */
    cost_pct_of_wealth: z.number().min(0).max(0.5).optional(),
    territory_cities: z.array(z.string().uuid()).optional(),
    tax_rate: z.number().int().min(0).max(50).optional(),
    army_size: z.number().int().min(0).optional(),
    /** Faction-only — competition config. */
    leader_dues_cut: z.number().min(0).max(0.5).optional(),
    prize_shares: z.array(z.number().min(0).max(0.5)).max(5).optional(),
    competition_metric: z.string().optional(),
    intelligence_target: z.number().min(0).max(100).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.kind === 'religion' && (val.tax_rate != null || val.army_size != null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'religion_cannot_have_tax_rate_or_army_size',
      });
    }
    if (val.kind === 'faction' && val.cost_pct_of_wealth != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'faction_cannot_have_cost_pct_of_wealth',
      });
    }
  });

groupsRouter.post('/', async (req: Request, res: Response) => {
  const parsed = CreateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }

  // §8.3 — religion founding requires the founder to carry the `faithful` tag.
  // Caller-supplied `wanted_tags` already constrains doctrine; we only check
  // the founder here. Anonymous foundings (no founder_id) are still accepted
  // for backfill / god-mode authoring.
  if (parsed.data.kind === 'religion' && parsed.data.founder_id) {
    const founder = await prisma.person.findUnique({
      where: { id: parsed.data.founder_id },
      select: { personality_tags: true },
    });
    if (!founder) return res.status(404).json({ error: 'founder_not_found' });
    const tags = (Array.isArray(founder.personality_tags)
      ? founder.personality_tags
      : []) as string[];
    if (!tags.includes('faithful')) {
      return res.status(400).json({ error: 'religion_requires_faithful_founder' });
    }
  }

  // Religions default to RELIGION_DEFAULT_COST_PCT when the caller doesn't set one.
  const cost_pct_of_wealth =
    parsed.data.kind === 'religion'
      ? parsed.data.cost_pct_of_wealth ?? RELIGION_DEFAULT_COST_PCT
      : null;
  const group = await createGroup({
    ...parsed.data,
    founder_id: parsed.data.founder_id ?? null,
    cost_pct_of_wealth,
  });
  res.status(201).json(group);
});

// God-mode: summon a founder soul + religion in one atomic call.
const SummonReligionBody = z.object({
  world_id: z.string().uuid(),
  city_id: z.string().uuid(),
  founder: z.object({
    type: z.enum(PERSON_TYPES),
    name: z.string().min(1).max(80).optional(),
    gender: z.enum(['male', 'female']).optional(),
    age: z.number().int().min(0).max(120).optional(),
    intelligence: z.number().int().min(0).max(100).optional(),
    combat: z.number().int().min(0).max(100).optional(),
    happiness: z.number().int().min(0).max(100).optional(),
    wealth: z.number().int().min(0).max(1_000_000).optional(),
    personality_tags: z.array(z.enum(PERSONALITY_TAGS)).max(8).optional(),
  }),
  religion: z.object({
    name: z.string().min(1).max(120),
    wanted_tags: z.array(z.enum(PERSONALITY_TAGS)).min(1).max(8),
    type_affinities: TypeAffinitiesSchema.optional(),
    stat_floors: StatFloorsSchema.optional(),
    cost_per_year: z.number().int().min(0).max(100_000).optional(),
    cost_pct_of_wealth: z.number().min(0).max(0.5).optional(),
  }),
});

groupsRouter.post('/summon-religion', async (req: Request, res: Response) => {
  const parsed = SummonReligionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const out = await summonFounderAndReligion(parsed.data);
    res.status(201).json(out);
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
      if (err.message.startsWith('bucket_empty')) {
        return res.status(400).json({ error: 'bucket_empty' });
      }
    }
    throw err;
  }
});

// God-mode: summon a founder soul + faction in one atomic call.
const SummonFactionBody = z.object({
  world_id: z.string().uuid(),
  city_id: z.string().uuid(),
  founder: z.object({
    type: z.enum(PERSON_TYPES),
    name: z.string().min(1).max(80).optional(),
    gender: z.enum(['male', 'female']).optional(),
    age: z.number().int().min(0).max(120).optional(),
    intelligence: z.number().int().min(0).max(100).optional(),
    combat: z.number().int().min(0).max(100).optional(),
    happiness: z.number().int().min(0).max(100).optional(),
    wealth: z.number().int().min(0).max(1_000_000).optional(),
    personality_tags: z.array(z.enum(PERSONALITY_TAGS)).max(8).optional(),
  }),
  faction: z.object({
    name: z.string().min(1).max(120),
    wanted_tags: z.array(z.enum(PERSONALITY_TAGS)).min(1).max(8),
    type_affinities: TypeAffinitiesSchema.optional(),
    stat_floors: StatFloorsSchema.optional(),
    cost_per_year: z.number().int().min(0).max(100_000).optional(),
    leader_dues_cut: z.number().min(0).max(0.5).optional(),
    prize_shares: z.array(z.number().min(0).max(0.5)).max(5).optional(),
    competition_metric: z.string().optional(),
    intelligence_target: z.number().min(0).max(100).optional(),
    tax_rate: z.number().int().min(0).max(50).optional(),
    army_size: z.number().int().min(0).optional(),
  }),
});

groupsRouter.post('/summon-faction', async (req: Request, res: Response) => {
  const parsed = SummonFactionBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const out = await summonFounderAndFaction(parsed.data);
    res.status(201).json(out);
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
      if (err.message.startsWith('bucket_empty')) {
        return res.status(400).json({ error: 'bucket_empty' });
      }
    }
    throw err;
  }
});

// God-mode edit. Religion-safe fields (name, doctrine, dues, leader). Faction
// fields (tax_rate, army_size, territory_cities) accepted only when group
// kind matches.
const UpdateGroupBody = z
  .object({
    name: z.string().min(1).max(120).optional(),
    leader_id: z.string().uuid().nullable().optional(),
    wanted_tags: z.array(z.enum(PERSONALITY_TAGS)).min(1).max(8).optional(),
    type_affinities: TypeAffinitiesSchema.optional(),
    stat_floors: StatFloorsSchema.optional(),
    cost_per_year: z.number().int().min(0).max(100_000).optional(),
    cost_pct_of_wealth: z.number().min(0).max(0.5).nullable().optional(),
    territory_cities: z.array(z.string().uuid()).optional(),
    tax_rate: z.number().int().min(0).max(50).nullable().optional(),
    army_size: z.number().int().min(0).optional(),
  })
  .strict();

groupsRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = UpdateGroupBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const existing = await prisma.group.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'group_not_found' });
  if (!existing.is_active) {
    return res.status(400).json({ error: 'group_dissolved' });
  }

  const body = parsed.data;
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.wanted_tags !== undefined) data.wanted_tags = body.wanted_tags;
  if (body.type_affinities !== undefined) data.type_affinities = body.type_affinities;
  if (body.stat_floors !== undefined) data.stat_floors = body.stat_floors;
  if (body.cost_per_year !== undefined) data.cost_per_year = body.cost_per_year;

  if (body.leader_id !== undefined) {
    if (body.leader_id !== null) {
      const cand = await prisma.person.findUnique({
        where: { id: body.leader_id },
        select: { id: true, world_id: true, is_alive: true },
      });
      if (!cand) return res.status(404).json({ error: 'leader_not_found' });
      if (cand.world_id !== existing.world_id) {
        return res.status(400).json({ error: 'leader_wrong_world' });
      }
      if (!cand.is_alive) return res.status(400).json({ error: 'leader_not_alive' });
    }
    data.leader_id = body.leader_id;
  }

  if (existing.kind === 'religion') {
    if (body.cost_pct_of_wealth !== undefined) {
      data.cost_pct_of_wealth = body.cost_pct_of_wealth;
    }
    if (body.tax_rate !== undefined || body.army_size !== undefined || body.territory_cities !== undefined) {
      return res.status(400).json({ error: 'religion_cannot_have_faction_fields' });
    }
  } else {
    if (body.cost_pct_of_wealth !== undefined) {
      return res.status(400).json({ error: 'faction_cannot_have_cost_pct' });
    }
    if (body.tax_rate !== undefined) data.tax_rate = body.tax_rate;
    if (body.army_size !== undefined) data.army_size = body.army_size;
    if (body.territory_cities !== undefined) data.territory_cities = body.territory_cities;
  }

  const updated = await prisma.group.update({
    where: { id: existing.id },
    data,
  });
  res.json(updated);
});

// ─── Membership: list / convert / kick (god-mode) ─────────────────────────

const MembersListQuery = z.object({
  q: z.string().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['name', 'wins', 'leadership', 'wealth', 'income']).optional(),
});

groupsRouter.get('/:id/members', async (req: Request, res: Response) => {
  const parsed = MembersListQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const group = await prisma.group.findUnique({ where: { id: req.params.id } });
  if (!group) return res.status(404).json({ error: 'group_not_found' });
  const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';

  const where: Record<string, unknown> = {
    world_id: group.world_id,
    is_alive: true,
    [fkField]: group.id,
  };
  if (parsed.data.q) {
    where.name = { contains: parsed.data.q, mode: 'insensitive' };
  }
  const limit = parsed.data.limit ?? 50;

  const orderBy: Prisma.PersonOrderByWithRelationInput[] = (() => {
    switch (parsed.data.sort) {
      case 'wins':
        return [
          { faction_wins: 'desc' },
          { faction_leadership_years: 'desc' },
          { name: 'asc' },
        ];
      case 'leadership':
        return [
          { faction_leadership_years: 'desc' },
          { faction_wins: 'desc' },
          { name: 'asc' },
        ];
      case 'wealth':
        return [{ wealth: 'desc' }, { name: 'asc' }];
      case 'income':
        return [{ faction_income_year: 'desc' }, { name: 'asc' }];
      case 'name':
      default:
        return [{ name: 'asc' }];
    }
  })();

  const [total, rows] = await Promise.all([
    prisma.person.count({ where }),
    prisma.person.findMany({
      where,
      orderBy,
      take: limit,
      skip: parsed.data.offset ?? 0,
      select: {
        id: true,
        name: true,
        type: true,
        age: true,
        intelligence: true,
        combat: true,
        wealth: true,
        is_pinned: true,
        personality_tags: true,
        faction_wins: true,
        faction_leadership_years: true,
        faction_income_year: true,
      },
    }),
  ]);
  res.json({ total, rows });
});

const MembershipBody = z.object({ person_id: z.string().uuid() });

// Convert: assign the target person to this group. Clears any prior
// affiliation of the same kind (faction/religion). Memory entry on the
// target. Bucket shares are NOT touched — this is a per-person operation.
groupsRouter.post('/:id/convert', async (req: Request, res: Response) => {
  const parsed = MembershipBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const out = await prisma.$transaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: req.params.id } });
      if (!group) throw new Error('group_not_found');
      if (!group.is_active) throw new Error('group_dissolved');

      const person = await tx.person.findUnique({
        where: { id: parsed.data.person_id },
        select: {
          id: true,
          world_id: true,
          is_alive: true,
          faction_id: true,
          religion_id: true,
        },
      });
      if (!person) throw new Error('person_not_found');
      if (!person.is_alive) throw new Error('person_not_alive');
      if (person.world_id !== group.world_id) throw new Error('person_wrong_world');

      const world = await tx.world.findUnique({
        where: { id: group.world_id },
        select: { current_year: true },
      });
      if (!world) throw new Error('world_not_found');

      const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';
      const joinedField =
        group.kind === 'faction' ? 'faction_joined_year' : 'religion_joined_year';
      const currentMembership =
        group.kind === 'faction' ? person.faction_id : person.religion_id;

      if (currentMembership === group.id) {
        return { changed: false, group, person_id: person.id };
      }

      await tx.person.update({
        where: { id: person.id },
        data: {
          [fkField]: group.id,
          [joinedField]: world.current_year,
          // Religion auto-leave clock: reset on convert (§ R3).
          ...(group.kind === 'religion'
            ? { unmatched_religion_years: 0 }
            : {}),
        },
      });

      await appendMemoryTx(
        person.id,
        {
          year: world.current_year,
          kind: group.kind === 'faction' ? 'joined-faction' : 'joined-religion',
          summary:
            group.kind === 'faction'
              ? `joined the ${group.name}`
              : `was converted to the ${group.name}`,
          magnitude: 0.6,
          tone: 'literary',
          counterparty_id: group.id,
        } satisfies Memory,
        tx,
      );
      return { changed: true, group, person_id: person.id };
    });
    res.json(out);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'group_not_found' || err.message === 'person_not_found') {
        return res.status(404).json({ error: err.message });
      }
      if (
        err.message === 'group_dissolved' ||
        err.message === 'person_not_alive' ||
        err.message === 'person_wrong_world'
      ) {
        return res.status(400).json({ error: err.message });
      }
    }
    throw err;
  }
});

// Kick: remove the target person from this group. No-op if they aren't a
// member. Memory entry on the kicked person.
groupsRouter.post('/:id/kick', async (req: Request, res: Response) => {
  const parsed = MembershipBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const out = await prisma.$transaction(async (tx) => {
      const group = await tx.group.findUnique({ where: { id: req.params.id } });
      if (!group) throw new Error('group_not_found');

      const person = await tx.person.findUnique({
        where: { id: parsed.data.person_id },
        select: {
          id: true,
          world_id: true,
          is_alive: true,
          faction_id: true,
          religion_id: true,
        },
      });
      if (!person) throw new Error('person_not_found');
      if (person.world_id !== group.world_id) throw new Error('person_wrong_world');

      const world = await tx.world.findUnique({
        where: { id: group.world_id },
        select: { current_year: true },
      });
      if (!world) throw new Error('world_not_found');

      const fkField = group.kind === 'faction' ? 'faction_id' : 'religion_id';
      const joinedField =
        group.kind === 'faction' ? 'faction_joined_year' : 'religion_joined_year';
      const currentMembership =
        group.kind === 'faction' ? person.faction_id : person.religion_id;

      if (currentMembership !== group.id) {
        return { changed: false, group, person_id: person.id };
      }

      // Leader can't be kicked while leading — clear leader_id atomically.
      const updates: Record<string, unknown> = {};
      if (group.leader_id === person.id) updates.leader_id = null;

      await tx.person.update({
        where: { id: person.id },
        data: {
          [fkField]: null,
          [joinedField]: null,
          ...(group.kind === 'religion'
            ? { unmatched_religion_years: 0 }
            : {}),
        },
      });

      if (Object.keys(updates).length > 0) {
        await tx.group.update({ where: { id: group.id }, data: updates });
      }

      await appendMemoryTx(
        person.id,
        {
          year: world.current_year,
          kind: group.kind === 'faction' ? 'left-faction' : 'left-religion',
          summary:
            group.kind === 'faction'
              ? `was cast out of the ${group.name}`
              : `was excommunicated from the ${group.name}`,
          magnitude: 0.7,
          tone: 'literary',
          counterparty_id: group.id,
        } satisfies Memory,
        tx,
      );
      return { changed: true, group, person_id: person.id };
    });
    res.json(out);
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'group_not_found' || err.message === 'person_not_found') {
        return res.status(404).json({ error: err.message });
      }
      if (err.message === 'person_wrong_world') {
        return res.status(400).json({ error: err.message });
      }
    }
    throw err;
  }
});

groupsRouter.post('/:id/dissolve', async (req: Request, res: Response) => {
  const yearSchema = z.object({ year: z.number().int().min(0) });
  const parsed = yearSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  try {
    const out = await prisma.$transaction((tx) =>
      dissolveGroupTx(req.params.id, parsed.data.year, 'manual', tx),
    );
    res.json(out);
  } catch (err) {
    if (err instanceof Error && err.message === 'group_not_found') {
      return res.status(404).json({ error: 'group_not_found' });
    }
    throw err;
  }
});
