// ============================================================
// TIME ROUTES
// GET  /api/time                         — current world state + recent annual headlines
// POST /api/time/advance                 — { years: number }  (sync, returns YearlyReport(s))
// POST /api/time/rewind                  — { years: number }
// GET  /api/time/headlines               — ?type=ANNUAL|DECADE&category=...&yearFrom=...&yearTo=...
// POST /api/time/headlines/generate      — { year? | decadeStart? }  (queued)
// GET  /api/time/jobs/:id                — poll a job's status
// GET  /api/time/jobs                    — list recent jobs for active world
// GET  /api/time/reports                 — list YearlyReports for active world
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { JobStatus } from '@prisma/client';
import { getActiveWorld, advanceTime, rewindTime, getHeadlines, getActiveWorldId } from '../services/time.service';
import { enqueueJob, getJob, listJobs } from '../services/jobs.service';
import prisma from '../db/client';
import { validate } from '../middleware/validate';

const router = Router();

// GET /api/time
router.get('/', async (_req, res) => {
  const state = await getActiveWorld();

  const recentHeadlines = await getHeadlines({
    type:     'ANNUAL',
    yearFrom: state.current_year - 10,
    yearTo:   state.current_year - 1,
  });

  const decadeHeadlines = await getHeadlines({ type: 'DECADE' });

  res.json({ ...state, recent_headlines: recentHeadlines, decade_headlines: decadeHeadlines });
});

// POST /api/time/advance  — synchronous, fast, no Claude. Returns the
// YearlyReport(s) produced by the advance. Narrative headlines are opt-in
// via POST /api/time/headlines/generate.
router.post(
  '/advance',
  validate(z.object({ years: z.number().int().min(1).max(500) })),
  async (req, res) => {
    const result = await advanceTime(req.body.years);
    res.json(result);
  },
);

// POST /api/time/rewind
router.post(
  '/rewind',
  validate(z.object({ years: z.number().int().min(1) })),
  async (req, res) => {
    const result = await rewindTime(req.body.years);
    res.json(result);
  },
);

// GET /api/time/headlines
router.get('/headlines', async (req, res) => {
  const { type, category, yearFrom, yearTo } = req.query;
  const headlines = await getHeadlines({
    type:     type     as 'ANNUAL' | 'DECADE' | undefined,
    category: category as string  | undefined,
    yearFrom: yearFrom ? parseInt(yearFrom as string) : undefined,
    yearTo:   yearTo   ? parseInt(yearTo   as string) : undefined,
  });
  res.json(headlines);
});

// POST /api/time/headlines/generate  — enqueue a headline-generation job.
// Accepts exactly one of { year } or { decadeStart } in the body. Returns
// the job row so the frontend can poll /api/time/jobs/:id.
router.post(
  '/headlines/generate',
  validate(
    z.union([
      z.object({ year:        z.number().int().min(1) }),
      z.object({ decadeStart: z.number().int().min(0) }),
    ]),
  ),
  async (req, res) => {
    const worldId = await getActiveWorldId();
    const body = req.body as { year?: number; decadeStart?: number };

    if (typeof body.year === 'number') {
      const job = await enqueueJob({
        worldId,
        kind:    'generate_year_headlines',
        payload: { year: body.year },
      });
      res.json({ job });
      return;
    }

    if (typeof body.decadeStart === 'number') {
      const job = await enqueueJob({
        worldId,
        kind:    'generate_decade_headlines',
        payload: { decadeStart: body.decadeStart },
      });
      res.json({ job });
      return;
    }

    res.status(400).json({ error: 'Must provide either `year` or `decadeStart`.' });
  },
);

// GET /api/time/jobs/:id  — poll status of a queued job
router.get('/jobs/:id', async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }
  res.json(job);
});

// GET /api/time/jobs  — list recent jobs for active world
router.get('/jobs', async (req, res) => {
  const worldId = await getActiveWorldId();
  const { status, kind, limit } = req.query;
  const jobs = await listJobs({
    worldId,
    status: status as JobStatus | undefined,
    kind:   kind   as 'generate_year_headlines' | 'generate_decade_headlines' | undefined,
    limit:  limit ? parseInt(limit as string) : undefined,
  });
  res.json(jobs);
});

// GET /api/time/reports  — list YearlyReports for active world (desc)
router.get('/reports', async (req, res) => {
  const worldId = await getActiveWorldId();
  const { yearFrom, yearTo, limit } = req.query;

  const reports = await prisma.yearlyReport.findMany({
    where: {
      world_id: worldId,
      ...(yearFrom ? { year: { gte: parseInt(yearFrom as string) } } : {}),
      ...(yearTo   ? { year: { lte: parseInt(yearTo   as string) } } : {}),
    },
    orderBy: { year: 'desc' },
    take:    limit ? parseInt(limit as string) : 50,
  });
  res.json(reports);
});

export default router;
