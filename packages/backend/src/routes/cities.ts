// ============================================================
// /api/cities — Single-city (Phase 7 Wave 1)
// ============================================================

import { Router, Request, Response } from 'express';
import { getActiveWorldId } from '../services/time.service';
import { getCityWithStats } from '../services/cities.service';

const router = Router();

// ── GET /api/cities/active ───────────────────────────────────
// Returns the active world's city along with pop + dead-total stats.
// The Dashboard "City" card and the Rip page badge both read this.
router.get('/active', async (_req: Request, res: Response) => {
  const worldId = await getActiveWorldId();
  const city    = await getCityWithStats(worldId);
  res.json({
    ...city,
    created_at: city.created_at.toISOString(),
    updated_at: city.updated_at.toISOString(),
  });
});

export default router;
