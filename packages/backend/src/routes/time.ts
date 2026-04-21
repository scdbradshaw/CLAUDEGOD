// ============================================================
// TIME ROUTES
// GET  /api/time             — current world state + recent annual headlines
// POST /api/time/advance     — { years: number }
// POST /api/time/rewind      — { years: number }
// GET  /api/time/headlines   — ?type=ANNUAL|DECADE&category=...&yearFrom=...&yearTo=...
// POST /api/time/headlines/generate — regenerate headlines for a specific year
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getWorldState, advanceTime, rewindTime, getHeadlines } from '../services/time.service';
import { generateHeadlinesForYear } from '../services/headlines.service';
import { validate } from '../middleware/validate';

const router = Router();

// GET /api/time
router.get('/', async (_req, res) => {
  const state = await getWorldState();

  // Return last 10 years of annual headlines alongside state
  const recentHeadlines = await getHeadlines({
    type:     'ANNUAL',
    yearFrom: state.current_year - 10,
    yearTo:   state.current_year - 1,
  });

  const decadeHeadlines = await getHeadlines({ type: 'DECADE' });

  res.json({ ...state, recent_headlines: recentHeadlines, decade_headlines: decadeHeadlines });
});

// POST /api/time/advance
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

// POST /api/time/headlines/generate  (manually trigger for a specific year)
router.post(
  '/headlines/generate',
  validate(z.object({ year: z.number().int().min(1) })),
  async (req, res) => {
    const results = await generateHeadlinesForYear(req.body.year);
    res.json({ generated: results.length, headlines: results });
  },
);

export default router;
