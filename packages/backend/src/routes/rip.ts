// ============================================================
// /api/rip — Deceased persons archive (Phase 7: obituary view)
// ============================================================

import { Router, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { getActiveWorldId } from '../services/time.service';
import { getOrCreateDefaultCity } from '../services/cities.service';

const router = Router();

// Only sort fields we've explicitly whitelisted reach Prisma — prevents a
// hostile `?sort=drop table` from flowing into an orderBy clause.
const SORT_FIELDS = new Set([
  'died_at', 'world_year', 'age_at_death', 'final_wealth', 'name',
]);

function parseYear(v: unknown): number | undefined {
  if (typeof v !== 'string' || v === '') return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

// ── GET /api/rip ─────────────────────────────────────────────
// Query params:
//   limit      — cap rows returned (default 100, max 500)
//   year_min   — inclusive lower bound on world_year of death
//   year_max   — inclusive upper bound on world_year of death
//   cause      — 'interaction' | 'old_age' | 'health'
//   sort       — one of SORT_FIELDS (default 'died_at')
//   order      — 'asc' | 'desc' (default 'desc')
router.get('/', async (req: Request, res: Response) => {
  const limit    = Math.min(500, parseInt(String(req.query.limit ?? 100)) || 100);
  const worldId  = await getActiveWorldId();

  const yearMin = parseYear(req.query.year_min);
  const yearMax = parseYear(req.query.year_max);
  const cause   = typeof req.query.cause === 'string' && req.query.cause !== ''
    ? req.query.cause
    : undefined;

  const sortRaw  = typeof req.query.sort === 'string' ? req.query.sort : 'died_at';
  const sort     = SORT_FIELDS.has(sortRaw) ? sortRaw : 'died_at';
  const orderRaw = typeof req.query.order === 'string' ? req.query.order : 'desc';
  const order    = orderRaw === 'asc' ? 'asc' : 'desc';

  const where: Prisma.DeceasedPersonWhereInput = { world_id: worldId };
  if (yearMin !== undefined || yearMax !== undefined) {
    where.world_year = {
      ...(yearMin !== undefined && { gte: yearMin }),
      ...(yearMax !== undefined && { lte: yearMax }),
    };
  }
  if (cause) where.cause = cause;

  const [deceased, city] = await Promise.all([
    prisma.deceasedPerson.findMany({
      where,
      orderBy: { [sort]: order } as Prisma.DeceasedPersonOrderByWithRelationInput,
      take:    limit,
    }),
    getOrCreateDefaultCity(worldId),
  ]);

  // Return the payload plus a meta section — the Rip page uses city_name
  // as a badge, and the year range as a seed for its year filter inputs.
  res.json({
    deceased,
    meta: {
      total:     deceased.length,
      limit,
      city_name: city.name,
    },
  });
});

export default router;
