// ============================================================
// World View — unified home page.
// Pulse stats, year control, world forces, director's console,
// breaking news, and quick nav.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client';
import type { WorldListItem } from '@civ-sim/shared';
import StatBar, { statTextColor } from '../components/StatBar';
import ThreeMarketCard from '../components/ThreeMarketCard';
import BulkFilterPanel       from '../components/BulkFilterPanel';
import ForceInteractionPanel from '../components/ForceInteractionPanel';
import ManualEventPanel      from '../components/ManualEventPanel';
import HeadlineGenerator     from '../components/HeadlineGenerator';
import AIConsole             from '../components/AIConsole';
import TimeControls          from '../components/TimeControls';

// ── helpers ───────────────────────────────────────────────────

function wealthStr(w: number) {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(0)}K`;
  return `$${w.toFixed(0)}`;
}

// ── Bulk Summon ───────────────────────────────────────────────

const ARCHETYPES = ['noble','merchant','soldier','criminal','scholar','priest','farmer','wanderer','artisan','elder'];

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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <label className="label block">Count</label>
          <input
            type="number" min={1} max={1000} value={count}
            onChange={e => setCount(Math.min(1000, Math.max(1, parseInt(e.target.value) || 1)))}
            className="input-sm w-20 text-center"
          />
        </div>
        <div className="space-y-1 flex-1 min-w-[100px]">
          <label className="label block">Archetype</label>
          <select
            value={archetype} onChange={e => setArchetype(e.target.value)}
            className="input-sm w-full"
          >
            <option value="">Random</option>
            {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>
      <button
        onClick={() => { setResult(null); bulk.mutate(); }}
        disabled={bulk.isPending}
        className="btn-sim w-full text-xs py-1.5 disabled:opacity-40"
      >
        {bulk.isPending ? 'Summoning…' : `Bulk summon ${count}`}
      </button>
      {bulk.isPending && (
        <p className="label text-amber-400/60 animate-pulse">Creating souls…</p>
      )}
      {result && !bulk.isPending && (
        <p className="text-[10px] text-zinc-400">{result}</p>
      )}
    </div>
  );
}

// ── Kill Random ───────────────────────────────────────────────

function KillRandom() {
  const qc = useQueryClient();
  const [count,  setCount]  = useState(1);
  const [result, setResult] = useState<string | null>(null);

  const kill = useMutation({
    mutationFn: () => api.characters.bulkKill(count),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      qc.invalidateQueries({ queryKey: ['worlds'] });
      setResult(`${data.killed} soul${data.killed !== 1 ? 's' : ''} slain.`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} max={1000} value={count}
          onChange={e => setCount(Math.min(1000, Math.max(1, parseInt(e.target.value) || 1)))}
          className="input-sm w-20 text-center"
        />
        <button
          onClick={() => { setResult(null); kill.mutate(); }}
          disabled={kill.isPending}
          className="btn-danger flex-1 text-xs py-1.5 disabled:opacity-40"
        >
          {kill.isPending ? 'Slaying…' : `☠ Kill ${count} random`}
        </button>
      </div>
      {result && !kill.isPending && (
        <p className="text-[10px] text-zinc-400">{result}</p>
      )}
    </div>
  );
}

// ── Breaking news strip ───────────────────────────────────────

const CATEGORY_GLYPHS: Record<string, string> = {
  MOST_DRAMATIC_FALL:  '↘',
  MOST_INSPIRING_RISE: '↗',
  GREATEST_VILLAIN:    '☠',
  MOST_TRAGIC:         '✦',
  BEST_LOVE_STORY:     '♥',
  MOST_CRIMINAL:       '⚖',
  RAGS_TO_RICHES:      '◆',
  RICHES_TO_RAGS:      '◇',
  MOST_INFLUENTIAL:    '★',
  LONGEST_SURVIVING:   '⌛',
};

const TONE_COLOR: Record<string, string> = {
  tabloid:   'text-pink-300',
  literary:  'text-slate-300',
  epic:      'text-amber-300',
  reportage: 'text-sky-300',
  neutral:   'text-zinc-400',
};

function BreakingNewsStrip() {
  const { data: headlines = [] } = useQuery({
    queryKey: ['headlines', 'ANNUAL', ''],
    queryFn:  () => api.time.headlines({ type: 'ANNUAL' }),
    staleTime: 30_000,
  });

  const recent = headlines.slice(0, 4);
  if (recent.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="divider">
        <span className="divider-text">◆ Breaking Chronicle ◆</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {recent.map(h => (
          <div key={h.id} className="panel p-4 space-y-2 hover:border-border-warm transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-gold-dim text-lg">{CATEGORY_GLYPHS[h.category] ?? '◉'}</span>
              <span className={`text-[9px] uppercase tracking-widest ${TONE_COLOR[h.tone ?? 'neutral'] ?? 'text-zinc-400'}`}>
                {h.tone ?? 'neutral'}
              </span>
              <span className="text-[9px] text-zinc-600 ml-auto">yr {h.year}</span>
            </div>
            <p className="text-xs text-gray-200 leading-snug font-medium">{h.headline}</p>
            {h.person_name && (
              <p className="text-[10px] text-muted">{h.person_name}</p>
            )}
          </div>
        ))}
      </div>
      <div className="text-right">
        <Link to="/chronicle" className="text-[10px] text-gold/60 hover:text-gold transition-colors tracking-widest">
          Open the Chronicle →
        </Link>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function WorldView() {
  const [oracleOpen, setOracleOpen] = useState(false);

  const { data: worldState } = useQuery({
    queryKey: ['world'],
    queryFn:  api.world.getState,
    refetchInterval: 8_000,
  });

  const { data: worlds } = useQuery({
    queryKey: ['worlds'],
    queryFn:  api.worlds.list,
    staleTime: 30_000,
  });
  const activeWorld = worlds?.find((w: WorldListItem) => w.is_active) ?? null;

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="page-title">
            {activeWorld ? activeWorld.name : 'The Realm'}
          </h1>
          <p className="page-subtitle">
            {worldState
              ? `${worldState.population.toLocaleString()} souls · Year ${worldState.current_year}`
              : 'Reading the world…'
            }
          </p>
        </div>
      </header>

      {/* ── Stats + Controls ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Stat cards */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {worldState && <>
            {[
              { label: 'Population',      value: worldState.population.toLocaleString(),  color: 'text-gray-100' },
              { label: 'Year',            value: `${worldState.current_year}`,             color: 'text-gold'     },
              { label: 'Avg Health',      value: `${Math.round(worldState.avg_health)}`,   color: worldState.avg_health >= 67 ? 'text-emerald-400' : worldState.avg_health >= 34 ? 'text-amber-300' : 'text-red-400' },
              { label: 'Avg Wealth',      value: wealthStr(worldState.avg_money),          color: statTextColor(Math.min(worldState.avg_money / 500, 100)) },
              { label: 'Souls Lost',      value: worldState.total_deaths.toLocaleString(), color: 'text-red-400'  },
            ].map(({ label, value, color }) => (
              <div key={label} className="panel p-3 text-center">
                <div className="label mb-1">{label}</div>
                <div className={`text-xl font-bold font-display tabular-nums ${color}`}>{value}</div>
              </div>
            ))}

            <ThreeMarketCard
              trusUS={{ index: worldState.market_stable_index,   trend: worldState.market_stable_trend }}
              dreamBIG={{ index: worldState.market_index,        trend: worldState.market_trend }}
              riskAwin={{ index: worldState.market_volatile_index, trend: worldState.market_volatile_trend }}
            />

            {[
              { label: 'Years Elapsed',   value: worldState.year_count.toString(),         color: 'text-zinc-300' },
              { label: 'Population Tier', value: activeWorld?.population_tier ?? '—',      color: 'text-muted'    },
            ].map(({ label, value, color }) => (
              <div key={label} className="panel p-3 text-center">
                <div className="label mb-1">{label}</div>
                <div className={`text-xl font-bold font-display tabular-nums ${color}`}>{value}</div>
              </div>
            ))}
          </>}
        </div>

        {/* Combined controls panel */}
        <div className="panel-illuminated p-4 space-y-5">
          {/* Year advance / rewind — handled by TimeControls (async pipeline) */}
          <div className="space-y-1.5">
            <span className="label text-gold/80">Time</span>
            <TimeControls />
          </div>

          {/* Summon */}
          <div className="space-y-2 pt-3 border-t border-border">
            <span className="label text-gold/70">Summon souls</span>
            <Link to="/characters/new" className="btn-sim block text-center text-xs py-1.5">
              + Summon one →
            </Link>
            <BulkSummon />
          </div>

          {/* Kill */}
          <div className="space-y-2 pt-3 border-t border-border">
            <span className="label text-red-500/70">Kill souls</span>
            <KillRandom />
          </div>
        </div>
      </div>

      {/* ── God Mode actions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BulkFilterPanel />
        <ForceInteractionPanel />
        <ManualEventPanel />
      </div>

      {/* ── Population averages ── */}
      {worldState && (
        <div className="panel p-5 space-y-3">
          <span className="label text-gold/70">Population Averages</span>
          <StatBar label="Avg Health" value={worldState.avg_health} />
          <div className="pt-2 border-t border-border text-[11px]">
            <span className="text-muted">Avg Wealth </span>
            <span className={`font-medium ${statTextColor(Math.min(worldState.avg_money / 1000, 100))}`}>
              {wealthStr(worldState.avg_money)}
            </span>
          </div>
        </div>
      )}

      {/* ── Narrate ── */}
      {activeWorld && activeWorld.current_year > 1 && (
        <div className="panel p-4 space-y-3">
          <span className="label text-gold/70">◉ Narrate</span>
          <p className="text-[11px] text-muted leading-relaxed">
            Queue the Chronicler to draft headlines for a completed year. Runs in the background.
          </p>
          <HeadlineGenerator
            target={{ kind: 'year', value: activeWorld.current_year - 1 }}
            label={`Generate Year ${activeWorld.current_year - 1} headlines`}
            compact
          />
        </div>
      )}

      {/* ── AI Oracle ── */}
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

      {/* ── Breaking news ── */}
      <BreakingNewsStrip />

      {/* ── Quick nav ── */}
      <div className="divider">
        <span className="divider-text">Navigate</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { to: '/souls',     label: 'The Souls',  sub: 'Browse all lives', glyph: '⚉' },
          { to: '/chronicle', label: 'Chronicle',  sub: 'Story feed',       glyph: '◉' },
          { to: '/exchange',  label: 'Exchange',   sub: 'Markets',          glyph: '◈' },
          { to: '/fallen',    label: 'The Fallen', sub: 'Memorial',         glyph: '✝' },
        ].map(({ to, label, sub, glyph }) => (
          <Link
            key={to}
            to={to}
            className="panel p-4 flex flex-col gap-1 hover:border-border-warm transition-colors group"
          >
            <span className="text-xl text-gold-dim group-hover:text-gold transition-colors">{glyph}</span>
            <span className="text-xs text-gray-300 font-medium">{label}</span>
            <span className="text-[10px] text-muted">{sub}</span>
          </Link>
        ))}
      </div>

    </div>
  );
}
