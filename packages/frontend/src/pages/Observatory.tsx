// ============================================================
// Observatory — home page.
// World pulse + breaking news strip + quick tick button.
// The character grid has moved to /souls.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client';
import type { WorldListItem, TickResult } from '@civ-sim/shared';
import { FORCE_CONFIG } from '../constants/forces';
import StatBar, { statTextColor } from '../components/StatBar';
import { GLOBAL_TRAITS } from '@civ-sim/shared';

// ── helpers ───────────────────────────────────────────────────

function wealthStr(w: number) {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(0)}K`;
  return `$${w.toFixed(0)}`;
}

function forceScore(key: string, traits: Record<string, number>): number {
  const children = Object.keys((GLOBAL_TRAITS as Record<string, { children: Record<string, { min: number; max: number }> }>)[key]?.children ?? {});
  if (!children.length) return 0;
  const defs = (GLOBAL_TRAITS as Record<string, { children: Record<string, { min: number; max: number }> }>)[key].children;
  const total = children.reduce((sum, child) => {
    const val = traits[`${key}.${child}`] ?? 0;
    const def = defs[child];
    const norm = def.max === def.min ? 50 : Math.round(((val - def.min) / (def.max - def.min)) * 100);
    return sum + norm;
  }, 0);
  return Math.round(total / children.length);
}

// ── Tick button ───────────────────────────────────────────────

function TickButton() {
  const qc = useQueryClient();
  const [last, setLast] = useState<TickResult | null>(null);

  const tick = useMutation({
    mutationFn: api.interactions.tick,
    onSuccess: (data) => {
      setLast(data);
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      qc.invalidateQueries({ queryKey: ['worlds'] });
    },
  });

  return (
    <div className="space-y-2">
      <button
        onClick={() => { setLast(null); tick.mutate(); }}
        disabled={tick.isPending}
        className="btn-sim w-full py-2.5 text-sm tracking-wide disabled:opacity-40"
      >
        {tick.isPending ? 'The world turns…' : '▶ Run Tick  —  6 months'}
      </button>

      {tick.isPending && (
        <p className="label text-amber-400/70 animate-pulse">Processing interactions…</p>
      )}

      {last && !tick.isPending && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <span className="text-muted">Tick</span>
          <span className="text-gray-300 tabular-nums">{last.tick_number}</span>
          <span className="text-muted">Interactions</span>
          <span className="text-gray-300 tabular-nums">{last.interactions_processed}</span>
          <span className="text-muted">Deaths</span>
          <span className={`tabular-nums ${last.deaths_this_tick > 0 ? 'text-red-400' : 'text-gray-500'}`}>
            {last.deaths_this_tick}
          </span>
          <span className="text-muted">Births</span>
          <span className={`tabular-nums ${last.births_this_tick > 0 ? 'text-emerald-400' : 'text-gray-500'}`}>
            {last.births_this_tick}
          </span>
          <span className="text-muted">Market</span>
          <span className={`tabular-nums ${last.market_return_pct >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {last.market_return_pct >= 0 ? '+' : ''}{last.market_return_pct.toFixed(1)}%
          </span>
        </div>
      )}

      {tick.isError && (
        <p className="text-xs text-red-400">{(tick.error as Error).message}</p>
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

  // Take the 4 most recent (highest year), one per category
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

export default function Observatory() {
  const { data: worldState } = useQuery({
    queryKey: ['world'],
    queryFn:  api.world.getState,
    refetchInterval: 10_000,
  });

  const { data: worlds } = useQuery({
    queryKey: ['worlds'],
    queryFn:  api.worlds.list,
    staleTime: 30_000,
  });
  const activeWorld = worlds?.find((w: WorldListItem) => w.is_active) ?? null;

  const { data: timeState } = useQuery({
    queryKey: ['time'],
    queryFn:  api.time.getState,
    staleTime: 5_000,
  });

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
              ? `${worldState.population.toLocaleString()} souls · Year ${worldState.current_year} · ${worldState.tick_count} ticks`
              : 'Reading the world…'
            }
          </p>
        </div>
        <Link to="/characters/new" className="btn-sim self-start sm:self-auto shrink-0">
          + Summon Soul
        </Link>
      </header>

      {/* ── World vitals + Tick ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Pulse stats */}
        <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {worldState && [
            { label: 'Population',   value: worldState.population.toLocaleString(),       color: 'text-gray-100' },
            { label: 'Year',         value: `${worldState.current_year}`,                  color: 'text-gold'     },
            { label: 'Avg Health',   value: `${Math.round(worldState.avg_health)}`,        color: worldState.avg_health >= 67 ? 'text-emerald-400' : worldState.avg_health >= 34 ? 'text-amber-300' : 'text-red-400' },
            { label: 'Avg Wealth',   value: wealthStr(worldState.avg_wealth),              color: statTextColor(Math.min(worldState.avg_wealth / 500, 100)) },
            { label: 'Souls Lost',   value: worldState.total_deaths.toLocaleString(),      color: 'text-red-400'  },
            { label: 'Market Index', value: worldState.market_index.toFixed(2),            color: worldState.market_trend >= 0 ? 'text-emerald-400' : 'text-red-400' },
            { label: 'Ticks Run',    value: worldState.tick_count.toString(),              color: 'text-zinc-300' },
            { label: 'Population Tier', value: activeWorld?.population_tier ?? '—',       color: 'text-muted'    },
          ].map(({ label, value, color }) => (
            <div key={label} className="panel p-3 text-center">
              <div className="label mb-1">{label}</div>
              <div className={`text-xl font-bold font-display tabular-nums ${color}`}>{value}</div>
            </div>
          ))}
        </div>

        {/* Tick control */}
        <div className="panel-illuminated p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="label text-gold/80">Heartbeat</span>
            {timeState && (
              <span className="text-xs font-display text-gold tabular-nums">
                Year {timeState.current_year}
              </span>
            )}
          </div>
          <TickButton />
          <div className="pt-2 border-t border-border">
            <Link
              to="/console"
              className="text-[10px] text-muted hover:text-gold transition-colors tracking-widest"
            >
              ⚡ Open Director's Console →
            </Link>
          </div>
        </div>
      </div>

      {/* ── World forces ── */}
      {worldState && (
        <div className="panel p-5 space-y-4">
          <div className="flex items-center justify-between">
            <span className="label text-gold/80">World Forces</span>
            <Link to="/world" className="text-[10px] text-gold/50 hover:text-gold transition-colors">
              Full breakdown →
            </Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {FORCE_CONFIG.map(({ key, label, textColor }) => {
              const score = forceScore(key, worldState.global_traits);
              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className={`text-[10px] font-medium uppercase tracking-widest ${textColor}`}>
                      {label}
                    </span>
                    <span className={`text-[10px] tabular-nums ${textColor}`}>{score}</span>
                  </div>
                  <StatBar label="" value={score} showValue={false} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Breaking news ── */}
      <BreakingNewsStrip />

      {/* ── Quick nav ── */}
      <div className="divider">
        <span className="divider-text">Navigate</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { to: '/souls',     label: 'The Souls',    sub: 'Browse all lives',      glyph: '⚉' },
          { to: '/chronicle', label: 'Chronicle',    sub: 'Story feed',            glyph: '◉' },
          { to: '/world',     label: 'The World',    sub: 'Forces & state',        glyph: '⊕' },
          { to: '/exchange',  label: 'Exchange',     sub: 'Markets',               glyph: '◈' },
          { to: '/fallen',    label: 'The Fallen',   sub: 'Memorial',              glyph: '✝' },
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
