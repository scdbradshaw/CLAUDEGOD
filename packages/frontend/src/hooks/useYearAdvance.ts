// Year-advance lifecycle hook.
//
// Owns: pending POST → SSE subscription → terminal-state surface.
// On `completed`, invalidates the world + city + persons queries so the UI
// reflects the new year.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { subscribeToRun } from '../lib/sse';

export type AdvancePhase = 'idle' | 'enqueueing' | 'running' | 'done' | 'failed';

export interface StepTiming {
  step: string;
  ms: number;
}

export interface AdvanceState {
  phase: AdvancePhase;
  runId: string | null;
  year: number | null;
  error: string | null;
  timings: StepTiming[] | null;
}

const INITIAL: AdvanceState = { phase: 'idle', runId: null, year: null, error: null, timings: null };

export function useYearAdvance(worldId: string | undefined) {
  const qc = useQueryClient();
  const [state, setState] = useState<AdvanceState>(INITIAL);
  const closeRef = useRef<(() => void) | null>(null);

  const cleanup = useCallback(() => {
    if (closeRef.current) {
      closeRef.current();
      closeRef.current = null;
    }
  }, []);

  // Tear down EventSource on unmount.
  useEffect(() => cleanup, [cleanup]);

  const advance = useCallback(async () => {
    if (!worldId) return;
    if (state.phase === 'enqueueing' || state.phase === 'running') return;

    cleanup();
    setState({ phase: 'enqueueing', runId: null, year: null, error: null, timings: null });

    let runId: string;
    let year: number;
    try {
      const resp = await api<{ run_id: string; year: number }>('/api/years/advance', {
        method: 'POST',
        body: JSON.stringify({ world_id: worldId }),
      });
      runId = resp.run_id;
      year = resp.year;
    } catch (err) {
      let message = err instanceof Error ? err.message : 'enqueue_failed';
      if (err instanceof ApiError && err.status === 409) {
        message = 'A year advance is already in progress.';
      }
      setState({ phase: 'failed', runId: null, year: null, error: message, timings: null });
      return;
    }

    setState({ phase: 'running', runId, year, error: null, timings: null });

    closeRef.current = subscribeToRun(runId, {
      onCompleted: (data) => {
        cleanup();
        const timings = Array.isArray(data.timings) ? (data.timings as StepTiming[]) : null;
        setState({ phase: 'done', runId, year: data.year, error: null, timings });
        qc.invalidateQueries({ queryKey: ['world', worldId] });
        qc.invalidateQueries({ queryKey: ['city'] });
        qc.invalidateQueries({ queryKey: ['persons'] });
        qc.invalidateQueries({ queryKey: ['leaderboards'] });
      },
      onFailed: (data) => {
        cleanup();
        setState({ phase: 'failed', runId, year, error: data.error ?? 'year_run_failed', timings: null });
      },
      onError: () => {
        // EventSource auto-reconnects; only surface if the channel is dead.
      },
    });
  }, [worldId, state.phase, cleanup, qc]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, advance, reset, isBusy: state.phase === 'enqueueing' || state.phase === 'running' };
}
