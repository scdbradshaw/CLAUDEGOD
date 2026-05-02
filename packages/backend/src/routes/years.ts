// Years router (Phase 3).
//
// POST /api/years/advance   — enqueue a year-advance job
// GET  /api/years/:id       — fetch a YearRun row

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { enqueueYearAdvance, getYearRun } from '../services/year.service';

export const yearsRouter = Router();

const AdvanceBody = z.object({
  world_id: z.string().uuid(),
  random_seed: z.string().regex(/^\d+$/).optional(),
});

yearsRouter.post('/advance', async (req: Request, res: Response) => {
  const parsed = AdvanceBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_body', issues: parsed.error.issues });
  }

  let result;
  try {
    result = await enqueueYearAdvance({
      world_id: parsed.data.world_id,
      random_seed: parsed.data.random_seed != null
        ? BigInt(parsed.data.random_seed)
        : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'enqueue_failed';
    if (message === 'world_not_found') {
      return res.status(404).json({ error: 'world_not_found' });
    }
    throw err;
  }

  if (result.status === 'already_active') {
    return res.status(409).json({
      error: 'advance_in_progress',
      run_id: result.run.id,
      status: result.run.status,
      year: result.run.year,
    });
  }
  res.status(201).json({ run_id: result.run.id, year: result.run.year });
});

yearsRouter.get('/:id', async (req: Request, res: Response) => {
  const run = await getYearRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'year_run_not_found' });
  res.json({
    id: run.id,
    world_id: run.world_id,
    year: run.year,
    status: run.status,
    random_seed: run.random_seed.toString(),
    started_at: run.started_at,
    completed_at: run.completed_at,
    error_message: run.error_message,
  });
});
