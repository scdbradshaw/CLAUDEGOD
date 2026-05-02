// Phase 3 — year-advance.int.test.ts (integration)
//
// Exercises the full enqueue → worker → SSE complete flow against a real
// Postgres + pg-boss. Gated behind `RUN_INTEGRATION_TESTS=1` (a placeholder
// DATABASE_URL is not enough — pg-boss tries to connect at start time).
//
// Acceptance gates from DESIGN.md §20.2 (P3):
//   - Enqueue → SSE complete fires
//   - Year increments by 1
//   - Idempotent under double-click (second click rejected, never double-advances)
//   - YearRun row carries random_seed
//
// Run locally with a Postgres available:
//   DATABASE_URL=postgresql://localhost:5432/claude_god_test \
//     RUN_INTEGRATION_TESTS=1 \
//     npx prisma db push && npx vitest run test/phase-3

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PgBoss } from 'pg-boss';
import { PrismaClient } from '@prisma/client';
import { createWorld } from '../../src/services/world.service';
import { enqueueYearAdvance, getYearRun } from '../../src/services/year.service';
import { handleYearAdvance, registerYearWorker } from '../../src/workers/year-worker';
import { SseHub, sseHub } from '../../src/lib/sse';
import {
  __resetBossForTests,
  ensureQueue,
  startBoss,
  stopBoss,
  YEAR_ADVANCE_QUEUE,
} from '../../src/lib/queue';

const RUN_INTEGRATION =
  process.env.RUN_INTEGRATION_TESTS === '1' && !!process.env.DATABASE_URL;
const d = RUN_INTEGRATION ? describe : describe.skip;

let prisma: PrismaClient;
let boss: PgBoss;

d('Phase 3 — year advance integration', () => {
  beforeAll(async () => {
    prisma = new PrismaClient();
    boss = await startBoss();
    await ensureQueue(YEAR_ADVANCE_QUEUE);
  }, 30_000);

  afterAll(async () => {
    sseHub.evictAll();
    await stopBoss().catch(() => {});
    __resetBossForTests();
    await prisma.$disconnect();
  });

  it('enqueue → SSE completed fires; year increments by 1; random_seed persisted', async () => {
    const seeded = await createWorld({
      name: `Phase3 Test ${Date.now()}`,
      city_name: 'TestCity',
      region_resource: 'farmland',
      seed_population: 1_000,
    });
    expect(seeded.world.current_year).toBe(0);

    const hub = new SseHub({ evictAfterMs: 5_000 });
    const events: string[] = [];
    hub.subscribe('placeholder', { write: () => true }); // primer; replaced below

    // Run worker handler directly (bypasses pg-boss polling delay).
    const enqueue = await enqueueYearAdvance({ world_id: seeded.world.id }, prisma);
    expect(enqueue.status).toBe('enqueued');
    if (enqueue.status !== 'enqueued') return;
    const runId = enqueue.run.id;

    // Subscribe to the actual run id BEFORE handling so we capture all events.
    hub.subscribe(runId, {
      write: (s) => {
        const m = s.match(/event: (\w+)/);
        if (m) events.push(m[1]);
        return true;
      },
    });

    await handleYearAdvance(runId, hub);

    expect(events).toContain('started');
    expect(events).toContain('completed');

    const finalRun = await getYearRun(runId, prisma);
    expect(finalRun?.status).toBe('completed');
    expect(finalRun?.year).toBe(1);
    expect(typeof finalRun?.random_seed).toBe('bigint');
    expect(finalRun?.random_seed).toBeGreaterThan(0n);

    const world = await prisma.world.findUnique({ where: { id: seeded.world.id } });
    expect(world?.current_year).toBe(1);
  }, 30_000);

  it('rejects double-click while a run is pending (idempotency)', async () => {
    const seeded = await createWorld({
      name: `Phase3 DoubleClick ${Date.now()}`,
      city_name: 'TestCity',
      region_resource: 'farmland',
      seed_population: 100,
    });

    const first = await enqueueYearAdvance({ world_id: seeded.world.id }, prisma);
    expect(first.status).toBe('enqueued');

    const second = await enqueueYearAdvance({ world_id: seeded.world.id }, prisma);
    expect(second.status).toBe('already_active');
    if (second.status !== 'already_active' || first.status !== 'enqueued') return;
    expect(second.run.id).toBe(first.run.id);

    // After completing, a new advance is allowed.
    await handleYearAdvance(first.run.id, new SseHub());
    const third = await enqueueYearAdvance({ world_id: seeded.world.id }, prisma);
    expect(third.status).toBe('enqueued');

    // World did not double-advance: only the first run completed at year 1,
    // and the third targets year 2.
    const world = await prisma.world.findUnique({ where: { id: seeded.world.id } });
    expect(world?.current_year).toBe(1);
    if (third.status === 'enqueued') {
      expect(third.run.year).toBe(2);
    }
  }, 30_000);

  it('pg-boss path: a real job dispatched by boss reaches the worker and completes', async () => {
    const seeded = await createWorld({
      name: `Phase3 Boss ${Date.now()}`,
      city_name: 'TestCity',
      region_resource: 'farmland',
      seed_population: 100,
    });

    const hub = new SseHub({ evictAfterMs: 5_000 });
    await registerYearWorker(boss, hub);

    const enq = await enqueueYearAdvance({ world_id: seeded.world.id }, prisma);
    if (enq.status !== 'enqueued') throw new Error('expected enqueued');
    const runId = enq.run.id;

    // Wait for completion (poll YearRun row, capped at 15s).
    const deadline = Date.now() + 15_000;
    let final = await getYearRun(runId, prisma);
    while (final?.status !== 'completed' && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      final = await getYearRun(runId, prisma);
    }
    expect(final?.status).toBe('completed');
    expect(final?.year).toBe(1);

    // The hub should have logged the lifecycle for this run.
    const log = hub.getLog(runId);
    expect(log.some((e) => e.event === 'started')).toBe(true);
    expect(log.some((e) => e.event === 'completed')).toBe(true);
  }, 30_000);
});
