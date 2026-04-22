// ============================================================
// Chronicle — cinematic story feed.
// Annual + decade view, category filter, generate controls.
// Stories rendered full-width as scrolling entries, not cards.
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, type Headline, type Tone } from '../api/client';
import HeadlineGenerator from '../components/HeadlineGenerator';

// ── Category metadata ──────────────────────────────────────────

const CATEGORY_META: Record<string, { label: string; color: string; dimColor: string; icon: string }> = {
  MOST_DRAMATIC_FALL:  { label: 'Greatest Fall',    color: 'text-red-400',     dimColor: 'text-red-900/80',   icon: '↘' },
  MOST_INSPIRING_RISE: { label: 'Inspiring Rise',   color: 'text-emerald-400', dimColor: 'text-emerald-900/80', icon: '↗' },
  GREATEST_VILLAIN:    { label: 'Greatest Villain', color: 'text-rune',        dimColor: 'text-rune/30',      icon: '☠' },
  MOST_TRAGIC:         { label: 'Most Tragic',      color: 'text-blue-400',    dimColor: 'text-blue-900/80',  icon: '✦' },
  BEST_LOVE_STORY:     { label: 'Love Story',       color: 'text-pink-400',    dimColor: 'text-pink-900/80',  icon: '♥' },
  MOST_CRIMINAL:       { label: 'Most Criminal',    color: 'text-ember',       dimColor: 'text-ember/30',     icon: '⚖' },
  RAGS_TO_RICHES:      { label: 'Rags to Riches',   color: 'text-gold',        dimColor: 'text-gold-dim',     icon: '◆' },
  RICHES_TO_RAGS:      { label: 'Riches to Rags',   color: 'text-muted',       dimColor: 'text-muted/30',     icon: '◇' },
  MOST_INFLUENTIAL:    { label: 'Most Influential', color: 'text-sky-400',     dimColor: 'text-sky-900/80',   icon: '★' },
  LONGEST_SURVIVING:   { label: 'Longest Surviving',color: 'text-lime-400',    dimColor: 'text-lime-900/80',  icon: '⌛' },
};

const TONE_META: Record<Tone, { label: string; cls: string }> = {
  tabloid:   { label: 'Tabloid',   cls: 'bg-pink-500/10   text-pink-300   border-pink-500/30'   },
  literary:  { label: 'Literary',  cls: 'bg-slate-500/10  text-slate-300  border-slate-500/30'  },
  epic:      { label: 'Epic',      cls: 'bg-amber-500/10  text-amber-300  border-amber-500/30'  },
  reportage: { label: 'Reportage', cls: 'bg-sky-500/10    text-sky-300    border-sky-500/30'    },
  neutral:   { label: 'Neutral',   cls: 'bg-zinc-500/10   text-zinc-400   border-zinc-500/30'   },
};

// ── StoryEntry ─────────────────────────────────────────────────
// Full-width cinematic entry — glyph left, prose right.

