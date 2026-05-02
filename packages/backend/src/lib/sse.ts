// SSE hub (Phase 3).
//
// In-memory pub/sub keyed by run_id. New subscribers get the full event log
// replayed so a client connecting AFTER a fast-completing run still sees the
// terminal event. Runs are auto-evicted shortly after terminal events.
//
// Single-process model: worker and HTTP routes share this hub. v1 runs both
// in the same node process, so this is sufficient.

export type SseEventName = 'started' | 'progress' | 'completed' | 'failed' | 'heartbeat';

export interface SseEvent {
  event: SseEventName;
  data: Record<string, unknown>;
  /** Monotonic per-run id used as the SSE `id:` field; lets clients resume. */
  seq: number;
}

const TERMINAL_EVENTS: ReadonlySet<SseEventName> = new Set(['completed', 'failed']);

/** Minimal writable interface so tests don't need a real express Response. */
export interface SseWritable {
  write(chunk: string): boolean;
  end?(): void;
  on?(ev: 'close', cb: () => void): void;
}

interface RunChannel {
  log: SseEvent[];
  subscribers: Set<SseWritable>;
  evictTimer?: NodeJS.Timeout;
  nextSeq: number;
}

export interface SseHubOptions {
  /** ms before a terminated run is evicted from the hub. Default 30s. */
  evictAfterMs?: number;
}

export class SseHub {
  private readonly channels = new Map<string, RunChannel>();
  private readonly evictAfterMs: number;

  constructor(opts: SseHubOptions = {}) {
    this.evictAfterMs = opts.evictAfterMs ?? 30_000;
  }

  /** Publish an event to a run. Replays to current subscribers + appends to log. */
  publish(runId: string, event: SseEventName, data: Record<string, unknown>): SseEvent {
    const ch = this.getOrCreate(runId);
    const evt: SseEvent = { event, data, seq: ch.nextSeq++ };
    ch.log.push(evt);
    const frame = formatFrame(evt);
    for (const sub of ch.subscribers) {
      sub.write(frame);
    }
    if (TERMINAL_EVENTS.has(event)) {
      this.scheduleEvict(runId, ch);
    }
    return evt;
  }

  /**
   * Subscribe a writable stream to a run. Replays the existing log first.
   * Returns an `unsubscribe` function. If the run has already been evicted,
   * the subscriber gets nothing — caller should treat that as "missed it".
   */
  subscribe(runId: string, sub: SseWritable): () => void {
    const ch = this.getOrCreate(runId);
    // Replay existing log
    for (const evt of ch.log) {
      sub.write(formatFrame(evt));
    }
    ch.subscribers.add(sub);
    sub.on?.('close', () => ch.subscribers.delete(sub));
    return () => ch.subscribers.delete(sub);
  }

  /** Send a heartbeat comment to all subscribers of a run (keepalive). */
  heartbeat(runId: string): void {
    const ch = this.channels.get(runId);
    if (!ch) return;
    for (const sub of ch.subscribers) sub.write(`: heartbeat\n\n`);
  }

  /** Send heartbeats to every active channel. */
  heartbeatAll(): void {
    for (const id of this.channels.keys()) this.heartbeat(id);
  }

  /** Test helper: number of currently-tracked runs. */
  size(): number {
    return this.channels.size;
  }

  /** Test helper: number of subscribers on a run. */
  subscriberCount(runId: string): number {
    return this.channels.get(runId)?.subscribers.size ?? 0;
  }

  /** Test helper: snapshot of the event log for a run. */
  getLog(runId: string): readonly SseEvent[] {
    return this.channels.get(runId)?.log ?? [];
  }

  /** Force-evict a run (used by tests + on shutdown). */
  evict(runId: string): void {
    const ch = this.channels.get(runId);
    if (!ch) return;
    if (ch.evictTimer) clearTimeout(ch.evictTimer);
    for (const sub of ch.subscribers) sub.end?.();
    this.channels.delete(runId);
  }

  /** Force-evict everything (for shutdown / test cleanup). */
  evictAll(): void {
    for (const id of [...this.channels.keys()]) this.evict(id);
  }

  private getOrCreate(runId: string): RunChannel {
    let ch = this.channels.get(runId);
    if (!ch) {
      ch = { log: [], subscribers: new Set(), nextSeq: 0 };
      this.channels.set(runId, ch);
    }
    return ch;
  }

  private scheduleEvict(runId: string, ch: RunChannel): void {
    if (ch.evictTimer) clearTimeout(ch.evictTimer);
    ch.evictTimer = setTimeout(() => this.evict(runId), this.evictAfterMs);
    // Don't keep the process alive solely for an eviction.
    ch.evictTimer.unref?.();
  }
}

/** SSE wire format: `id: N\nevent: name\ndata: {...}\n\n`. */
export function formatFrame(evt: SseEvent): string {
  return `id: ${evt.seq}\nevent: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`;
}

/** Process-wide hub shared by worker + routes. */
export const sseHub = new SseHub();

/** Background heartbeat — call once at boot. Returns a stop fn. */
export function startHeartbeat(hub: SseHub = sseHub, intervalMs = 15_000): () => void {
  const t = setInterval(() => hub.heartbeatAll(), intervalMs);
  t.unref?.();
  return () => clearInterval(t);
}
