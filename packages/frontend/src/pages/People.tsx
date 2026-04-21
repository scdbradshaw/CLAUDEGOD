// ============================================================
// People — filter-first directory of every soul in the world.
// Server-side filtering via GET /api/characters/search so this
// stays responsive at 5k+ souls.
// ============================================================

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type {
  PeopleListItem,
  PeopleSearchParams,
  PeopleSortField,
  PeopleStatus,
} from '@civ-sim/shared';

// ── Known races ─────────────────────────────────────────────
// Mirrors the generator's distribution so the filter chips cover
// everything that can appear in a seeded world.
const RACE_OPTIONS = ['Human', 'Elf', 'Dwarf', 'Halfling', 'Half-Orc', 'Orc', 'Tiefling', 'Gnome', 'Aasimar'];

const SORT_OPTIONS: { value: PeopleSortField; label: string }[] = [
  { value: 'updated_at', label: 'Recently changed' },
  { value: 'name',       label: 'Name'              },
  { value: 'age',        label: 'Age'               },
  { value: 'health',     label: 'Health'            },
  { value: 'wealth',     label: 'Wealth'            },
  { value: 'morality',   label: 'Morality'          },
  { value: 'influence',  label: 'Influence'         },
];

const STATUS_OPTIONS: { value: PeopleStatus; label: string }[] = [
  { value: 'alive', label: 'Living' },
  { value: 'dead',  label: 'Fallen' },
  { value: 'all',   label: 'All'    },
];

// ── Helpers ─────────────────────────────────────────────────

function moralityDotColor(m: number): string {
  if (m >= 70) return 'bg-emerald-400';
  if (m >= 40) return 'bg-zinc-400';
  if (m >= 20) return 'bg-amber-400';
  return 'bg-red-500';
}

function healthColor(h: number): string {
  if (h === 0)   return 'bg-zinc-700';
  if (h >= 67)   return 'bg-emerald-500';
  if (h >= 34)   return 'bg-amber-500';
  return 'bg-red-500';
}

function wealthStr(w: number): string {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(1)}K`;
  return `$${w.toFixed(0)}`;
}

// ── PersonCard ──────────────────────────────────────────────

function PersonCard({ p }: { p: PeopleListItem }) {
  const dead = p.health === 0;
  return (
    <Link
      to={`/characters/${p.id}`}
      className={`panel block p-3 hover:border-amber-700 transition-colors ${dead ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-sm text-gray-100 leading-tight truncate">{p.name}</h3>
          <p className="text-[10px] text-muted mt-0.5">
            {p.race} · {p.gender} · Age {p.age}
            {dead && <span className="text-red-400 ml-1">· ✝</span>}
          </p>
        </div>
        <span
          className={`shrink-0 w-2 h-2 rounded-full mt-1 ${moralityDotColor(p.morality)}`}
          title={`Morality ${p.morality}`}
        />
      </div>

      {/* Health bar */}
      <div className="w-full h-1 rounded bg-zinc-800 overflow-hidden mb-2">
        <div className={`h-full ${healthColor(p.health)} transition-all`} style={{ width: `${p.health}%` }} />
      </div>

      {/* Religion / factions row */}
      <div className="flex flex-wrap gap-1 text-[10px] min-h-[1rem]">
        {p.religion && p.religion !== 'None' && (
          <span className="text-violet-400 leading-none">✦ {p.religion}</span>
        )}
        {p.factions.slice(0, 2).map(f => (
          <span key={f.id} className="text-orange-300 leading-none">⚑ {f.name}</span>
        ))}
        {p.factions.length > 2 && (
          <span className="text-muted leading-none">+{p.factions.length - 2}</span>
        )}
      </div>

      {/* Signature stat strip */}
      <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[10px]">
        <span className="text-muted">Influence <span className="text-zinc-300">{p.influence}</span></span>
        <span className="text-gold">{wealthStr(p.wealth)}</span>
      </div>
    </Link>
  );
}

// ── ChipToggleList ──────────────────────────────────────────

