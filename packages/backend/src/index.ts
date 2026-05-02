// CLAUDE GOD — backend entrypoint.
//
// Phase 2: Express server + worlds router.
// Phase 3: pg-boss worker + SSE for year advance.

import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { worldsRouter } from './routes/worlds';
import { yearsRouter } from './routes/years';
import { pipelineRouter } from './routes/pipeline';
import { personsRouter } from './routes/persons';
import { groupsRouter } from './routes/groups';
import { eventsRouter } from './routes/events';
import { citiesRouter } from './routes/cities';
import { searchRouter } from './routes/search';
import { startBoss, stopBoss } from './lib/queue';
import { startHeartbeat, sseHub } from './lib/sse';
import { registerYearWorker } from './workers/year-worker';

const PORT = Number(process.env.PORT ?? 3001);

export function buildApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(morgan('dev'));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // All gameplay routes live under /api/*
  app.use('/api/worlds', worldsRouter);
  app.use('/api/cities', citiesRouter);
  app.use('/api/years', yearsRouter);
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/persons', personsRouter);
  app.use('/api/groups', groupsRouter);
  app.use('/api/events', eventsRouter);
  app.use('/api/search', searchRouter);

  // Final error handler — keep it simple for now.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      // eslint-disable-next-line no-console
      console.error('[backend] error:', err);
      const message = err instanceof Error ? err.message : 'internal_error';
      res.status(500).json({ error: 'internal_error', message });
    },
  );

  return app;
}

/** Boot pg-boss + register the year-advance worker. Idempotent. */
export async function bootPipeline(): Promise<void> {
  const boss = await startBoss();
  await registerYearWorker(boss);
}

if (require.main === module) {
  const app = buildApp();
  const stopHeartbeat = startHeartbeat();

  bootPipeline().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backend] failed to boot pipeline:', err);
    process.exit(1);
  });

  const server = app.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[backend] CLAUDE GOD listening on http://localhost:${PORT}`);
  });

  const shutdown = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[backend] ${signal} received — shutting down`);
    stopHeartbeat();
    sseHub.evictAll();
    server.close();
    await stopBoss().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