function StoryEntry({ h }: { h: Headline }) {
  const meta = CATEGORY_META[h.category] ?? { label: h.category, color: 'text-muted', dimColor: 'text-muted/30', icon: '◉' };
  const tone = h.tone ? (TONE_META[h.tone] ?? TONE_META.neutral) : null;

  return (
    <article className="group flex gap-5 py-7 border-b border-border/60 last:border-0">

      {/* Left glyph column */}
      <div className="shrink-0 w-10 flex flex-col items-center pt-1 gap-1.5">
        <span className={`text-2xl leading-none ${meta.color}`}>{meta.icon}</span>
        <span className="w-px flex-1 bg-border/40 min-h-[1.5rem]" />
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-2">

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-[9px] uppercase tracking-widest font-medium ${meta.color}`}>
            {meta.label}
          </span>
          {tone && (
            <span className={`inline-flex items-center text-[9px] uppercase tracking-widest px-1.5 py-0.5 border rounded ${tone.cls}`}>
              {tone.label}
            </span>
          )}
        </div>

        {/* Headline */}
        <h2 className="font-display text-base sm:text-lg font-semibold text-gray-100 leading-snug
                       group-hover:text-gold transition-colors">
          {h.headline}
        </h2>

        {/* Person byline */}
        {h.person_name && (
          <p className="text-[10px] text-muted">
            {h.person_id
              ? <Link to={`/characters/${h.person_id}`} className="hover:text-gold transition-colors">{h.person_name}</Link>
              : h.person_name
            }
          </p>
        )}

        {/* Story prose */}
        {h.story && (
          <p className="text-sm text-zinc-400 leading-relaxed max-w-2xl">
            {h.story}
          </p>
        )}

      </div>
    </article>
  );
}

// ── GenerateForm ───────────────────────────────────────────────

function GenerateForm({ view, currentYear }: { view: 'ANNUAL' | 'DECADE'; currentYear: number }) {
  const [year,   setYear]   = useState(Math.max(1, currentYear - 1));
  const [decade, setDecade] = useState(Math.floor(Math.max(0, currentYear - 10) / 10) * 10);

  if (view === 'ANNUAL') {
    return (
      <div className="flex items-center gap-2">
        <input
          type="number" min={1} max={currentYear - 1} value={year}
          onChange={e => setYear(Math.max(1, Math.min(currentYear - 1, parseInt(e.target.value) || 1)))}
          className="input-sm w-20 text-center"
        />
        <HeadlineGenerator target={{ kind: 'year', value: year }} compact />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="number" min={0} step={10} max={currentYear - 10} value={decade}
        onChange={e => setDecade(Math.max(0, parseInt(e.target.value) || 0))}
        className="input-sm w-20 text-center"
      />
      <span className="text-[10px] text-muted">s</span>
      <HeadlineGenerator target={{ kind: 'decade', value: decade }} compact />
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────

export default function Headlines() {
  const [view,      setView]      = useState<'ANNUAL' | 'DECADE'>('ANNUAL');
  const [filterCat, setFilterCat] = useState('');

  const { data: timeState } = useQuery({
    queryKey: ['time'],
    queryFn:  api.time.getState,
  });

  const { data: headlines = [], isLoading } = useQuery({
    queryKey: ['headlines', view, filterCat],
    queryFn:  () => api.time.headlines({ type: view, category: filterCat || undefined }),
    enabled:  !!timeState,
  });

  // Group by year / decade, sorted descending
  const grouped = headlines.reduce<Record<number, Headline[]>>((acc, h) => {
    if (!acc[h.year]) acc[h.year] = [];
    acc[h.year].push(h);
    return acc;
  }, {});
  const sortedPeriods = Object.keys(grouped).map(Number).sort((a, b) => b - a);

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="page-title">The Chronicle</h1>
          <p className="page-subtitle">
            {view === 'ANNUAL' ? 'Annual records of triumph and ruin' : 'Decade summaries — distant history'}
            {timeState && <> · Year {timeState.current_year}</>}
          </p>
        </div>

        {/* Generate controls */}
        {timeState && timeState.current_year > 1 && (
          <div className="shrink-0">
            <GenerateForm view={view} currentYear={timeState.current_year} />
          </div>
        )}
      </header>

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Annual / Decade toggle */}
        <div className="flex rounded overflow-hidden border border-border">
          {(['ANNUAL', 'DECADE'] as const).map(t => (
            <button
              key={t}
              onClick={() => setView(t)}
              className={`px-4 py-1.5 text-xs font-medium transition-colors ${
                view === t
                  ? 'bg-gold/20 text-gold border-r border-border'
                  : 'bg-transparent text-muted hover:text-gray-300'
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
          className="input-sm"
        >
          <option value="">All Categories</option>
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
      </div>

      {/* ── Content ── */}
      {isLoading ? (
        <p className="label animate-pulse text-amber-400/60">Consulting the archives…</p>
      ) : sortedPeriods.length === 0 ? (
        <div className="panel p-16 text-center space-y-3">
          <p className="font-display text-gold text-xl tracking-widest">The Page Is Blank</p>
          <p className="text-muted text-sm">No chronicles recorded yet.</p>
          {timeState && timeState.current_year > 1 && (
            <div className="pt-2">
              <GenerateForm view={view} currentYear={timeState.current_year} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-10">
          {sortedPeriods.map(period => (
            <section key={period}>
              {/* Period divider */}
              <div className="divider mb-2">
                <span className="divider-text">
                  {view === 'DECADE' ? `${period}s` : `Year ${period}`}
                  <span className="text-zinc-700 ml-2">· {grouped[period].length}</span>
                </span>
              </div>

              {/* Stories */}
              <div>
                {grouped[period].map(h => (
                  <StoryEntry key={h.id} h={h} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

    </div>
  );
}
