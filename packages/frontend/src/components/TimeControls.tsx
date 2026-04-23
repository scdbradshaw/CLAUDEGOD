// ============================================================
// TIME CONTROLS — §0.5 Phase 2 + Phase 6
// Advance Year via async pipeline. The global PipelineProvider
// owns the SSE subscription + progress state, so this component
// only needs to fire the POST and show its inline status.
// Rewind stays synchronous.
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { usePipeline } from './PipelineProvider';

const REWIND_YEARS = 1;

export default function TimeControls() {
  const qc = useQueryClient();
  const { running, attach } = usePipeline();

  const [result, setResult] = useState<string | null>(null);

  const { data: timeState } = useQuery({
    queryKey: ['time'],
    queryFn:  api.time.getState,
    staleTime: 0,
  });

  // ── Advance Year ─────────────────────────────────────────────
  const advance = useMutation({
    mutationFn: api.years.advance,
    onSuccess: ({ year_run_id }) => {
      setResult(null);
      attach(year_run_id);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  // ── Rewind (stays synchronous) ───────────────────────────────
  const rewind = useMutation({
    mutationFn: () => api.time.rewind(REWIND_YEARS),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['time'] });
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      setResult(`Rewound to Year ${data.current_year} (back ${data.rewound_by} year${data.rewound_by !== 1 ? 's' : ''}).`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  const advancing = running || advance.isPending;
  const busy      = advancing || rewind.isPending;

  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">World Calendar</span>
        <span className="text-2xl font-bold text-amber-400">
          Year {timeState?.current_year ?? '…'}
        </span>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => { setResult(null); rewind.mutate(); }}
          disabled={busy || (timeState?.current_year ?? 1) <= 1}
          className="btn btn-ghost flex-1 text-sm disabled:opacity-40"
        >
          ← Rewind
        </button>
        <button
          onClick={() => { advance.mutate(); }}
          disabled={busy}
          title={advancing ? 'A year is already running — see the heartbeat above.' : undefined}
          className="btn btn-god flex-1 text-sm disabled:opacity-40"
        >
          {advancing ? 'Running…' : 'Advance Year →'}
        </button>
      </div>

      {advancing && (
        <p className="text-[10px] text-amber-400/70">
          Pipeline progress is shown in the bar at the top of the screen.
        </p>
      )}

      {result && !busy && (
        <p className="text-xs text-zinc-300 border-t border-zinc-700 pt-2">{result}</p>
      )}
    </div>
  );
}
