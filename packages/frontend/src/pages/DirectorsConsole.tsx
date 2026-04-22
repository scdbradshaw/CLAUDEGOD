// ============================================================
// Director's Console — all simulation levers in one place.
// Left column: time controls + narration.
// Right column: God Mode panels.
// Bottom: AI Oracle (AIConsole).
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WorldListItem } from '@civ-sim/shared';
import TimeControls     from '../components/TimeControls';
import BulkFilterPanel  from '../components/BulkFilterPanel';
import ForceInteractionPanel from '../components/ForceInteractionPanel';
import ManualEventPanel from '../components/ManualEventPanel';
import HeadlineGenerator from '../components/HeadlineGenerator';
import AIConsole        from '../components/AIConsole';

// ── Bulk Summon ───────────────────────────────────────────────

const ARCHETYPES = ['noble','merchant','soldier','criminal','scholar','priest','farmer','wanderer','artisan','elder'];

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState as useLocalState } from 'react';

function BulkSummon() {
  const qc = useQueryClient();
  const [count,     setCount]     = useLocalState(100);
  const [archetype, setArchetype] = useLocalState('');
  const [result,    setResult]    = useLocalState<string | null>(null);

  const bulk = useMutation({
    mutationFn: () => api.characters.bulk(count, archetype || undefined),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      setResult(`${data.created} souls summoned.`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  return (
    <div className="panel p-4 space-y-3">
      <span className="label text-gold/70">Bulk Summon</span>
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="label block">Count</label>
          <input
            type="number" min={1} max={1000} value={count}
            onChange={e => setCount(Math.min(1000, Math.max(1, parseInt(e.target.value) || 1)))}
            className="input-sm w-24 text-center"
          />
        </div>
        <div className="space-y-1">
          <label className="label block">Archetype</label>
          <select
            value={archetype} onChange={e => setArchetype(e.target.value)}
            className="input-sm"
          >
            <option value="">Random</option>
            {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
        <button
          onClick={() => { setResult(null); bulk.mutate(); }}
          disabled={bulk.isPending}
          className="btn-sim text-xs px-4 py-1.5 disabled:opacity-40"
        >
          {bulk.isPending ? `Summoning…` : `Summon ${count}`}
        </button>
      </div>
      {bulk.isPending && (
        <p className="label text-amber-400/60 animate-pulse">Creating souls…</p>
      )}
      {result && !bulk.isPending && (
        <p className="text-xs text-zinc-300">{result}</p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function DirectorsConsole() {
  const [oracleOpen, setOracleOpen] = useState(false);

  const { data: worlds } = useQuery({
    queryKey: ['worlds'],
    queryFn:  api.worlds.list,
    staleTime: 30_000,
  });
  const activeWorld = worlds?.find((w: WorldListItem) => w.is_active) ?? null;

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header>
        <h1 className="page-title">Director's Console</h1>
        <p className="page-subtitle">All simulation levers — God Mode, time, bulk actions</p>
      </header>

      {/* ── Two-column layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Left — time + narration */}
        <div className="space-y-4">
          <div className="divider">
            <span className="divider-text">◆ Time</span>
          </div>
          <TimeControls />

          {activeWorld && activeWorld.current_year > 1 && (
            <>
              <div className="divider">
                <span className="divider-text">◉ Narrate</span>
              </div>
              <div className="panel p-4 space-y-3">
                <p className="text-[11px] text-muted leading-relaxed">
                  Queue the Chronicler to draft headlines for a completed year.
                  Runs in the background — ticking stays smooth.
                </p>
                <HeadlineGenerator
                  target={{ kind: 'year', value: activeWorld.current_year - 1 }}
                  label={`Generate Year ${activeWorld.current_year - 1} headlines`}
                  compact
                />
              </div>
            </>
          )}

          <div className="divider">
            <span className="divider-text">⚉ Population</span>
          </div>
          <BulkSummon />
        </div>

        {/* Right — God Mode */}
        <div className="space-y-4">
          <div className="divider">
            <span className="divider-text">⚡ God Mode</span>
          </div>
          <BulkFilterPanel />
          <ForceInteractionPanel />
          <ManualEventPanel />
        </div>
      </div>

      {/* ── AI Oracle (collapsed by default) ── */}
      <div className="space-y-2">
        <div className="divider">
          <span className="divider-text">◈ Divine Oracle</span>
        </div>
        <button
          onClick={() => setOracleOpen(o => !o)}
          className="btn-ghost w-full text-xs py-2"
        >
          {oracleOpen ? '▲ Close Oracle' : '▼ Open Oracle — speak your will'}
        </button>
        {oracleOpen && <AIConsole />}
      </div>

    </div>
  );
}