function ChipToggleList<T extends string>({
  options, selected, onToggle, keyFn = (v: T) => v, labelFn = (v: T) => v,
}: {
  options: T[];
  selected: string[];
  onToggle: (v: string) => void;
  keyFn?: (v: T) => string;
  labelFn?: (v: T) => string;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((opt) => {
        const key = keyFn(opt);
        const on  = selected.includes(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              on
                ? 'bg-amber-900/40 border-amber-700 text-amber-200'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
            }`}
          >
            {labelFn(opt)}
          </button>
        );
      })}
    </div>
  );
}

// ── People page ─────────────────────────────────────────────

export default function People() {
  const [filters, setFilters] = useState<PeopleSearchParams>({
    status: 'alive',
    sort:   'updated_at',
    order:  'desc',
    page:   1,
    limit:  60,
  });

  // Reset page on filter change (except page itself)
  const update = (patch: Partial<PeopleSearchParams>) => {
    setFilters(prev => ({ ...prev, ...patch, page: patch.page ?? 1 }));
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: ['people:search', filters],
    queryFn:  () => api.characters.search(filters),
    staleTime: 5_000,
  });

  const { data: religions } = useQuery({
    queryKey: ['religions:list'],
    queryFn:  () => api.religions.list(true),
    staleTime: 30_000,
  });

  const { data: factions } = useQuery({
    queryKey: ['factions:list'],
    queryFn:  () => api.factions.list(true),
    staleTime: 30_000,
  });

  const toggle = (bucket: 'races' | 'religions' | 'factions') => (v: string) => {
    const cur = filters[bucket] ?? [];
    update({ [bucket]: cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v] });
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.status && filters.status !== 'alive') n++;
    if (filters.age_min !== undefined) n++;
    if (filters.age_max !== undefined) n++;
    if (filters.races?.length)     n++;
    if (filters.religions?.length) n++;
    if (filters.factions?.length)  n++;
    if (filters.q)                 n++;
    return n;
  }, [filters]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (filters.limit ?? 60))) : 1;

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-gold tracking-widest uppercase">The People</h1>
          <p className="text-[11px] text-muted mt-1">
            {data ? `${data.total.toLocaleString()} soul${data.total !== 1 ? 's' : ''} match` : 'Reading the census…'}
          </p>
        </div>
        <Link to="/" className="text-[11px] text-muted hover:text-gold">← Dashboard</Link>
      </header>

      {/* Filter panel */}
      <div className="panel p-4 mb-6 space-y-4">
        {/* Row 1: search + status + sort */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[200px] space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Search</label>
            <input
              type="text"
              value={filters.q ?? ''}
              onChange={e => update({ q: e.target.value || undefined })}
              placeholder="Name contains…"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Status</label>
            <div className="flex gap-1">
              {STATUS_OPTIONS.map(o => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => update({ status: o.value })}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    filters.status === o.value
                      ? 'bg-amber-900/40 border-amber-700 text-amber-200'
                      : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >{o.label}</button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Sort</label>
            <select
              value={filters.sort ?? 'updated_at'}
              onChange={e => update({ sort: e.target.value as PeopleSortField })}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
            >
              {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Order</label>
            <select
              value={filters.order ?? 'desc'}
              onChange={e => update({ order: e.target.value as 'asc' | 'desc' })}
              className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
            >
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Age</label>
            <div className="flex gap-1 items-center">
              <input
                type="number" min={0} max={500}
                value={filters.age_min ?? ''}
                onChange={e => update({ age_min: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="min"
                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
              />
              <span className="text-muted text-xs">–</span>
              <input
                type="number" min={0} max={500}
                value={filters.age_max ?? ''}
                onChange={e => update({ age_max: e.target.value ? parseInt(e.target.value) : undefined })}
                placeholder="max"
                className="w-16 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-amber-500 text-center"
              />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => setFilters({ status: 'alive', sort: 'updated_at', order: 'desc', page: 1, limit: 60 })}
              className="text-[10px] text-muted hover:text-red-400 underline ml-auto"
            >Clear {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}</button>
          )}
        </div>

        {/* Row 2: race chips */}
        <div className="space-y-1">
          <label className="text-[10px] text-muted uppercase tracking-widest block">Race</label>
          <ChipToggleList
            options={RACE_OPTIONS}
            selected={filters.races ?? []}
            onToggle={toggle('races')}
          />
        </div>

        {/* Row 3: religion chips (data-driven) */}
        {religions && religions.length > 0 && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Religion</label>
            <ChipToggleList
              options={religions.map(r => r.name)}
              selected={filters.religions ?? []}
              onToggle={toggle('religions')}
            />
          </div>
        )}

        {/* Row 4: faction chips (keyed by id, labeled by name) */}
        {factions && factions.length > 0 && (
          <div className="space-y-1">
            <label className="text-[10px] text-muted uppercase tracking-widest block">Faction</label>
            <div className="flex flex-wrap gap-1">
              {factions.map(f => {
                const on = filters.factions?.includes(f.id) ?? false;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggle('factions')(f.id)}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                      on
                        ? 'bg-orange-900/40 border-orange-700 text-orange-200'
                        : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >
                    ⚑ {f.name} <span className="text-zinc-500">· {f.member_count}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      {isLoading && <div className="text-muted text-sm animate-pulse">Reading the census…</div>}
      {isError && (
        <div className="panel p-4 border-red-700 text-red-400 text-sm">Failed to load.</div>
      )}

      {data && data.data.length === 0 && (
        <div className="panel p-12 text-center">
          <p className="font-display text-gold text-lg tracking-widest mb-2">No souls match</p>
          <p className="text-muted text-sm">Try loosening your filters.</p>
        </div>
      )}

      {data && data.data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {data.data.map(p => <PersonCard key={p.id} p={p} />)}
        </div>
      )}

      {/* Pagination */}
      {data && totalPages > 1 && (
        <div className="mt-6 flex justify-center items-center gap-4 text-xs">
          <button
            type="button"
            disabled={(filters.page ?? 1) <= 1}
            onClick={() => update({ page: (filters.page ?? 1) - 1 })}
            className="btn-sim text-xs px-3 py-1 disabled:opacity-30"
          >← Prev</button>
          <span className="text-muted">
            Page {filters.page ?? 1} of {totalPages}
          </span>
          <button
            type="button"
            disabled={(filters.page ?? 1) >= totalPages}
            onClick={() => update({ page: (filters.page ?? 1) + 1 })}
            className="btn-sim text-xs px-3 py-1 disabled:opacity-30"
          >Next →</button>
        </div>
      )}
    </div>
  );
}
