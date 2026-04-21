// ============================================================
// JOBS SERVICE — Postgres-as-queue
//
// Long-running work (Claude narration, decade-headline generation) is
// enqueued into the `tick_jobs` table and consumed by a single background
// loop. We intentionally avoid Redis / BullMQ — the volume is low, the
// work is already gated behind user opt-in, and Postgres gives us
// crash-safety + visibility for free.
//
// Concurrency model:
//   - One worker loop per process (started from index.ts on boot).
//   - Jobs are claimed via `UPDATE ... WHERE id = (SELECT ... FOR UPDATE
//     SKIP LOCKED)` so if the app is ever horizontally scaled, workers
//     in other processes won't double-claim.
//   - Handlers must be idempotent (ok to re-run after a crash mid-job).
// ============================================================

import { JobStatus, Prisma } from '@prisma/client';
import prisma from '../db/client';

export type JobKind =
  | 'generate_year_headlines'
  | 'generate_decade_headlines';

export interface JobPayloadByKind {
  generate_year_headlines:   { year: number };
  generate_decade_headlines: { decadeStart: number };
}

export type JobHandler<K extends JobKind = JobKind> = (args: {
  jobId:   string;
  worldId: string;
  payload: JobPayloadByKind[K];
}) => Promise<Prisma.InputJsonValue | undefined>;

// ── In-memory handler registry ──────────────────────────────
// Each JobKind must register exactly one handler at boot.
const handlers = new Map<JobKind, JobHandler>();

export function registerJobHandler<K extends JobKind>(kind: K, handler: JobHandler<K>): void {
  handlers.set(kind, handler as JobHandler);
}

// ── Enqueue ─────────────────────────────────────────────────
export interface EnqueueJobInput<K extends JobKind> {
  worldId:      string;
  kind:         K;
  payload:      JobPayloadByKind[K];
  maxAttempts?: number;
}

/**
 * Dedupes against in-flight work: if a pending or running job with the
 * same (world_id, kind, payload) already exists, that job is returned
 * instead of creating a duplicate. Uses a payload JSON equality check.
 */
export async function enqueueJob<K extends JobKind>(input: EnqueueJobInput<K>) {
  const existing = await prisma.tickJob.findFirst({
    where: {
      world_id: input.worldId,
      kind:     input.kind,
      status:   { in: ['pending', 'running'] },
      // Shallow equality for payload — Postgres JSONB equality via prisma.equals.
      payload:  { equals: input.payload as Prisma.InputJsonValue },
    },
    orderBy: { created_at: 'desc' },
  });
  if (existing) return existing;

  return prisma.tickJob.create({
    data: {
      world_id:     input.worldId,
      kind:         input.kind,
      status:       'pending',
      payload:      input.payload as Prisma.InputJsonValue,
      max_attempts: input.maxAttempts ?? 3,
    },
  });
}

export async function getJob(jobId: string) {
  return prisma.tickJob.findUnique({ where: { id: jobId } });
}

export async function listJobs(opts: { worldId?: string; status?: JobStatus; kind?: JobKind; limit?: number } = {}) {
  return prisma.tickJob.findMany({
    where: {
      ...(opts.worldId ? { world_id: opts.worldId } : {}),
      ...(opts.status  ? { status:   opts.status  } : {}),
      ...(opts.kind    ? { kind:     opts.kind    } : {}),
    },
    orderBy: { created_at: 'desc' },
    take:    opts.limit ?? 50,
  });
}

// ── Claim ───────────────────────────────────────────────────
// Atomically claim the oldest pending job. Returns null if nothing
// available. Uses SKIP LOCKED so multiple workers never double-claim.
async function claimNextJob() {
  const [claimed] = await prisma.$queryRaw<
    Array<{ id: string; world_id: string; kind: string; payload: unknown; attempts: number; max_attempts: number }>
  >`
    UPDATE tick_jobs SET
      status     = 'running',
      started_at = NOW(),
      attempts   = attempts + 1
    WHERE id = (
      SELECT id FROM tick_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, world_id, kind, payload, attempts, max_attempts
  `;
  return claimed ?? null;
}

async function finishJob(jobId: string, result: Prisma.InputJsonValue | undefined) {
  await prisma.tickJob.update({
    where: { id: jobId },
    data:  {
      status:      'done',
      finished_at: new Date(),
      result:      (result ?? {}) as Prisma.InputJsonValue,
      error:       null,
    },
  });
}

async function failJob(jobId: string, errorMessage: string, requeue: boolean) {
  await prisma.tickJob.update({
    where: { id: jobId },
    data:  {
      status:      requeue ? 'pending' : 'failed',
      finished_at: requeue ? null : new Date(),
      error:       errorMessage,
    },
  });
}

// ── Worker loop ─────────────────────────────────────────────
let workerRunning = false;

/**
 * Start the background job worker. Safe to call multiple times — subsequent
 * calls are no-ops. The loop yields with `setTimeout(0)` between jobs so
 * the event loop stays responsive for HTTP traffic.
 */
export function startJobWorker(opts: { pollIntervalMs?: number } = {}): void {
  if (workerRunning) return;
  workerRunning = true;
  const pollInterval = opts.pollIntervalMs ?? 2000;

  const tick = async (): Promise<void> => {
    try {
      // Recover any jobs that were claimed by a previous process but never
      // finished (process crashed mid-run). Run once per poll cycle.
      await recoverStaleJobs();

      let claimed = await claimNextJob();
      while (claimed) {
        const handler = handlers.get(claimed.kind as JobKind);
        if (!handler) {
          await failJob(claimed.id, `No handler registered for kind=${claimed.kind}`, /*requeue*/ false);
        } else {
          try {
            const result = await handler({
              jobId:   claimed.id,
              worldId: claimed.world_id,
              payload: claimed.payload as JobPayloadByKind[JobKind],
            });
            await finishJob(claimed.id, result);
          } catch (err) {
            const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
            const canRetry = claimed.attempts < claimed.max_attempts;
            await failJob(claimed.id, msg, canRetry);
          }
        }

        // Yield to the event loop between jobs.
        await new Promise<void>((r) => setImmediate(r));
        claimed = await claimNextJob();
      }
    } catch (err) {
      // Swallow loop errors so a bad query doesn't kill the worker.
      // Logged to stderr for operator visibility.
      console.error('[jobs.worker] poll error:', err);
    } finally {
      setTimeout(tick, pollInterval);
    }
  };

  // Kick off immediately on boot.
  setTimeout(tick, 0);
}

/**
 * Marks jobs that are stuck in `running` without a recent heartbeat as
 * `pending` so another worker (or this one, after restart) can retry.
 * "Stuck" = started_at older than 5 minutes.
 */
async function recoverStaleJobs(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE tick_jobs
    SET status = 'pending', started_at = NULL
    WHERE status = 'running'
      AND started_at < NOW() - INTERVAL '5 minutes'
  `;
}
