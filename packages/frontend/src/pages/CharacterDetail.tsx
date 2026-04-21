// ============================================================
// CharacterDetail — full stat sheet + God Mode + Memory Bank
// ============================================================

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import StatBar, { statTextColor } from '../components/StatBar';
import MemoryBankPanel from '../components/MemoryBankPanel';
import GodModePanel    from '../components/GodModePanel';
import type { CriminalRecord } from '@civ-sim/shared';
import { GLOBAL_TRAITS } from '@civ-sim/shared';

const STATS: { label: string; key: string }[] = [
  { label: 'Health',       key: 'health'       },
  { label: 'Happiness',    key: 'happiness'     },
  { label: 'Morality',     key: 'morality'      },
  { label: 'Reputation',   key: 'reputation'    },
  { label: 'Influence',    key: 'influence'     },
  { label: 'Intelligence', key: 'intelligence'  },
];

const FORCE_CONFIG: { key: string; label: string; color: string }[] = [
  { key: 'scarcity',  label: 'Scarcity',  color: 'text-amber-400'  },
  { key: 'war',       label: 'War',        color: 'text-red-400'    },
  { key: 'faith',     label: 'Faith',      color: 'text-violet-400' },
  { key: 'plague',    label: 'Plague',     color: 'text-green-400'  },
  { key: 'tyranny',   label: 'Tyranny',    color: 'text-orange-400' },
  { key: 'discovery', label: 'Discovery',  color: 'text-sky-400'    },
];

function normalizeChild(force: string, child: string, value: number): number {
  const def = GLOBAL_TRAITS[force as keyof typeof GLOBAL_TRAITS]?.children[child as never] as
    { min: number; max: number } | undefined;
  if (!def || def.max === def.min) return 50;
  return Math.round(((value - def.min) / (def.max - def.min)) * 100);
}

