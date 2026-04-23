// ============================================================
// PipelineProvider — global awareness of the year-pipeline state.
// Phase 6: every page can call usePipeline() to know if a year is
// running (so Advance buttons get disabled) and read the current
// phase + progress (driving the sticky heartbeat bar).
//
// On mount: polls /api/years/running so a refresh mid-pipeline
// re-attaches to the SSE stream automatically.
// ============================================================

import {
  createContext, useContext, useEffect, useRef, useState, useCallback,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { YearRunPhase, YearRunStatus, YearRunUpdate } from '../api/client';

interface PipelineState {
  /** A year-run is currently in flight. */
  running:      boolean;
  yearRunId:    string | null;
  year:         number | null;
  phase:        YearRunPhase | null;
  progressPct:  number;
  status:       YearRunStatus | null;
  message:      string | null;
  /** Begin tracking a new year-run id (call after POST /api/years/advance). */
  attach:       (yearRunId: string) => void;
}

const PipelineContext = createContext<PipelineState | null>(null);

const REATTACH_POLL_MS = 5_000;

export function PipelineProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const [yearRunId,   setYearRunId]   = useState<string | null>(null);
  const [year,        setYear]        = useState<number | null>(null);
  const [phase,       setPhase]       = useState<YearRunPhase | null>(null);
  const [progressPct, setProgressPct] = useState(0);
  const [status,      setStatus]      = useState<YearRunStatus | null>(null);
  const [message,     setMessage]     = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
  }, []);

  const openStream = useCallback((id: string, initialYear: number | null) => {
    cleanup();
    setYearRunId(id);
    setYear(initialYear);
    setStatus('running');

    const es = new EventSource(api.years.streamUrl(id));
    esRef.current = es;

    es.onmessage = (evt) => {
      const update: YearRunUpdate = JSON.parse(evt.data);
      setPhase(update.phase);
      setProgressPct(update.progress_pct);
      setStatus(update.status);
      setMessage(update.message ?? null);

      if (update.status === 'completed' || update.status === 'failed') {
        cleanup();
        // Refresh anything that depends on world state
        qc.invalidateQueries({ queryKey: ['world']       });
        qc.invalidateQueries({ queryKey: ['worlds']      });
        qc.invalidateQueries({ queryKey: ['characters']  });
        qc.invalidateQueries({ queryKey: ['time']        });
        qc.invalidateQueries({ queryKey: ['world-events']});
        qc.invalidateQueries({ queryKey: ['event-history']});

        // Hold the completed/failed status briefly so the bar can show "Complete"
        setTimeout(() => {
          setYearRunId(null);
          setYear(null);
          setPhase(null);
          setProgressPct(0);
          setStatus(null);
          setMessage(null);
        }, 1500);
      }
    };

    es.onerror = () => {
      // Browser may auto-reconnect; if the run actually finished we'll
      // get told on the next message. Don't tear down state here.
      // If the SSE truly died, the next poll cycle will detect "no running"
      // and clear state.
    };
  }, [cleanup, qc]);

  // ── Initial poll + recovery loop ─────────────────────────────
  // On mount, see if there's already a year-run going (e.g. user
  // refreshed the page mid-pipeline) and re-attach. While idle,
  // poll periodically as a safety net in case SSE was missed.
  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const running = await api.years.running();
        if (cancelled) return;

        if (running && running.status === 'running') {
          // Only (re)attach if we're not already tracking it
          if (esRef.current === null && yearRunId !== running.id) {
            openStream(running.id, running.year);
          }
        }
      } catch {
        // Network blip — try again on next interval
      }
    }

    check();
    const interval = setInterval(check, REATTACH_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [openStream, yearRunId]);

  // Tear down the SSE if the provider unmounts
  useEffect(() => () => cleanup(), [cleanup]);

  const value: PipelineState = {
    running:     yearRunId !== null && status !== 'completed' && status !== 'failed',
    yearRunId,
    year,
    phase,
    progressPct,
    status,
    message,
    attach:      (id: string) => openStream(id, null),
  };

  return (
    <PipelineContext.Provider value={value}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipeline(): PipelineState {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipeline must be used inside <PipelineProvider>');
  return ctx;
}
