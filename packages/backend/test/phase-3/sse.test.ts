// Phase 3 — sse.test.ts
//
// Unit tests for SseHub. Verifies:
//   - publish writes to all current subscribers
//   - new subscribers get the full event-log replay (covers the race where
//     a fast-completing worker fires `completed` before the client subscribes)
//   - terminal events schedule eviction; non-terminal events do not
//   - close handler unsubscribes
//   - frame format matches SSE spec

import { describe, it, expect, beforeEach } from 'vitest';
import { SseHub, formatFrame } from '../../src/lib/sse';

class FakeRes {
  chunks: string[] = [];
  closed = false;
  private closeHandlers: Array<() => void> = [];
  write(s: string): boolean {
    this.chunks.push(s);
    return true;
  }
  end(): void {
    this.closed = true;
  }
  on(_ev: 'close', cb: () => void): void {
    this.closeHandlers.push(cb);
  }
  fireClose(): void {
    for (const cb of this.closeHandlers) cb();
  }
}

describe('Phase 3 — SseHub publish/subscribe', () => {
  let hub: SseHub;
  beforeEach(() => {
    hub = new SseHub({ evictAfterMs: 50 });
  });

  it('publishes to all live subscribers', () => {
    const a = new FakeRes();
    const b = new FakeRes();
    hub.subscribe('r1', a);
    hub.subscribe('r1', b);
    hub.publish('r1', 'started', { year: 1 });
    expect(a.chunks.some((c) => c.includes('event: started'))).toBe(true);
    expect(b.chunks.some((c) => c.includes('event: started'))).toBe(true);
  });

  it('replays event log to subscribers that join late', () => {
    hub.publish('r1', 'started', { year: 1 });
    hub.publish('r1', 'completed', { year: 1 });
    const late = new FakeRes();
    hub.subscribe('r1', late);
    const joined = late.chunks.join('');
    expect(joined).toMatch(/event: started/);
    expect(joined).toMatch(/event: completed/);
  });

  it('assigns monotonic seq ids per run', () => {
    hub.publish('r1', 'started', {});
    hub.publish('r1', 'progress', {});
    hub.publish('r1', 'completed', {});
    const log = hub.getLog('r1');
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('isolates events between runs', () => {
    const a = new FakeRes();
    hub.subscribe('r1', a);
    hub.publish('r2', 'started', { year: 1 });
    expect(a.chunks.some((c) => c.includes('event: started'))).toBe(false);
  });

  it('close handler removes subscriber', () => {
    const r = new FakeRes();
    hub.subscribe('r1', r);
    expect(hub.subscriberCount('r1')).toBe(1);
    r.fireClose();
    expect(hub.subscriberCount('r1')).toBe(0);
  });

  it('schedules eviction after a terminal event', async () => {
    hub.publish('r1', 'completed', {});
    expect(hub.size()).toBe(1);
    await new Promise((r) => setTimeout(r, 80));
    expect(hub.size()).toBe(0);
  });

  it('does not schedule eviction on non-terminal events', async () => {
    hub.publish('r1', 'started', {});
    hub.publish('r1', 'progress', {});
    await new Promise((r) => setTimeout(r, 80));
    expect(hub.size()).toBe(1);
  });

  it('evictAll closes all subscribers and clears state', () => {
    const a = new FakeRes();
    const b = new FakeRes();
    hub.subscribe('r1', a);
    hub.subscribe('r2', b);
    hub.evictAll();
    expect(hub.size()).toBe(0);
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
  });
});

describe('Phase 3 — SSE frame format', () => {
  it('emits id/event/data fields with double-newline terminator', () => {
    const frame = formatFrame({ event: 'completed', data: { year: 5 }, seq: 7 });
    expect(frame).toBe('id: 7\nevent: completed\ndata: {"year":5}\n\n');
  });
});

describe('Phase 3 — heartbeat', () => {
  it('writes a comment line to all subscribers of a run', () => {
    const hub = new SseHub();
    const a = new FakeRes();
    hub.subscribe('r1', a);
    hub.heartbeat('r1');
    expect(a.chunks.some((c) => c.startsWith(': heartbeat'))).toBe(true);
  });

  it('heartbeatAll covers every active run', () => {
    const hub = new SseHub();
    const a = new FakeRes();
    const b = new FakeRes();
    hub.subscribe('r1', a);
    hub.subscribe('r2', b);
    hub.heartbeatAll();
    expect(a.chunks.some((c) => c.startsWith(': heartbeat'))).toBe(true);
    expect(b.chunks.some((c) => c.startsWith(': heartbeat'))).toBe(true);
  });
});
