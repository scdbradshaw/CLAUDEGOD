// ============================================================
// TIME CONTROLS
// Advance / rewind the world calendar
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export default function TimeControls() {
  const qc = useQueryClient();
  const [years, setYears]     = useState(1);
  const [result, setResult]   = useState<string | null>(null);

  const { data: timeState } = useQuery({
    queryKey: ['time'],
    queryFn:  api.time.getState,
    staleTime: 0,
  });

  const advance = useMutation({
    mutationFn: () => api.time.advance(years),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['time'] });
      qc.invalidateQueries({ queryKey: ['characters'] });
      const deathNote = data.deaths.length > 0
        ? ` ${data.deaths.length} soul(s) perished: ${data.deaths.join(', ')}.`
        : '';
      setResult(`Advanced to Year ${data.current_year}. ${data.headlines_generated} headlines written.${deathNote}`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  const rewind = useMutation({
    mutationFn: () => api.time.rewind(years),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['time'] });
      qc.invalidateQueries({ queryKey: ['characters'] });
      setResult(`Rewound to Year ${data.current_year} (back ${data.rewound_by} year${data.rewound_by !== 1 ? 's' : ''}).`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  const busy = advance.isPending || rewind.isPending;

  return (
    <div className="panel space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">World Calendar</span>
        <span className="text-2xl font-bold text-amber-400">
          Year {timeState?.current_year ?? '…'}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-400 shrink-0">Jump</label>
        <input
          type="number"
          min={1}
          max={500}
          value={years}
          onChange={e => setYears(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center text-white focus:outline-none focus:border-amber-500"
        />
        <span className="text-xs text-zinc-400">year{years !== 1 ? 's' : ''}</span>
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
          onClick={() => { setResult(null); advance.mutate(); }}
          disabled={busy}
          className="btn btn-god flex-1 text-sm disabled:opacity-40"
        >
          {busy ? 'Processing…' : 'Advance →'}
        </button>
      </div>

      {busy && (
        <p className="text-xs text-amber-400 animate-pulse">
          The chronicles are being written… this may take a moment.
        </p>
      )}

      {result && !busy && (
        <p className="text-xs text-zinc-300 border-t border-zinc-700 pt-2">{result}</p>
      )}
    </div>
  );
}