export default function CharacterDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: person, isLoading, isError } = useQuery({
    queryKey:  ['character', id],
    queryFn:   () => api.characters.get(id!),
    enabled:   !!id,
    refetchOnWindowFocus: true,
  });

  if (isLoading) return <div className="p-8 text-muted animate-pulse">Loading…</div>;
  if (isError || !person) {
    return (
      <div className="p-8 text-red-400">
        Character not found.{' '}
        <Link to="/" className="underline">Back to dashboard</Link>
      </div>
    );
  }

  const wealth = person.wealth;
  const wealthStr =
    wealth >= 1_000_000
      ? `$${(wealth / 1_000_000).toFixed(2)}M`
      : wealth >= 1_000
      ? `$${(wealth / 1_000).toFixed(1)}K`
      : `$${wealth.toFixed(2)}`;

  return (
    <div className="min-h-screen p-6 max-w-6xl mx-auto">

      {/* ── Breadcrumb ── */}
      <nav className="text-[10px] text-muted mb-4">
        <Link to="/" className="hover:text-gold transition-colors">The Realm</Link>
        {' / '}
        <span className="text-gray-300">{person.name}</span>
      </nav>

      {/* ── Name + badges ── */}
      <div className="flex flex-wrap items-start gap-3 mb-6">
        <h1 className="font-display text-2xl font-bold text-gold tracking-wide">{person.name}</h1>
        <span className="tag bg-gray-800 text-muted self-center">{person.sexuality}</span>
        {person.criminal_record.length > 0 && (
          <span className="tag bg-red-900/50 text-red-400 self-center">
            {person.criminal_record.length} criminal record(s)
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* ── Left column: stats ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Identity panel */}
          <div className="panel p-4">
            <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest mb-3">Identity</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
              {[
                ['Gender',       person.gender],
                ['Race',         person.race],
                ['Religion',     person.religion],
                ['Relationship', person.relationship_status],
                ['Age',          `${person.age} yrs`],
                ['Lifespan',     `${person.lifespan} yrs`],
              ].map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted block text-[10px]">{k}</span>
                  <span className="text-gray-200">{v}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t border-border pt-3">
              <span className="text-muted text-[10px] block mb-1">Physical Appearance</span>
              <p className="text-xs text-gray-300 leading-relaxed">{person.physical_appearance}</p>
            </div>
          </div>

          {/* Stat bars */}
          <div className="panel p-4">
            <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest mb-3">Core Stats</h2>
            <div className="space-y-2">
              {STATS.map(({ label, key }) => (
                <StatBar
                  key={key}
                  label={label}
                  value={(person as Record<string, unknown>)[key] as number}
                />
              ))}
            </div>
          </div>

          {/* World Forces */}
          {person.global_scores && Object.keys(person.global_scores).length > 0 && (
            <div className="panel p-4">
              <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest mb-3">World Forces</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {FORCE_CONFIG.map(({ key, label, color }) => {
                  const forceDef = GLOBAL_TRAITS[key as keyof typeof GLOBAL_TRAITS];
                  const children = Object.entries(forceDef?.children ?? {});
                  return (
                    <div key={key}>
                      <p className={`text-xs font-semibold mb-2 uppercase tracking-widest ${color}`}>{label}</p>
                      <div className="space-y-1.5">
                        {children.map(([child, childDef]) => {
                          const val = (person.global_scores as Record<string, number>)[`${key}.${child}`] ?? 0;
                          const norm = normalizeChild(key, child, val);
                          return (
                            <div key={child} className="flex items-center gap-2">
                              <span className="text-[10px] text-muted w-36 shrink-0 capitalize">
                                {child.replace(/_/g, ' ')}
                              </span>
                              <div className="flex-1">
                                <StatBar label="" value={norm} showValue={false} />
                              </div>
                              <span className="text-[10px] text-zinc-400 w-8 text-right tabular-nums">
                                {val > 0 ? `+${val}` : val}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Wealth + Age row */}
          <div className="grid grid-cols-2 gap-4">
            <div className="panel p-4">
              <h2 className="text-[10px] text-muted uppercase tracking-widest mb-2">Wealth</h2>
              <p className={`text-2xl font-bold tabular-nums ${statTextColor(Math.min(wealth / 1000, 100))}`}>
                {wealthStr}
              </p>
            </div>

            <div className="panel p-4">
              <h2 className="text-[10px] text-muted uppercase tracking-widest mb-2">Age Progress</h2>
              <p className="text-2xl font-bold text-gray-200 tabular-nums">
                {person.age}
                <span className="text-sm text-muted font-normal"> / {person.lifespan} yrs</span>
              </p>
              <div className="mt-2">
                <StatBar
                  label=""
                  value={Math.round((person.age / person.lifespan) * 100)}
                  showValue={false}
                />
              </div>
            </div>
          </div>

          {/* Criminal record */}
          {person.criminal_record.length > 0 && (
            <div className="panel p-4">
              <h2 className="font-display text-[10px] text-gold/80 uppercase tracking-widest mb-3">Criminal Record</h2>
              <div className="space-y-2">
                {(person.criminal_record as CriminalRecord[]).map((r, i) => (
                  <div key={i} className="text-xs grid grid-cols-[1fr_auto] gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                    <div>
                      <span className="text-gray-200 font-medium">{r.offense}</span>
                      {r.notes && <p className="text-muted mt-0.5">{r.notes}</p>}
                    </div>
                    <div className="text-right">
                      <span className={`tag ${r.status === 'convicted' ? 'bg-red-900/50 text-red-400' : r.status === 'pending' ? 'bg-amber-900/50 text-amber-400' : 'bg-gray-800 text-muted'}`}>
                        {r.status}
                      </span>
                      <p className="text-[10px] text-muted mt-1">{r.date} · {r.severity}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right column: controls + memory ── */}
        <div className="space-y-4">
          {/* God Mode / Simulation panel */}
          <GodModePanel personId={person.id} />

          {/* Memory Bank */}
          <div className="panel p-4">
            <h2 className="font-display text-[10px] text-gold uppercase tracking-widest mb-3">
              Chronicle
              <span className="ml-2 text-gray-600 font-mono font-normal">({person.memory_bank?.length ?? 0})</span>
            </h2>
            <div className="max-h-[600px] overflow-y-auto pr-1">
              <MemoryBankPanel entries={person.memory_bank ?? []} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
