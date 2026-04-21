// ============================================================
// HEADLINES PAGE
// Chronicle archive — annual headlines (10yr) + decade summaries
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Headline, type Tone } from '../api/client';
import HeadlineGenerator from '../components/HeadlineGenerator';

// ── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; color: string; icon: string }> = {
  MOST_DRAMATIC_FALL:  { label: 'Greatest Fall',      color: 'text-red-400',    icon: '↘' },
  MOST_INSPIRING_RISE: { label: 'Inspiring Rise',     color: 'text-emerald-400',icon: '↗' },
  GREATEST_VILLAIN:    { label: 'Greatest Villain',   color: 'text-purple-400', icon: '☠' },
  MOST_TRAGIC:         { label: 'Most Tragic',        color: 'text-blue-400',   icon: '✦' },
  BEST_LOVE_STORY:     { label: 'Love Story',         color: 'text-pink-400',   icon: '♥' },
  MOST_CRIMINAL:       { label: 'Most Criminal',      color: 'text-orange-400', icon: '⚖' },
  RAGS_TO_RICHES:      { label: 'Rags to Riches',     color: 'text-yellow-400', icon: '◆' },
  RICHES_TO_RAGS:      { label: 'Riches to Rags',     color: 'text-zinc-400',   icon: '◇' },
  MOST_INFLUENTIAL:    { label: 'Most Influential',   color: 'text-cyan-400',   icon: '★' },
  LONGEST_SURVIVING:   { label: 'Longest Surviving',  color: 'text-lime-400',   icon: '⌛' },
};

// ── Tone metadata ──────────────────────────────────────────────────────────
// Colors pulled to give each voice a distinct chip — tabloid = hot pink
// (scandal), literary = slate (restraint), epic = amber (mythic gold),
// reportage = sky (newsprint blue), neutral = zinc (plain log).

const TONE_META: Record<Tone, { label: string; className: string }> = {
  tabloid:   { label: 'Tabloid',   className: 'bg-pink-500/10   text-pink-300   border-pink-500/30'   },
  literary:  { label: 'Literary',  className: 'bg-slate-500/10  text-slate-300  border-slate-500/30'  },
  epic:      { label: 'Epic',      className: 'bg-amber-500/10  text-amber-300  border-amber-500/30'  },
  reportage: { label: 'Reportage', className: 'bg-sky-500/10    text-sky-300    border-sky-500/30'    },
  neutral:   { label: 'Neutral',   className: 'bg-zinc-500/10   text-zinc-400   border-zinc-500/30'   },
};

function TonePill({ tone }: { tone?: Tone }) {
  if (!tone) return null;
  const meta = TONE_META[tone] ?? TONE_META.neutral;
  return (
    <span
      className={`inline-flex items-center text-[9px] uppercase tracking-widest px-1.5 py-0.5 border rounded ${meta.className}`}
      title={`Narrative voice: ${meta.label.toLowerCase()}`}
    >
      {meta.label}
    </span>
  );
}

// ── HeadlineCard ───────────────────────────────────────────────────────────

function HeadlineCard({ h }: { h: Headline }) {
  const [expanded, setExpanded] = useState(false);
  const meta = CATEGORY_META[h.category] ?? { label: h.category, color: 'text-zinc-400', icon: '◉' };

  return (
    <div
      className="panel cursor-pointer hover:border-zinc-600 transition-colors"
      onClick={() => setExpanded(x => !x)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`text-lg shrink-0 ${meta.color}`}>{meta.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className={`text-[10px] uppercase tracking-widest ${meta.color}`}>{meta.label}</p>
              <TonePill tone={h.tone} />
            </div>
            <p className="text-sm font-semibold text-white leading-snug">{h.headline}</p>
            {h.person_name && (
              <p className="text-xs text-zinc-500 mt-0.5">
                {h.person_id
                  ? <Link to={`/characters/${h.person_id}`} onClick={e => e.stopPropagation()} className="hover:text-amber-400 transition-colors">{h.person_name}</Link>
                  : h.person_name
                }
              </p>
            )}
          </div>
        </div>
        <span className="text-zinc-600 text-xs shrink-0">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <p className="text-xs text-zinc-400 leading-relaxed mt-3 border-t border-zinc-700 pt-3">
          {h.story}
        </p>
      )}
    </div>
  );
}

