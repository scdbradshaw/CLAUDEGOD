// ============================================================
// /api/rip — Deceased persons archive
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { getActiveWorldId } from '../services/time.service';

const router = Router();

// ── GET /api/rip ─────────────────────────────────────────────
router.get('/', async (req: Request, res: Response) => {
  const limit    = Math.min(500, parseInt(String(req.query.limit ?? 100)));
  const worldId  = await getActiveWorldId();

  const deceased = await prisma.deceasedPerson.findMany({
    where:   { world_id: worldId },
    orderBy: { died_at: 'desc' },
    take:    limit,
  });

  res.json(deceased);
});

export default router;
