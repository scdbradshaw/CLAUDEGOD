// ============================================================
// Dashboard — grid of all characters
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { CharacterListItem, TickResult } from '@civ-sim/shared';
import CharacterCard from '../components/CharacterCard';
import TimeControls from '../components/TimeControls';

// ── Tick Controls ─────────────────────────────────────────────

function TickControls() {
  const qc = useQueryClient();
  const [lastResult, setLastResult] = useState<TickResult | null>(null);

  const tick = useMutation({
    mutationFn: api.interactions.tick,
    onSuccess: (data) => {
      setLastResult(data);
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
  });

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">Heartbeat</span>
        {lastResult && (
          <span className="text-[10px] text-zinc-600">
            Tick {lastResult.tick_number} · Year {lastResult.world_year}
          </span>
        )}
      </div>

      <button
        onClick={() => { setLastResult(null); tick.mutate(); }}
        disabled={tick.isPending}
        className="btn-sim w-full text-xs py-2 disabled:opacity-40"
      >
        {tick.isPending ? 'Running Tick…' : '▶ Run Tick (6 months)'}
      </button>

      {tick.isPending && (
        <p className="text-xs text-amber-400 animate-pulse">The world turns…</p>
      )}

      {lastResult && !tick.isPending && (
        <div className="text-[10px] text-zinc-500 space-y-0.5">
          <div className="flex justify-between">
            <span>Interactions</span>
            <span className="text-zinc-300">{lastResult.interactions_processed}</span>
          </div>
          <div className="flex justify-between">
            <span>Deaths</span>
            <span className={lastResult.deaths_this_tick > 0 ? 'text-red-400' : 'text-zinc-300'}>
              {lastResult.deaths_this_tick}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Births</span>
            <span className={lastResult.births_this_tick > 0 ? 'text-emerald-400' : 'text-zinc-300'}>
              {lastResult.births_this_tick}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Market</span>
            <span className={lastResult.market_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {lastResult.market_return_pct >= 0 ? '+' : ''}{lastResult.market_return_pct.toFixed(1)}%
              → {lastResult.new_market_index.toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {tick.isError && (
        <p className="text-xs text-red-400">{(tick.error as Error).message}</p>
      )}
    </div>
  );
}

// ── Bulk Summon ───────────────────────────────────────────────

const ARCHETYPE_LABELS = ['noble','merchant','soldier','criminal','scholar','priest','farmer','wanderer','artisan','elder'];

function BulkSummon() {
  const qc = useQueryClient();
  const [count,     setCount]     = useState(100);
  const [archetype, setArchetype] = useState('');
  const [result,    setResult]    = useState<string | null>(null);

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
      <span className="text-xs text-zinc-500 uppercase tracking-widest">Bulk Summon</span>

      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="text-[10px] text-muted uppercase tracking-widest block">Count</label>
          <input
            type="number" min={1} max={1000} value={count}
            onChange={e => setCount(Math.min(1000, Math.max(1, parseInt(e.target.value) || 1)))}
            className="w-24 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted uppercase tracking-widest block">Archetype</label>
          <select
            value={archetype} onChange={e => setArchetype(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
          >
            <option value="">Random</option>
            {ARCHETYPE_LABELS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>

        <button
          onClick={() => { setResult(null); bulk.mutate(); }}
          disabled={bulk.isPending}
          className="btn-sim text-xs px-4 py-1.5 disabled:opacity-40"
        >
          {bulk.isPending ? `Summoning ${count}…` : `Summon ${count}`}
        </button>
      </div>

      {bulk.isPending && (
        <p className="text-xs text-amber-400 animate-pulse">Creating {count} souls in one stroke…</p>
      )}
      {result && !bulk.isPending && (
        <p className="text-xs text-zinc-300">{result}</p>
      )}
    </div>
  );
}

export default function Dashboard() {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['characters'],
    queryFn:  () => api.characters.list(1, 50),
    refetchInterval: 10_000,
  });

  // Auto-seed 100 souls if the world is empty
  useEffect(() => {
    if (data && data.total === 0) {
      api.characters.seed().then((result) => {
        if (result.seeded) qc.invalidateQueries({ queryKey: ['characters'] });
      });
    }
  }, [data?.total]);

  // World stats from the list
  const souls        = data?.total ?? 0;
  const totalWealth  = data?.data.reduce((s, c) => s + c.wealth, 0) ?? 0;
  const avgHealth    = data?.data.length
    ? Math.round(data.data.reduce((s, c) => s + c.health, 0) / data.data.length)
    : null;

  const wealthStr = totalWealth >= 1_000_000
    ? `$${(totalWealth / 1_000_000).toFixed(1)}M`
    : totalWealth >= 1_000
    ? `$${(totalWealth / 1_000).toFixed(0)}K`
    : `$${totalWealth.toFixed(0)}`;

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">

      {/* ── Header ── */}
      <header className="mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-gold tracking-widest uppercase leading-tight">
              The Realm
            </h1>
            <p className="text-[11px] text-muted mt-1 tracking-wide">
              {souls > 0
                ? `${souls} soul${souls !== 1 ? 's' : ''} dwell here`
                : 'No souls yet — the world awaits its first inhabitants'}
            </p>
          </div>

          <Link to="/characters/new" className="btn-sim shrink-0 mt-1">
            + Summon Soul
          </Link>
        </div>

        {/* World stats strip */}
        {souls > 0 && (
          <div className="mt-4 flex flex-wrap gap-6 text-[11px] border-t border-border/60 pt-3">
            <span className="text-muted">
              Combined wealth <span className="text-gold font-medium ml-1">{wealthStr}</span>
            </span>
            {avgHealth !== null && (
              <span className="text-muted">
                World health{' '}
                <span className={`font-medium ml-1 ${avgHealth >= 67 ? 'text-emerald-400' : avgHealth >= 34 ? 'text-amber-300' : 'text-red-400'}`}>
                  {avgHealth} / 100
                </span>
              </span>
            )}
          </div>
        )}
      </header>

      {/* ── States ── */}
      {isLoading && (
        <div className="text-muted text-sm animate-pulse">Reading the world…</div>
      )}

      {isError && (
        <div className="panel p-4 border-red-700 text-red-400 text-sm">
          Failed to reach the realm. Is the backend running?
        </div>
      )}

      {/* ── Controls row ── */}
      <div className="mb-6 flex flex-col sm:flex-row gap-4">
        <div className="flex-1 flex flex-col gap-4">
          <TickControls />
          <TimeControls />
          <BulkSummon />
        </div>

        {/* Nav cards */}
        <div className="flex sm:flex-col gap-3 sm:w-40">
          <Link
            to="/world"
            className="panel flex-1 flex flex-col items-center justify-center gap-1 hover:border-amber-700 transition-colors py-4"
          >
            <span className="text-2xl">🌍</span>
            <span className="text-xs text-zinc-400 text-center leading-tight">The World</span>
            <span className="text-[10px] text-zinc-600 text-center">World State</span>
          </Link>
          <Link
            to="/headlines"
            className="panel flex-1 flex flex-col items-center justify-center gap-1 hover:border-amber-700 transition-colors py-4"
          >
            <span className="text-2xl">📜</span>
            <span className="text-xs text-zinc-400 text-center leading-tight">The Chronicle</span>
            <span className="text-[10px] text-zinc-600 text-center">Headlines & History</span>
          </Link>
          <Link
            to="/economy"
            className="panel flex-1 flex flex-col items-center justify-center gap-1 hover:border-amber-700 transition-colors py-4"
          >
            <span className="text-2xl">📈</span>
            <span className="text-xs text-zinc-400 text-center leading-tight">The Exchange</span>
            <span className="text-[10px] text-zinc-600 text-center">Markets & Forces</span>
          </Link>
          <Link
            to="/rip"
            className="panel flex-1 flex flex-col items-center justify-center gap-1 hover:border-zinc-600 transition-colors py-4"
          >
            <span className="text-2xl">✝</span>
            <span className="text-xs text-zinc-400 text-center leading-tight">The Fallen</span>
            <span className="text-[10px] text-zinc-600 text-center">Memorial</span>
          </Link>
        </div>
      </div>

      {/* ── Character grid ── */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {data.data.map((c) => (
            <CharacterCard key={c.id} person={c as CharacterListItem} />
          ))}

          {data.data.length === 0 && (
            <div className="col-span-full panel p-12 text-center">
              <p className="font-display text-gold text-lg tracking-widest mb-2">The World Is Empty</p>
              <p className="text-muted text-sm mb-6">No souls dwell here yet. Breathe life into the first.</p>
              <Link to="/characters/new" className="btn-sim">
                Summon Your First Soul
              </Link>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
