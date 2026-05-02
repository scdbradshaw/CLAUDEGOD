// Floating control panel (Phase 11b).
//
// Pinned bottom-right. Visible whenever a world is in scope (URL has :worldId).
// Shows year + market + pin count, owns the "Advance Year" button + SSE status.
// Phase 13a.12: 1 / 5 / 10 / 50-year batch advance via chaining.

import { useEffect, useRef, useState } from 'react';
import { useWorld } from '../hooks/useWorld';
import { usePinCount, REAL_PERSON_CAP } from '../hooks/usePinCount';
import { useYearAdvance, type StepTiming } from '../hooks/useYearAdvance';

interface Props {
  worldId: string;
}

const STEP_OPTIONS = [1, 5, 10, 50] as const;

export function ControlPanel({ worldId }: Props) {
  const worldQ = useWorld(worldId);
  const pinQ = usePinCount(worldId);
  const advance = useYearAdvance(worldId);

  // Batch state — how many more advances to run after the current one.
  const remainingRef = useRef(0);
  const totalRef = useRef(0);
  // Track which runId we've already chained from so a downstream rerender
  // doesn't fire the chain twice for the same completed year.
  const chainedRunRef = useRef<string | null>(null);
  // User-requested cancel — checked when each year completes; the in-flight
  // year is atomic so it always finishes before we abort chaining.
  const cancelRequestedRef = useRef(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [stoppedAt, setStoppedAt] = useState<{ done: number; total: number } | null>(null);

  // Chain or auto-clear the "done" flash.
  // IMPORTANT: chain branch returns no cleanup — setBatchProgress would
  // otherwise rerender and clearTimeout the next-year kick (showed up as
  // "stuck on year 2").
  useEffect(() => {
    if (advance.phase !== 'done') {
      // Allow the next 'done' to chain.
      if (advance.phase !== 'idle') chainedRunRef.current = null;
      return;
    }
    // Once we've chained from this completed run, don't chain again.
    if (advance.runId && chainedRunRef.current === advance.runId) return;
    chainedRunRef.current = advance.runId ?? '__unknown__';

    // Cancel requested — finish here, don't queue the next year.
    if (cancelRequestedRef.current) {
      const done = totalRef.current - remainingRef.current;
      const total = totalRef.current;
      cancelRequestedRef.current = false;
      remainingRef.current = 0;
      totalRef.current = 0;
      setCancelling(false);
      setBatchProgress(null);
      setStoppedAt(total > 1 ? { done, total } : null);
      const t = setTimeout(() => {
        advance.reset();
        setStoppedAt(null);
      }, 1800);
      return () => clearTimeout(t);
    }

    if (remainingRef.current > 0) {
      remainingRef.current -= 1;
      setBatchProgress({ done: totalRef.current - remainingRef.current, total: totalRef.current });
      setTimeout(() => advance.advance(), 0);
      return;
    }
    const t = setTimeout(() => {
      advance.reset();
      setBatchProgress(null);
    }, 1500);
    return () => clearTimeout(t);
  }, [advance.phase, advance.runId, advance]);

  // If a year fails mid-batch, abort the chain.
  useEffect(() => {
    if (advance.phase === 'failed') {
      remainingRef.current = 0;
      totalRef.current = 0;
      cancelRequestedRef.current = false;
      setBatchProgress(null);
      setCancelling(false);
      setStoppedAt(null);
    }
  }, [advance.phase]);

  const startBatch = (count: number) => {
    if (advance.isBusy || remainingRef.current > 0) return;
    cancelRequestedRef.current = false;
    setCancelling(false);
    setStoppedAt(null);
    remainingRef.current = count - 1;
    totalRef.current = count;
    setBatchProgress(count > 1 ? { done: 0, total: count } : null);
    advance.advance();
  };

  const requestCancel = () => {
    if (remainingRef.current <= 0) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
  };

  const batchActive = batchProgress != null && remainingRef.current > 0;

  const world = worldQ.data?.world;
  const trend = world?.market_trend ?? 0;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded border border-border-warm bg-panel-warm/95 backdrop-blur shadow-2xl shadow-black/50">
      <div className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <span className="text-muted text-[10px] uppercase tracking-[0.2em]">Year</span>
        <span className="font-display text-2xl text-gold-bright tabular-nums">
          {world?.current_year ?? '—'}
        </span>
      </div>

      <div className="px-4 py-3 grid grid-cols-2 gap-3 text-xs border-b border-border-warm">
        <Stat label="Market" value={world ? world.market_index.toFixed(2) : '—'} sub={trendLabel(trend)} />
        <Stat
          label="Real"
          value={pinQ.data != null ? pinQ.data.toLocaleString() : '—'}
          sub={`/ ${REAL_PERSON_CAP.toLocaleString()} cap`}
        />
      </div>

      <div className="px-4 py-3 space-y-2">
        <div className="text-muted text-[10px] uppercase tracking-wider">Advance</div>
        <div className="grid grid-cols-4 gap-1.5">
          {STEP_OPTIONS.map((n) => (
            <button
              key={n}
              onClick={() => startBatch(n)}
              disabled={advance.isBusy}
              className="py-2 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-display tracking-wider disabled:opacity-50 disabled:cursor-not-allowed transition text-sm"
            >
              {n}y
            </button>
          ))}
        </div>
        {batchActive && (
          <button
            onClick={requestCancel}
            disabled={cancelling}
            className="w-full py-1.5 rounded bg-red-700 hover:bg-red-600 text-white text-xs uppercase tracking-widest disabled:opacity-50"
          >
            {cancelling ? 'Stopping after this year…' : 'Stop after current year'}
          </button>
        )}
        <div className="text-center text-xs text-muted h-4">
          {stoppedAt
            ? `stopped at year ${stoppedAt.done} / ${stoppedAt.total}`
            : batchProgress
              ? `year ${batchProgress.done} / ${batchProgress.total}…`
              : labelFor(advance.phase)}
        </div>
        {advance.phase === 'failed' && advance.error && (
          <div className="text-blood text-xs">{advance.error}</div>
        )}
      </div>

      {advance.timings && advance.timings.length > 0 && (
        <TimingBreakdown timings={advance.timings} />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className="font-display text-gold-bright text-base tabular-nums">{value}</div>
      {sub && <div className="text-muted text-[10px]">{sub}</div>}
    </div>
  );
}

function trendLabel(trend: number): string {
  if (trend > 0.001) return `↑ ${trend.toFixed(2)}`;
  if (trend < -0.001) return `↓ ${Math.abs(trend).toFixed(2)}`;
  return '—';
}

function TimingBreakdown({ timings }: { timings: StepTiming[] }) {
  const total = timings.reduce((s, t) => s + t.ms, 0);
  const max = Math.max(...timings.map((t) => t.ms), 1);

  return (
    <div className="border-t border-border-warm px-4 py-3 space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-muted text-[10px] uppercase tracking-wider">Pipeline timing</span>
        <span className="text-muted text-[10px] tabular-nums">{total.toLocaleString()} ms total</span>
      </div>
      {timings.map((t) => (
        <div key={t.step}>
          <div className="flex justify-between text-[10px] mb-0.5">
            <span className="text-parchment/80 font-mono">{t.step}</span>
            <span className="text-muted tabular-nums">{t.ms} ms</span>
          </div>
          <div className="h-1 rounded-full bg-border overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-600"
              style={{ width: `${(t.ms / max) * 100}%` }}
            />
          </div>
        </div>
      ))}
      <div className="pt-1 border-t border-border-warm">
        <div className="flex justify-between text-[10px] mb-0.5">
          <span className="text-gold font-mono uppercase tracking-wider">total</span>
          <span className="text-gold tabular-nums">{total.toLocaleString()} ms</span>
        </div>
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div className="h-full rounded-full bg-gold-dim w-full" />
        </div>
      </div>
    </div>
  );
}

function labelFor(phase: string): string {
  switch (phase) {
    case 'enqueueing':
      return 'Enqueueing…';
    case 'running':
      return 'Advancing…';
    case 'done':
      return 'Year advanced ✓';
    case 'failed':
      return 'Retry advance';
    default:
      return '';
  }
}
