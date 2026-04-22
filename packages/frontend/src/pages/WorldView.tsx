// ============================================================
// World View — unified home page.
// Pulse stats, tick control, world forces, director's console,
// breaking news, and quick nav.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client';
import type { WorldListItem, TickResult } from '@civ-sim/shared';
import { FORCE_CONFIG } from '../constants/forces';
import StatBar, { statTextColor } from '../components/StatBar';
import ThreeMarketCard from '../components/ThreeMarketCard';
import { GLOBAL_TRAITS } from '@civ-sim/shared';
import BulkFilterPanel       from '../components/BulkFilterPanel';
import ForceInteractionPanel from '../components/ForceInteractionPanel';
import ManualEventPanel      from '../components/ManualEventPanel';
import HeadlineGenerator     from '../components/HeadlineGenerator';
import AIConsole             from '../components/AIConsole';

// ── helpers ───────────────────────────────────────────────────

function wealthStr(w: number) {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(0)}K`;
  return `$${w.toFixed(0)}`;
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

// ── Year jump ─────────────────────────────────────────────────

function YearJump() {
  const qc = useQueryClient();
  const [years,  setYears]  = useState(1);
  const [result, setResult] = useState<string | null>(null);

  const advance = useMutation({
    mutationFn: () => api.time.advance(years),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['time'] });
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      const n = data.yearly_reports.length;
      setResult(`Advanced to Year ${data.current_year} · ${n} year-report${n !== 1 ? 's' : ''} filed.`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  const rewind = useMutation({
    mutationFn: () => api.time.rewind(years),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['time'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      setResult(`Rewound to Year ${data.current_year}.`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  const busy = advance.isPending || rewind.isPending;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} max={500} value={years}
          onChange={e => setYears(Math.max(1, parseInt(e.target.value) || 1))}
          className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center text-white focus:outline-none focus:border-amber-500"
        />
        <span className="text-xs text-muted shrink-0">yr{years !== 1 ? 's' : ''}</span>
        <button
          onClick={() => { setResult(null); rewind.mutate(); }}
          disabled={busy}
          className="btn-ghost text-xs px-3 py-1.5 disabled:opacity-40 flex-1"
        >← Rewind</button>
        <button
          onClick={() => { setResult(null); advance.mutate(); }}
          disabled={busy}
          className="btn-god text-xs px-3 py-1.5 disabled:opacity-40 flex-1"
        >{busy ? '…' : 'Advance →'}</button>
      </div>
      {result && !busy && (
        <p className="text-[10px] text-zinc-400 border-t border-border/40 pt-1.5">{result}</p>
      )}
    </div>
  );
}

// ── ForceEditor ────────────────────────────────────────────────

function ForceEditor() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['economy'],
    queryFn:  api.economy.getState,
    refetchInterval: 8_000,
  });

  const [localTraits,   setLocalTraits]   = useState<Record<string, number>>({});
  const [localMults,    setLocalMults]    = useState<Record<string, number>>({});
  const [expanded,      setExpanded]      = useState<Set<string>>(new Set());
  const [multsExpanded, setMultsExpanded] = useState(false);

  const effectiveMults = data ? { ...data.global_trait_multipliers, ...localMults } : localMults;

  const saveTraits = useMutation({
    mutationFn: () => api.economy.setGlobalTraits({ ...data!.global_traits, ...localTraits }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['economy'] }); setLocalTraits({}); },
  });

  const saveMults = useMutation({
    mutationFn: () => api.economy.setMultipliers(effectiveMults),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['economy'] }); setLocalMults({}); },
  });

  if (!data) return <p className="label animate-pulse text-amber-400/60">Loading forces…</p>;

  const traitsAreDirty = Object.keys(localTraits).length > 0;
  const multsAreDirty  = Object.keys(localMults).length  > 0;

  function toggleForce(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <span className="label text-gold/70">Force Values</span>
        {traitsAreDirty && (
          <button
            onClick={() => saveTraits.mutate()}
            disabled={saveTraits.isPending}
            className="btn-god text-[10px] px-3 py-1 disabled:opacity-40"
          >
            {saveTraits.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        )}
      </div>

      {/* ── Force rows (collapsed by default) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {FORCE_CONFIG.map(({ key, label, textColor, borderColor }) => {
          const forceDef  = GLOBAL_TRAITS[key as keyof typeof GLOBAL_TRAITS];
          const isOpen    = expanded.has(key);
          const children  = Object.entries(forceDef.children);

          // Compute avg value across children for the summary score
          const avg = Math.round(
            children.reduce((sum, [child]) => {
              const traitKey = `${key}.${child}`;
              return sum + (localTraits[traitKey] ?? data.global_traits?.[traitKey] ?? 0);
            }, 0) / (children.length || 1)
          );

          return (
            <div key={key} className={`border-l-2 pl-3 ${borderColor}`}>
              {/* Collapsed header — always visible */}
              <button
                onClick={() => toggleForce(key)}
                className="w-full flex items-center justify-between py-1.5 group"
              >
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${textColor}`}>
                  {label}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-zinc-500 tabular-nums">
                    {avg > 0 ? `+${avg}` : avg}
                  </span>
                  <span className="text-[9px] text-muted group-hover:text-zinc-300 transition-colors">
                    {isOpen ? '▲' : '▼'}
                  </span>
                </div>
              </button>

              {/* Expanded sliders */}
              {isOpen && (
                <div className="space-y-3 pb-3">
                  {children.map(([child, childDef]) => {
                    const traitKey  = `${key}.${child}`;
                    const serverVal = data.global_traits?.[traitKey] ?? 0;
                    const val       = localTraits[traitKey] ?? serverVal;
                    return (
                      <div key={child} className="space-y-1">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] text-muted capitalize">
                            {child.replace(/_/g, ' ')}
                          </label>
                          <span className="text-[10px] text-zinc-300 tabular-nums">
                            {val > 0 ? `+${val}` : val}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={(childDef as { min: number; max: number }).min}
                          max={(childDef as { min: number; max: number }).max}
                          step={1}
                          value={val}
                          onChange={e => setLocalTraits(prev => ({ ...prev, [traitKey]: parseInt(e.target.value) }))}
                          className="w-full accent-amber-500"
                        />
                        <p className="text-[9px] text-zinc-700 italic">
                          {(childDef as { description?: string }).description ?? ''}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Effect Multipliers (collapsible) ── */}
      <div className="pt-3 border-t border-border">
        <button
          onClick={() => setMultsExpanded(o => !o)}
          className="w-full flex items-center justify-between py-1 group"
        >
          <div className="flex items-center gap-2">
            <span className="label text-gold/60">Effect Multipliers</span>
            {multsAreDirty && (
              <span className="text-[9px] text-amber-500">● unsaved</span>
            )}
          </div>
          <span className="text-[9px] text-muted group-hover:text-zinc-300 transition-colors">
            {multsExpanded ? '▲' : '▼'}
          </span>
        </button>

        {multsExpanded && (
          <div className="space-y-4 mt-3">
            <div className="flex justify-end">
              {multsAreDirty && (
                <button
                  onClick={() => saveMults.mutate()}
                  disabled={saveMults.isPending}
                  className="btn-god text-[10px] px-3 py-1 disabled:opacity-40"
                >
                  {saveMults.isPending ? 'Saving…' : 'Save Changes'}
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {FORCE_CONFIG.map(({ key, label, textColor }) => {
                const val = effectiveMults[key] ?? 1.0;
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between">
                      <label className={`text-xs font-medium ${textColor}`}>{label}</label>
                      <span className="text-[11px] text-zinc-400">{val.toFixed(2)}×</span>
                    </div>
                    <input
                      type="range"
                      min={0} max={5} step={0.1} value={val}
                      onChange={e => setLocalMults(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                      className="w-full accent-amber-500"
                    />
                    <div className="flex justify-between text-[9px] text-zinc-700">
                      <span>0×</span><span>2.5×</span><span>5×</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
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
              ? `${worldState.population.toLocaleString()} souls · Year ${worldState.current_year} · ${worldState.tick_count} ticks`
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
              { label: 'Avg Wealth',      value: wealthStr(worldState.avg_wealth),         color: statTextColor(Math.min(worldState.avg_wealth / 500, 100)) },
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
              { label: 'Ticks Run',       value: worldState.tick_count.toString(),         color: 'text-zinc-300' },
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
          {/* Single tick */}
          <div className="space-y-1.5">
            <span className="label text-gold/80">Tick — 6 months</span>
            <TickButton />
          </div>

          {/* Year jump */}
          <div className="space-y-1.5 pt-3 border-t border-border">
            <span className="label text-gold/70">Jump years</span>
            <YearJump />
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
            <span className={`font-medium ${statTextColor(Math.min(worldState.avg_wealth / 1000, 100))}`}>
              {wealthStr(worldState.avg_wealth)}
            </span>
          </div>
        </div>
      )}

      {/* ── World forces ── */}
      {worldState && (
        <div className="panel p-5 space-y-5">
          <span className="label text-gold/80">World Forces</span>
          <ForceEditor />
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
