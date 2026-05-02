// pg-boss queue singleton (Phase 3).
//
// One PgBoss process-wide, started lazily and shut down on app exit. Queues
// must be created before send/work in pg-boss v12, so consumers call
// `ensureQueue(name)` at registration time.

import { PgBoss } from 'pg-boss';

export const YEAR_ADVANCE_QUEUE = 'year-advance';

let bossInstance: PgBoss | null = null;
let bossStarting: Promise<PgBoss> | null = null;
const ensuredQueues = new Set<string>();

function getConnectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set — pg-boss cannot start');
  }
  return url;
}

/** Start (or return) the singleton boss. Idempotent. */
export async function startBoss(): Promise<PgBoss> {
  if (bossInstance) return bossInstance;
  if (bossStarting) return bossStarting;
  bossStarting = (async () => {
    const boss = new PgBoss(getConnectionString());
    boss.on('error', (err: unknown) => {
      // eslint-disable-next-line no-console
      console.error('[pg-boss] error:', err);
    });
    await boss.start();
    bossInstance = boss;
    return boss;
  })();
  try {
    return await bossStarting;
  } finally {
    bossStarting = null;
  }
}

export async function ensureQueue(name: string): Promise<void> {
  if (ensuredQueues.has(name)) return;
  const boss = await startBoss();
  await boss.createQueue(name);
  ensuredQueues.add(name);
}

export async function stopBoss(): Promise<void> {
  if (!bossInstance) return;
  await bossInstance.stop({ graceful: true, close: true });
  bossInstance = null;
  ensuredQueues.clear();
}

/** For tests: reset the singleton without stopping (use with care). */
export function __resetBossForTests(): void {
  bossInstance = null;
  bossStarting = null;
  ensuredQueues.clear();
}
