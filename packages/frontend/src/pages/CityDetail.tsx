// City detail (Phase 11d).
//
// Layout: left = bucket bars + governance panel (tax slider, treasury, defense).
// Right = leaderboards (replaces the paginated residents list per spec).

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { PersonType } from '@claude-god/shared';
import { useCity } from '../hooks/useCity';
import { Leaderboards } from '../components/Leaderboards';
import { TaxSlider } from '../components/TaxSlider';
import { api } from '../lib/api';
import type { BucketRow } from '../lib/wireTypes';

export function CityDetail() {
  const { cityId, worldId } = useParams<{ cityId: string; worldId: string }>();
  const q = useCity(cityId);

  if (q.isLoading) return <Centered>Loading city…</Centered>;
  if (q.error) return <Centered tone="bad">Failed to load city.</Centered>;
  if (!q.data) return <Centered>City not found.</Centered>;

  const { city, buckets, active_events, dominant_faction, dominant_religion, real_counts } = q.data;
  const totalPop = buckets.reduce((s, b) => s + b.count, 0);

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-gold-bright">{city.name}</h1>
          <p className="text-muted text-xs mt-1 uppercase tracking-widest">
            {city.region_resource} · founded yr {city.founded_year}
            {city.is_ruined && <span className="text-blood"> · RUINED</span>}
          </p>
        </div>
        <Link to={`/world/${worldId}`} className="text-muted hover:text-gold-bright text-sm">
          ← world map
        </Link>
      </header>

      {active_events.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {active_events.map((e) => (
            <span
              key={e.id}
              className="text-xs uppercase tracking-wider px-2 py-1 border border-blood/60 text-blood rounded"
              title={`Started year ${e.started_year}`}
            >
              {e.event_def_id}
              {e.city_id == null ? ' · world' : ''}
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Population" value={city.population_total.toLocaleString()} />
        <Stat label="Avg wealth" value={city.avg_wealth.toLocaleString()} />
        <Stat label="Mood" value={city.mood_score.toFixed(1)} />
        <Stat label="Treasury" value={city.treasury.toLocaleString()} />
        <Stat label="Defense" value={`${city.defense_rating}`} />
        <Stat label="Garrison" value={city.garrison_size.toLocaleString()} />
        <Stat
          label="Dominant faction"
          value={dominant_faction?.name ?? '—'}
          to={dominant_faction ? `/world/${worldId}/group/${dominant_faction.id}` : undefined}
        />
        <Stat
          label="Dominant religion"
          value={dominant_religion?.name ?? '—'}
          to={dominant_religion ? `/world/${worldId}/group/${dominant_religion.id}` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <BucketTable
            buckets={buckets}
            totalPop={totalPop}
            realCounts={real_counts}
            worldId={worldId}
            cityId={cityId}
          />
        </div>
        <div className="space-y-6">
          {cityId && <TaxSlider cityId={cityId} initialValue={city.tax_rate} />}
          {cityId && <Leaderboards cityId={cityId} />}
        </div>
      </div>
    </div>
  );
}

function BucketTable({
  buckets,
  totalPop,
  realCounts,
  worldId,
  cityId,
}: {
  buckets: BucketRow[];
  totalPop: number;
  realCounts: Partial<Record<PersonType, number>>;
  worldId: string | undefined;
  cityId: string | undefined;
}) {
  const sorted = [...buckets].sort((a, b) => b.count - a.count);
  const [expanded, setExpanded] = useState<PersonType | null>(null);
  const totalReal = Object.values(realCounts).reduce((s, v) => s + (v ?? 0), 0);
  const totalNpc = Math.max(0, totalPop - totalReal);
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">Population by type</h2>
        <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted">
          <LegendDot className="bg-gold" />
          <span>real <span className="text-gold tabular-nums">{totalReal.toLocaleString()}</span></span>
          <LegendDot className="bg-gold-dim/40" />
          <span>npc <span className="tabular-nums">{totalNpc.toLocaleString()}</span></span>
        </div>
      </header>
      <div className="px-4 py-3 space-y-2">
        {sorted.map((b) => {
          const type = b.type as PersonType;
          const pct = totalPop === 0 ? 0 : (b.count / totalPop) * 100;
          const real = realCounts[type] ?? 0;
          const npc = Math.max(0, b.count - real);
          // The bar width is bucket-share-of-city; split internally by real:npc.
          const realFrac = b.count === 0 ? 0 : real / b.count;
          const isOpen = expanded === type;
          return (
            <div key={type} className="space-y-1">
              <button
                onClick={() => setExpanded(isOpen ? null : type)}
                className="w-full text-left group"
              >
                <div className="flex justify-between text-xs">
                  <span className="text-gold-bright font-display group-hover:underline">
                    {isOpen ? '▾' : '▸'} {type}
                  </span>
                  <span className="text-muted tabular-nums">
                    {b.count.toLocaleString()} · {pct.toFixed(1)}% ·{' '}
                    <span className="text-gold-bright">real {real.toLocaleString()}</span>{' '}
                    / npc {npc.toLocaleString()} · ⌀ wealth {b.avg_wealth}
                  </span>
                </div>
                <div className="h-2 mt-1 bg-surface rounded overflow-hidden border border-border-warm flex">
                  <div
                    className="h-full bg-gold"
                    style={{ width: `${pct * realFrac}%` }}
                  />
                  <div
                    className="h-full bg-gold-dim/40"
                    style={{ width: `${pct * (1 - realFrac)}%` }}
                  />
                </div>
              </button>
              {isOpen && worldId && cityId && (
                <RealPersonsByType
                  worldId={worldId}
                  cityId={cityId}
                  type={type}
                  total={real}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LegendDot({ className }: { className: string }) {
  return <span className={`inline-block w-2 h-2 rounded-sm ${className}`} />;
}

interface ListedPerson {
  id: string;
  name: string;
  type: PersonType;
  age: number;
  wealth: number;
  is_pinned: boolean;
}

function RealPersonsByType({
  worldId,
  cityId,
  type,
  total,
}: {
  worldId: string;
  cityId: string;
  type: PersonType;
  total: number;
}) {
  const navigate = useNavigate();
  const LIMIT = 20;
  const params = new URLSearchParams({
    world_id: worldId,
    city_id: cityId,
    type,
    limit: String(LIMIT),
  });
  const q = useQuery<{ rows: ListedPerson[]; total: number }>({
    queryKey: ['persons', { world_id: worldId, city_id: cityId, type, limit: LIMIT }],
    queryFn: () => api(`/api/persons?${params.toString()}`),
  });

  if (total === 0) {
    return (
      <div className="ml-4 mt-1 mb-2 text-xs text-muted italic">
        No real persons of this type.
      </div>
    );
  }

  return (
    <div className="ml-4 mt-1 mb-2 border-l border-border-warm pl-3">
      {q.isLoading && <div className="text-muted text-xs py-1">Loading…</div>}
      {q.error && <div className="text-blood text-xs py-1">Failed to load.</div>}
      {q.data && (
        <>
          <ul className="divide-y divide-border-warm">
            {q.data.rows.map((p) => (
              <li key={p.id}>
                <button
                  className="w-full text-left px-2 py-1.5 hover:bg-panel transition flex items-center gap-2 text-xs"
                  onClick={() => navigate(`/world/${worldId}/person/${p.id}`)}
                >
                  <span className="flex-1 truncate">
                    {p.is_pinned && <span className="text-rune mr-1">★</span>}
                    <span className="font-display text-gold-bright">{p.name}</span>
                    <span className="ml-2 text-muted">age {p.age}</span>
                  </span>
                  <span className="font-mono text-gold tabular-nums">
                    {p.wealth.toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {q.data.total > q.data.rows.length && (
            <div className="text-muted text-[10px] uppercase tracking-wider px-2 py-1">
              showing {q.data.rows.length} of {q.data.total.toLocaleString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  to,
}: {
  label: string;
  value: string;
  to?: string;
}) {
  const inner = (
    <div className="border border-border-warm rounded p-3 bg-panel hover:bg-panel-warm transition">
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className="font-display text-gold-bright text-lg tabular-nums truncate">
        {value}
      </div>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'bad';
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className={tone === 'bad' ? 'text-blood' : 'text-muted'}>{children}</div>
    </div>
  );
}
