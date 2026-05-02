// Search router (Phase 11) — top-bar search bar.
//
// GET /api/search?world_id=<uuid>&q=<text>
//
// Cross-entity name search across persons (alive), groups (active), and
// cities. Caps each list at 10 to keep the dropdown bounded.

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';

export const searchRouter = Router();

const SearchQuery = z.object({
  world_id: z.string().uuid(),
  q: z.string().min(1).max(100),
});

const PER_KIND_LIMIT = 10;

searchRouter.get('/', async (req: Request, res: Response) => {
  const parsed = SearchQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const { world_id, q } = parsed.data;
  const needle = q.trim();
  const contains = { contains: needle, mode: 'insensitive' as const };

  const [persons, groups, cities] = await Promise.all([
    prisma.person.findMany({
      where: { world_id, is_alive: true, name: contains },
      select: { id: true, name: true, type: true, city_id: true, is_pinned: true },
      orderBy: [{ is_pinned: 'desc' }, { name: 'asc' }],
      take: PER_KIND_LIMIT,
    }),
    prisma.group.findMany({
      where: { world_id, is_active: true, name: contains },
      select: { id: true, name: true, kind: true, member_count_cached: true },
      orderBy: [{ member_count_cached: 'desc' }, { name: 'asc' }],
      take: PER_KIND_LIMIT,
    }),
    prisma.city.findMany({
      where: { world_id, name: contains },
      select: { id: true, name: true, population_total: true, is_ruined: true },
      orderBy: [{ name: 'asc' }],
      take: PER_KIND_LIMIT,
    }),
  ]);

  res.json({ persons, groups, cities });
});