// ── GenerateHeadlineForm ───────────────────────────────────────────────────
// Small inline form on the Chronicle toolbar — picks a year (or decade start)
// based on the active view and enqueues a headline generation job.

function GenerateHeadlineForm({ view, currentYear }: { view: 'ANNUAL' | 'DECADE'; currentYear: number }) {
  const defaultYear   = Math.max(1, currentYear - 1);
  const defaultDecade = Math.floor(Math.max(0, currentYear - 10) / 10) * 10;
  const [year, setYear]     = useState(defaultYear);
  const [decade, setDecade] = useState(defaultDecade);

  if (view === 'ANNUAL') {
    return (
      <div className="flex items-center gap-2 ml-auto">
        <input
          type="number" min={1} max={currentYear - 1}
          value={year}
          onChange={e => setYear(Math.max(1, Math.min(currentYear - 1, parseInt(e.target.value) || 1)))}
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
        />
        <HeadlineGenerator target={{ kind: 'year', value: year }} compact />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 ml-auto">
      <input
        type="number" min={0} step={10} max={currentYear - 10}
        value={decade}
        onChange={e => setDecade(Math.max(0, parseInt(e.target.value) || 0))}
        className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
      />
      <span className="text-[10px] text-zinc-500">s</span>
      <HeadlineGenerator target={{ kind: 'decade', value: decade }} compact />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function Headlines() {
  const [view, setView] = useState<'ANNUAL' | 'DECADE'>('ANNUAL');
  const [filterCat, setFilterCat] = useState<string>('');

  const { data: timeState } = useQuery({
    queryKey: ['time'],
    queryFn:  api.time.getState,
  });

  const { data: headlines = [], isLoading } = useQuery({
    queryKey: ['headlines', view, filterCat],
    queryFn:  () => api.time.headlines({
      type:     view,
      category: filterCat || undefined,
    }),
    enabled: !!timeState,
  });

  // Group annual by year, decade by decade
  const grouped = headlines.reduce<Record<number, Headline[]>>((acc, h) => {
    if (!acc[h.year]) acc[h.year] = [];
    acc[h.year].push(h);
    return acc;
  }, {});

  const sortedYears = Object.keys(grouped).map(Number).sort((a, b) => b - a);

  return (
    <div className="min-h-screen p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors">← The Realm</Link>
          <h1 className="text-2xl font-bold text-white mt-1">The Chronicle</h1>
          <p className="text-sm text-zinc-500">
            {view === 'ANNUAL' ? 'Annual headlines — last 10 years' : 'Decade summaries — distant history'}
          </p>
        </div>
        <span className="text-3xl font-bold text-amber-400">
          Year {timeState?.current_year ?? '…'}
        </span>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Annual / Decade toggle */}
        <div className="flex rounded-lg overflow-hidden border border-zinc-700">
          {(['ANNUAL', 'DECADE'] as const).map(t => (
            <button
              key={t}
              onClick={() => setView(t)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                view === t ? 'bg-amber-500 text-black' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {t === 'ANNUAL' ? 'Annual' : 'Decades'}
            </button>
          ))}
        </div>

        {/* Category filter */}
        <select
          value={filterCat}
          onChange={e => setFilterCat(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>

        {/* Generate */}
        {timeState && timeState.current_year > 1 && (
          <GenerateHeadlineForm view={view} currentYear={timeState.current_year} />
        )}
      </div>

      {/* Content */}
      {isLoading ? (
        <p className="text-zinc-500 text-sm animate-pulse">Consulting the archives…</p>
      ) : sortedYears.length === 0 ? (
        <div className="panel text-center py-12">
          <p className="text-zinc-500">No chronicles yet. Advance time to generate headlines.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {sortedYears.map(year => (
            <section key={year}>
              <h2 className="text-xs uppercase tracking-widest text-zinc-500 mb-3 flex items-center gap-2">
                <span className="h-px flex-1 bg-zinc-800" />
                {view === 'DECADE' ? `${year}s — Decade of ${year}` : `Year ${year}`}
                <span className="h-px flex-1 bg-zinc-800" />
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {grouped[year].map(h => <HeadlineCard key={h.id} h={h} />)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
