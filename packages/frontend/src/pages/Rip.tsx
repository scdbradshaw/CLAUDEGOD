// ============================================================
// RIP — Memorial for deceased characters (Phase 7 obituary view)
// ============================================================

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type RipListParams } from '../api/client';
import type { DeceasedPerson } from '@civ-sim/shared';

const CAUSE_LABELS: Record<string, string> = {
  interaction: 'Fell in strife',
  old_age:     'Passed of age',
  health:      'Succumbed to illness',
};

type SortKey = NonNullable<RipListParams['sort']>;
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'died_at',      label: 'Recently deceased' },
  { key: 'world_year',   label: 'Year of death'     },
  { key: 'age_at_death', label: 'Age at death'      },
  { key: 'final_wealth', label: 'Final wealth'      },
  { key: 'name',         label: 'Name'              },
];

function wealthStr(w: number) {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(0)}K`;
  return `$${w.toFixed(0)}`;
}

function RipCard({ person }: { person: DeceasedPerson }) {
  const causeLabel = CAUSE_LABELS[person.cause] ?? person.cause;

  return (
    <div className="panel p-4 space-y-2 border-zinc-800 hover:border-zinc-600 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-display text-sm font-bold text-zinc-200 tracking-wide">{person.name}</p>
          <p className="text-[10px] text-zinc-600 mt-0.5">
            Year {person.world_year} · Age {person.age_at_death} · {causeLabel}
          </p>
        </div>
        <span className="text-lg opacity-40">✝</span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[10px] text-zinc-500">
        <div>
          <span className="block text-zinc-700 mb-0.5">Final Health</span>
          <span className="text-red-500 font-medium">{person.final_health}</span>
        </div>
        <div>
          <span className="block text-zinc-700 mb-0.5">Wealth</span>
          <span className="text-amber-500/70 font-medium">{wealthStr(person.final_wealth)}</span>
        </div>
      </div>

      {person.peak_positive_outcome && (
        <p className="text-[10px] text-emerald-700 italic border-l border-emerald-900 pl-2">
          {person.peak_positive_outcome}
        </p>
      )}
      {person.peak_negative_outcome && (
        <p className="text-[10px] text-red-800 italic border-l border-red-900 pl-2">
          {person.peak_negative_outcome}
        </p>
      )}
    </div>
  );
}

export default function Rip() {
  const [yearMin, setYearMin] = useState<string>('');
  const [yearMax, setYearMax] = useState<string>('');
  const [cause,   setCause]   = useState<'' | 'interaction' | 'old_age' | 'health'>('');
  const [sort,    setSort]    = useState<SortKey>('died_at');
  const [order,   setOrder]   = useState<'asc' | 'desc'>('desc');

  // Build the params object the query key depends on — same keys round-trip
  // as the query string below, so memoization and refetch match the backend.
  const params: RipListParams = {
    limit:    200,
    sort,
    order,
    ...(yearMin !== '' && { year_min: Number(yearMin) }),
    ...(yearMax !== '' && { year_max: Number(yearMax) }),
    ...(cause   !== '' && { cause }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['rip', params],
    queryFn:  () => api.rip.list(params),
    refetchInterval: 15_000,
  });

  const deceased  = data?.deceased ?? [];
  const total     = deceased.length;
  const cityName  = data?.meta.city_name;
  const hasFilters = yearMin !== '' || yearMax !== '' || cause !== '' || sort !== 'died_at' || order !== 'desc';

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header>
        <h1 className="page-title">The Fallen</h1>
        <p className="page-subtitle">
          {cityName
            ? `Obituaries of ${cityName} — ${total} soul${total !== 1 ? 's' : ''}${hasFilters ? ' in view' : ' remembered'}`
            : `${total} soul${total !== 1 ? 's' : ''} remembered`}
        </p>
      </header>

      {/* ── Filter bar ── */}
      <div className="panel p-3 flex flex-wrap items-end gap-3 text-xs">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-zinc-600">Year from</label>
          <input
            type="number"
            value={yearMin}
            onChange={e => setYearMin(e.target.value)}
            placeholder="any"
            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-zinc-600">Year to</label>
          <input
            type="number"
            value={yearMax}
            onChange={e => setYearMax(e.target.value)}
            placeholder="any"
            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-zinc-600">Cause</label>
          <select
            value={cause}
            onChange={e => setCause(e.target.value as typeof cause)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
          >
            <option value="">Any</option>
            <option value="old_age">Old age</option>
            <option value="interaction">Strife</option>
            <option value="health">Illness</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-zinc-600">Sort by</label>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as SortKey)}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
          >
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-widest text-zinc-600">Order</label>
          <select
            value={order}
            onChange={e => setOrder(e.target.value as 'asc' | 'desc')}
            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
          >
            <option value="desc">Newest / highest first</option>
            <option value="asc">Oldest / lowest first</option>
          </select>
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={() => { setYearMin(''); setYearMax(''); setCause(''); setSort('died_at'); setOrder('desc'); }}
            className="ml-auto text-[10px] uppercase tracking-widest text-zinc-500 hover:text-zinc-300 self-end pb-1"
          >
            Reset
          </button>
        )}
      </div>

      {/* ── States ── */}
      {isLoading && (
        <div className="text-muted text-sm animate-pulse">Reading the dead…</div>
      )}

      {!isLoading && total === 0 && (
        <div className="panel p-12 text-center">
          <p className="font-display text-zinc-600 text-lg tracking-widest mb-2">The Ground Is Unmarked</p>
          <p className="text-zinc-700 text-sm">
            {hasFilters ? 'No fallen match these filters.' : 'No one has died yet. Run a tick to begin the simulation.'}
          </p>
        </div>
      )}

      {/* ── Grid ── */}
      {total > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {deceased.map(p => <RipCard key={p.id} person={p} />)}
        </div>
      )}

    </div>
  );
}
