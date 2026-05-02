// EventSource wrapper for the year-advance SSE channel.
// Backend wire: id:N event:<name> data:{json}; events: started|progress|completed|failed.

export type RunEventName = 'started' | 'progress' | 'completed' | 'failed';

export interface RunEventHandlers {
  onStarted?: (data: { run_id: string; year: number }) => void;
  onProgress?: (data: Record<string, unknown>) => void;
  onCompleted?: (data: { run_id: string; year: number; world_id: string; timings?: Array<{ step: string; ms: number }> }) => void;
  onFailed?: (data: { run_id: string; error: string }) => void;
  onError?: (err: Event) => void;
}

/**
 * Subscribe to a run's SSE channel. Returns a `close()` function.
 * The hub replays all prior events to new subscribers, so this is
 * safe to call after the run already started.
 */
export function subscribeToRun(runId: string, handlers: RunEventHandlers): () => void {
  const url = `/api/pipeline/sse?run_id=${encodeURIComponent(runId)}`;
  const es = new EventSource(url);

  function bind<T>(name: RunEventName, cb?: (d: T) => void) {
    if (!cb) return;
    es.addEventListener(name, (e) => {
      try {
        const data = JSON.parse((e as MessageEvent).data);
        cb(data as T);
      } catch {
        // Ignore malformed frames.
      }
    });
  }

  bind('started', handlers.onStarted);
  bind('progress', handlers.onProgress);
  bind('completed', handlers.onCompleted);
  bind('failed', handlers.onFailed);
  if (handlers.onError) es.onerror = handlers.onError;

  return () => es.close();
}
