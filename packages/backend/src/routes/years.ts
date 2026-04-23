// ============================================================
// YEAR ROUTES — §0.5 Phase 2
// POST /api/years/advance   — enqueue pipeline, return year_run_id
// GET  /api/years/:id       — poll year_run status
// GET  /api/years/:id/stream — SSE live progress heartbeat
// ============================================================

import { Router } from 'express';
import { boss }                                   from '../index';
import { yearRunBus, getRunningYearRun, getYearRun, type YearRunUpdate } from '../services/year.service';
import { getActiveWorld }                          from '../services/time.service';
import prisma                                      from '../db/client';

const router = Router();

// POST /api/years/advance
// Creates a YearRun row (acts as the pipeline lock), enqueues a
// pg-boss job, and returns immediately with { year_run_id }.
// Returns 409 if a year is already in progress for this world.
router.post('/advance', async (_req, res) => {
  const world = await getActiveWorld();

  // Lock check — one in-flight year per world
  const running = await getRunningYearRun(world.id);
  if (running) {
    res.status(409).json({ error: 'A year is already in progress', year_run_id: running.id });
    return;
  }

  // Create the tracker row first so the SSE client can subscribe immediately
  const yearRun = await prisma.yearRun.create({
    data: {
      world_id:    world.id,
      year:        world.current_year,
      phase:       'bi_annual_a',
      progress_pct: 0,
      status:      'running',
    },
  });

  // Enqueue the pg-boss job — returns in <200ms
  await boss.send('advance_year', { world_id: world.id, year_run_id: yearRun.id });

  res.json({ year_run_id: yearRun.id, year: world.current_year });
});

// GET /api/years/running — current in-flight year-run for the active world, or null.
// Lets the frontend re-attach the SSE heartbeat after a page refresh and
// disable the Advance button across all pages.
router.get('/running', async (_req, res) => {
  const world = await getActiveWorld();
  const running = await getRunningYearRun(world.id);
  res.json(running ?? null);
});

// GET /api/years/:id  — poll current status (non-SSE clients)
router.get('/:id', async (req, res) => {
  const yr = await getYearRun(req.params.id);
  if (!yr) { res.status(404).json({ error: 'Year run not found' }); return; }
  res.json(yr);
});

// GET /api/years/:id/stream  — SSE live heartbeat
// The frontend subscribes immediately after POST /advance returns,
// then receives push events as each pipeline phase completes.
router.get('/:id/stream', async (req, res) => {
  const yearRunId = req.params.id;

  // Confirm it exists
  const yr = await getYearRun(yearRunId);
  if (!yr) { res.status(404).json({ error: 'Year run not found' }); return; }

  // SSE headers
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering if present
  res.flushHeaders();

  // Emit current state immediately so the client has something to render
  const initial: YearRunUpdate = {
    year_run_id:  yr.id,
    phase:        yr.phase,
    progress_pct: yr.progress_pct,
    status:       yr.status,
    message:      yr.message ?? undefined,
  };
  res.write(`data: ${JSON.stringify(initial)}\n\n`);

  // If already terminal, close immediately
  if (yr.status === 'completed' || yr.status === 'failed') {
    res.end();
    return;
  }

  // Subscribe to in-process bus
  const onUpdate = (update: YearRunUpdate) => {
    res.write(`data: ${JSON.stringify(update)}\n\n`);
    if (update.status === 'completed' || update.status === 'failed') {
      cleanup();
    }
  };
  yearRunBus.on(yearRunId, onUpdate);

  // Keepalive ping every 15s so the connection doesn't timeout behind proxies
  const ping = setInterval(() => res.write(': ping\n\n'), 15_000);

  function cleanup() {
    clearInterval(ping);
    yearRunBus.off(yearRunId, onUpdate);
    res.end();
  }

  req.on('close', cleanup);
});

export default router;
