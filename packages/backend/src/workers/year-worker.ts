// Year-advance worker (Phase 3).
//
// Handles `year-advance` jobs from pg-boss. Each job carries `{ year_run_id }`.
// Worker runs `runYearPhase` and emits SSE events to the shared hub.

import type { PgBoss } from 'pg-boss';
import { runYearPhase, markYearRunFailed, getYearRun } from '../services/year.service';
import { ensureQueue, YEAR_ADVANCE_QUEUE } from '../lib/queue';
import { sseHub, type SseHub } from '../lib/sse';

interface YearAdvanceJob {
  year_run_id: string;
}

export async function registerYearWorker(
  boss: PgBoss,
  hub: SseHub = sseHub,
): Promise<string> {
  await ensureQueue(YEAR_ADVANCE_QUEUE);
  return boss.work<YearAdvanceJob>(YEAR_ADVANCE_QUEUE, async (jobs) => {
    for (const job of jobs) {
      await handleYearAdvance(job.data.year_run_id, hub);
    }
  });
}

/** Exported for tests + integration drivers. */
export async function handleYearAdvance(
  yearRunId: string,
  hub: SseHub = sseHub,
): Promise<void> {
  // Read the run so we can emit the year on `started`.
  const run = await getYearRun(yearRunId);
  if (!run) {
    hub.publish(yearRunId, 'failed', { error: 'year_run_not_found' });
    return;
  }

  hub.publish(yearRunId, 'started', { run_id: yearRunId, year: run.year });

  try {
    const result = await runYearPhase(yearRunId);
    hub.publish(yearRunId, 'completed', {
      run_id: yearRunId,
      year: result.year,
      world_id: result.world_id,
      timings: result.timings,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown_error';
    await markYearRunFailed(yearRunId, message).catch(() => {
      /* swallow — the original error is what matters */
    });
    hub.publish(yearRunId, 'failed', { run_id: yearRunId, error: message });
  }
}
