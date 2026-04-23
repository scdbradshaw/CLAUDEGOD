// ============================================================
// World View — unified home page.
// Layout: Header → Sticky God Console → 3-col stats grid →
// Notables (top-people grid) → Breaking news → God Mode tools →
// Narrate → Oracle → Quick Nav.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import type { WorldListItem } from '@civ-sim/shared';
import StatBar, { statTextColor } from '../components/StatBar';
import ThreeMarketCard from '../components/ThreeMarketCard';
import AgeHistogram         from '../components/AgeHistogram';
import TopPeopleGrid        from '../components/TopPeopleGrid';
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

function pctStr(fraction: number, digits = 0) {
  return `${(fraction * 100).toFixed(digits)}%`;
}

function StatTile({ label, value, color = 'text-gray-100' }: { label: string; value: string; color?: string }) {
  return (
    <div className="panel p-2 text-center">
      <div className="text-[9px] text-muted uppercase tracking-widest truncate">{label}</div>
      <div className={`text-sm font-display font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

// ── Job Income Multiplier + CoL ───────────────────────────────

function JobMultiplier() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['economy'], queryFn: api.economy.getState });
  const [input, setInput] = useState('1');
  const [colPct, setColPct] = useState(30);
  useEffect(() => {
    if (data?.job_income_multiplier != null) setInput(String(data.job_income_multiplier));
    if (data?.col_pct != null) setColPct(Math.round(data.col_pct * 100));
  }, [data?.job_income_multiplier, data?.col_pct]);

  const mulMut = useMutation({
    mutationFn: (m: number) => api.economy.setJobMultiplier(m),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['economy'] }),
  });
  const colMut = useMutation({
    mutationFn: (pct: number) => api.economy.setColPct(pct / 100),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['economy'] }),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="label text-amber-400/70 whitespace-nowrap">Job pay ×</span>
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs
                     text-zinc-100 tabular-nums focus:outline-none focus:border-amber-500"
        />
        <button
          onClick={() => {
            const v = parseFloat(input);
            if (Number.isFinite(v) && v >= 0.1) mulMut.mutate(v);
          }}
          disabled={mulMut.isPending}
          className="btn-sim px-2 py-1 text-[11px] disabled:opacity-40"
        >
          Set
        </button>
      </div>
      <div className="space-y-1">
        <div className="flex justify-between items-center">
          <span className="label text-amber-400/50">Cost of living</span>
          <span className="text-[11px] tabular-nums text-amber-300/80">{colPct}%</span>
        </div>
        <input
          type="range"
          min={0} max={200} step={1} value={colPct}
          onChange={e => setColPct(Number(e.target.value))}
          onMouseUp={() => colMut.mutate(colPct)}
          onTouchEnd={() => colMut.mutate(colPct)}
          className="w-full accent-amber-500"
        />
      </div>
    </div>
  );
}

// ── Bulk Summon ───────────────────────────────────────────────

const ARCHETYPES = ['noble','merchant','soldier','criminal','scholar','priest','farmer','wanderer','artisan','elder'];

function BulkSummon() {
  const qc = useQueryClient();
  const [countStr,  setCountStr]  = useState('100');
  const [archetype, setArchetype] = useState('');
  const [result,    setResult]    = useState<string | null>(null);

  const count = Math.min(10000, Math.max(1, parseInt(countStr) || 1));

  const bulk = useMutation({
    mutationFn: () => api.characters.bulk(count, archetype || undefined),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      setResult(`${data.created} souls summoned.`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  return (
    <div className="space-y-2">
      <span className="label text-gold/70">Summon souls</span>
      <div className="flex gap-2">
        <input
          type="text" value={countStr} onChange={e => setCountStr(e.target.value)}
          className="input-sm w-16 text-center"
        />
        <select
          value={archetype} onChange={e => setArchetype(e.target.value)}
          className="input-sm flex-1 min-w-0"
        >
          <option value="">Random</option>
          {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <button
        onClick={() => { setResult(null); bulk.mutate(); }}
        disabled={bulk.isPending}
        className="btn-sim w-full text-xs py-1.5 disabled:opacity-40"
      >
        {bulk.isPending ? 'Summoning…' : `+ Summon ${count}`}
      </button>
      {result && !bulk.isPending && (
        <p className="text-[10px] text-zinc-400 truncate">{result}</p>
      )}
    </div>
  );
}

// ── Kill Random ───────────────────────────────────────────────

function KillRandom() {
  const qc = useQueryClient();
  const [countStr, setCountStr] = useState('1');
  const [result,   setResult]   = useState<string | null>(null);

  const count = Math.min(10000, Math.max(1, parseInt(countStr) || 1));

  const kill = useMutation({
    mutationFn: () => api.characters.bulkKill(count),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      qc.invalidateQueries({ queryKey: ['worlds'] });
      setResult(`${data.killed} slain.`);
    },
    onError: (e: Error) => setResult(`Error: ${e.message}`),
  });

  return (
    <div className="space-y-2">
      <span className="label text-red-500/70">Kill souls</span>
      <input
        type="text" value={countStr} onChange={e => setCountStr(e.target.value)}
        className="input-sm w-full text-center"
      />
      <button
        onClick={() => { setResult(null); kill.mutate(); }}
        disabled={kill.isPending}
        className="btn-danger w-full text-xs py-1.5 disabled:opacity-40"
      >
        {kill.isPending ? 'Slaying…' : `☠ Kill ${count} random`}
      </button>
      {result && !kill.isPending && (
        <p className="text-[10px] text-zinc-400 truncate">{result}</p>
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

  // Derived: ruleset name comes from the snapshot first, then world list row.
  const rulesetName =
    worldState?.ruleset?.name ??
    activeWorld?.ruleset_name ??
    null;

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

      {/* ── Sticky God Console ── */}
      {/* Stays pinned below the fixed navbar (h-11 = top-11). z-30 < navbar's z-50. */}
      <div className="sticky top-11 z-30 panel-illuminated p-4 backdrop-blur bg-panel/95 border-gold/20 shadow-2xl shadow-black/70">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-gold-dim text-sm">◉</span>
          <span className="label text-gold/80">God Console</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Time */}
          <div className="space-y-1.5">
            <span className="label text-gold/70">Time</span>
            <TimeControls />
          </div>
          {/* Summon */}
          <BulkSummon />
          {/* Kill */}
          <KillRandom />
          {/* Economy knobs */}
          <JobMultiplier />
        </div>
        <div className="mt-3 pt-3 border-t border-border/60">
          <Link to="/characters/new" className="text-[10px] text-gold/60 hover:text-gold transition-colors tracking-widest">
            + Summon a single named soul →
          </Link>
        </div>
      </div>

      {/* ── 3-column Stats Grid ── */}
      {worldState && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* Column 1 — Population / Life */}
          <div className="panel p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="label text-gold/80">Population</span>
              <span className="text-[9px] text-muted tracking-widest">LIFE · AGE · HEALTH</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <StatTile label="Living"   value={worldState.population.toLocaleString()} />
              <StatTile label="Deaths"   value={worldState.total_deaths.toLocaleString()} color="text-red-400" />
              <StatTile
                label="Newborns"
                value={(worldState.age_distribution?.newborn_count ?? 0).toLocaleString()}
                color="text-emerald-300"
              />
            </div>
            {worldState.age_distribution?.buckets && (
              <div>
                <div className="label mb-1.5">Age Distribution</div>
                <AgeHistogram buckets={worldState.age_distribution.buckets} />
              </div>
            )}
            <div className="pt-2 border-t border-border space-y-2">
              <StatBar label="Avg Health"    value={worldState.avg_health} />
              <StatBar label="Avg Happiness" value={worldState.avg_happiness} />
            </div>
            <div className="pt-2 border-t border-border text-[11px] flex justify-between">
              <span className="text-muted">Deaths this year</span>
              <span className="font-medium text-red-300 tabular-nums">
                {worldState.recent_deaths_year?.total?.toLocaleString() ?? 0}
              </span>
            </div>
          </div>

          {/* Column 2 — Economy */}
          <div className="panel p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="label text-gold/80">Economy</span>
              <span className="text-[9px] text-muted tracking-widest">WEALTH · WORK · MARKETS</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatTile
                label="Avg Wealth"
                value={wealthStr(worldState.avg_money)}
                color={statTextColor(Math.min(worldState.avg_money / 500, 100))}
              />
              <StatTile
                label="Median"
                value={wealthStr(worldState.wealth?.median ?? 0)}
              />
              <StatTile
                label="Gini"
                value={(worldState.wealth?.gini ?? 0).toFixed(2)}
                color={
                  (worldState.wealth?.gini ?? 0) < 0.4 ? 'text-emerald-300'
                  : (worldState.wealth?.gini ?? 0) < 0.6 ? 'text-amber-300'
                  : 'text-red-400'
                }
              />
              <StatTile
                label="Top 1%"
                value={pctStr(worldState.wealth?.top_1pct_share ?? 0)}
                color="text-amber-300"
              />
            </div>
            <ThreeMarketCard
              trusUS={{ index: worldState.market_stable_index,   trend: worldState.market_stable_trend }}
              dreamBIG={{ index: worldState.market_index,        trend: worldState.market_trend }}
              riskAwin={{ index: worldState.market_volatile_index, trend: worldState.market_volatile_trend }}
            />
            <div className="pt-2 border-t border-border grid grid-cols-2 gap-2">
              <StatTile
                label="Employed"
                value={pctStr(worldState.employment?.employed_pct ?? 0)}
                color="text-emerald-300"
              />
              <StatTile
                label="Avg Job Pay"
                value={wealthStr(worldState.employment?.avg_job_pay ?? 0)}
              />
            </div>
            {worldState.wealth?.richest && (
              <div className="pt-2 border-t border-border text-[11px] flex justify-between">
                <span className="text-muted">Richest</span>
                <Link to={`/characters/${worldState.wealth.richest.id}`} className="text-gold hover:text-amber-300 truncate">
                  {worldState.wealth.richest.name} · {wealthStr(worldState.wealth.richest.money)}
                </Link>
              </div>
            )}
          </div>

          {/* Column 3 — World / Social */}
          <div className="panel p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="label text-gold/80">World &amp; Social</span>
              <span className="text-[9px] text-muted tracking-widest">TIME · RULES · GROUPS</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatTile label="Year"           value={`${worldState.current_year}`} color="text-gold" />
              <StatTile label="Years Elapsed"  value={`${worldState.year_count}`}   color="text-zinc-300" />
              <StatTile
                label="Ruleset"
                value={rulesetName ?? 'none'}
                color={rulesetName ? 'text-sky-300' : 'text-muted'}
              />
              <StatTile
                label="Last Tick"
                value={worldState.last_tick_ms != null ? `${(worldState.last_tick_ms / 1000).toFixed(1)}s` : '—'}
                color="text-zinc-400"
              />
            </div>
            <div className="pt-2 border-t border-border space-y-2 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted">Religions active</span>
                <Link to="/groups" className="font-medium text-gray-100 tabular-nums hover:text-gold">
                  {(worldState.religions as { top_by_count?: unknown[] })?.top_by_count?.length ?? 0}
                </Link>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Factions active</span>
                <Link to="/groups" className="font-medium text-gray-100 tabular-nums hover:text-gold">
                  {(worldState.factions as { top_by_count?: unknown[] })?.top_by_count?.length ?? 0}
                </Link>
              </div>
              {worldState.religions?.top_by_count?.[0] && (
                <div className="flex justify-between">
                  <span className="text-muted">Largest religion</span>
                  <span className="font-medium text-gray-100 truncate">
                    {worldState.religions.top_by_count[0].name}
                    <span className="text-muted ml-1">({worldState.religions.top_by_count[0].value})</span>
                  </span>
                </div>
              )}
              {worldState.factions?.top_by_count?.[0] && (
                <div className="flex justify-between">
                  <span className="text-muted">Largest faction</span>
                  <span className="font-medium text-gray-100 truncate">
                    {worldState.factions.top_by_count[0].name}
                    <span className="text-muted ml-1">({worldState.factions.top_by_count[0].value})</span>
                  </span>
                </div>
              )}
              <div className="flex justify-between pt-1 border-t border-border/50">
                <span className="text-muted">Active events</span>
                <Link to="/events" className="font-medium text-gray-100 tabular-nums hover:text-gold">
                  {worldState.active_events?.length ?? 0}
                </Link>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* ── Notables (Top People vanity grid) ── */}
      {worldState?.top_people && (
        <section className="space-y-3">
          <div className="divider">
            <span className="divider-text">◆ The Notables ◆</span>
          </div>
          <TopPeopleGrid data={worldState.top_people} />
        </section>
      )}

      {/* ── Breaking news ── */}
      <BreakingNewsStrip />

      {/* ── God Mode actions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <BulkFilterPanel />
        <ForceInteractionPanel />
        <ManualEventPanel />
      </div>

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
