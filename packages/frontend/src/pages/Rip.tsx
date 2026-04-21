// ============================================================
// RIP — Memorial for deceased characters
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { DeceasedPerson } from '@civ-sim/shared';

const CAUSE_LABELS: Record<string, string> = {
  interaction: 'Fell in strife',
  old_age:     'Passed of age',
  health:      'Succumbed to illness',
};

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

      <div className="grid grid-cols-3 gap-2 text-[10px] text-zinc-500">
        <div>
          <span className="block text-zinc-700 mb-0.5">Final Health</span>
          <span className="text-red-500 font-medium">{person.final_health}</span>
        </div>
        <div>
          <span className="block text-zinc-700 mb-0.5">Happiness</span>
          <span className="text-zinc-400 font-medium">{person.final_happiness}</span>
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
  const { data, isLoading } = useQuery({
    queryKey: ['rip'],
    queryFn:  () => api.rip.list(200),
    refetchInterval: 15_000,
  });

  const total = data?.length ?? 0;

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-zinc-400 tracking-widest uppercase">
            The Fallen
          </h1>
          <p className="text-[11px] text-muted mt-1 tracking-wide">
            {total > 0 ? `${total} soul${total !== 1 ? 's' : ''} remembered` : 'None have perished — yet'}
          </p>
        </div>
        <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300 mt-1">← Realm</Link>
      </header>

      {/* ── States ── */}
      {isLoading && (
        <div className="text-muted text-sm animate-pulse">Reading the dead…</div>
      )}

      {!isLoading && total === 0 && (
        <div className="panel p-12 text-center">
          <p className="font-display text-zinc-600 text-lg tracking-widest mb-2">The Ground Is Unmarked</p>
          <p className="text-zinc-700 text-sm">No one has died yet. Run a tick to begin the simulation.</p>
        </div>
      )}

      {/* ── Grid ── */}
      {data && data.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map(p => <RipCard key={p.id} person={p} />)}
        </div>
      )}

    </div>
  );
}
