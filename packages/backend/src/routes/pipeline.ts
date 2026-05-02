// Pipeline SSE router (Phase 3).
//
// GET /api/pipeline/sse?run_id=...  — server-sent events stream for a run.
// New subscribers get the run's full event log replayed first.

import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { sseHub } from '../lib/sse';

export const pipelineRouter = Router();

const Query = z.object({
  run_id: z.string().min(1),
});

pipelineRouter.get('/sse', (req: Request, res: Response) => {
  const parsed = Query.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: 'invalid_query', issues: parsed.error.issues });
  }

  res.status(200).set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  // Initial keepalive comment so the client opens the stream immediately.
  res.write(`: connected\n\n`);

  sseHub.subscribe(parsed.data.run_id, res);
});
