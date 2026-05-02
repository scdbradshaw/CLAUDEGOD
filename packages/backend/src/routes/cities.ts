// Cities router (Phase 11).
//
// GET   /api/cities/:id                       — city + buckets + active events
// PATCH /api/cities/:id                       — update tax_rate (0–50)
// GET   /api/cities/:id/leaderboards?metric=… — top-N real persons by metric

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  getCityDetail,
  updateTaxRate,
  getLeaderboards,
  LEADERBOARD_METRICS,
  type LeaderboardMetric,
} from '../services/city.service';

export const citiesRouter = Router();

citiesRouter.get('/:id', async (req: Request, res: Response) => {
  const detail = await getCityDetail(req.params.id);
  if (!detail) return res.status(404).json({ error: 'city_not_found' });
  res.json(detail);
});

const PatchBody = z.object({
  tax_rate: z.number().int().min(0).max(50).optional(),
});

citiesRouter.patch('/:id', async (req: Request, res: Response) => {
  const parsed = PatchBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }
  const { tax_rate } = parsed.data;
  if (tax_rate == null) {
    return res.status(400).json({ error: 'no_fields_to_update' });
  }
  try {
    const updated = await updateTaxRate(req.params.id, tax_rate);
    res.json(updated);
  } catch (err) {
    if (err instanceof Error && /Record to update not found|not found/i.test(err.message)) {
      return res.status(404).json({ error: 'city_not_found' });
    }
    throw err;
  }
});

const LeaderboardQuery = z.object({
  metric: z.enum(LEADERBOARD_METRICS as unknown as [LeaderboardMetric, ...LeaderboardMetric[]]),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

citiesRouter.get('/:id/leaderboards', async (req: Request, res: Response) => {
  const parsed = LeaderboardQuery.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }
  const rows = await getLeaderboards(req.params.id, parsed.data);
  res.json({ metric: parsed.data.metric, rows });
});
