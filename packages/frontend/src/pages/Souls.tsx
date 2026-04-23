// ============================================================
// Souls — character grid page.
// Moved from Dashboard; shows all living souls as cards.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { api } from '../api/client';
import CharacterCard from '../components/CharacterCard';
import { statTextColor } from '../components/StatBar';
import type { CharacterListItem, EmotionalImpact } from '@civ-sim/shared';

const PAGE_SIZE = 60;

// ── helpers ───────────────────────────────────────────────────
function wealthStr(w: number): string {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(1)}K`;
  return `$${w.toFixed(0)}`;
}

function avg(...vals: number[]) {
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ── Quick Edit Modal ──────────────────────────────────────────

interface EditDraft {
  current_health: number;
  morality:       number;
  influence:      number;
  happiness:      number;
  money:          number;
}

function CharacterEditModal({ personId, onClose }: { personId: string; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: person, isLoading } = useQuery({
    queryKey: ['character', personId],
    queryFn:  () => api.characters.get(personId),
    staleTime: 0,
  });

  const [drafts, setDrafts] = useState<EditDraft | null>(null);

  useEffect(() => {
    if (person && !drafts) {
      const t = (person.traits ?? {}) as Record<string, number>;
      setDrafts({
        current_health: person.current_health,
        morality:       avg(t.willpower ?? 50, t.courage ?? 50, t.discipline ?? 50),
        influence:      avg(t.charisma ?? 50, t.ambition ?? 50),
        happiness:      avg(t.empathy ?? 50, t.loyalty ?? 50),
        money:          Math.round(person.money),
      });
    }
  }, [person]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!drafts) throw new Error('No data');
      return (api.godMode.apply as Function)(personId, {
        delta:            { current_health: drafts.current_health, money: drafts.money },
        trait_overrides:  {
          willpower:  drafts.morality,
          courage:    drafts.morality,
          discipline: drafts.morality,
          charisma:   drafts.influence,
          ambition:   drafts.influence,
          empathy:    drafts.happiness,
          loyalty:    drafts.happiness,
        },
        event_summary:    'God Mode: manual stat adjustment',
        emotional_impact: 'neutral' as EmotionalImpact,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['character', personId] });
      onClose();
    },
  });

  const moneyMax = person ? Math.max(Math.round(person.money * 3), 200_000) : 200_000;

  const SLIDERS = [
    { key: 'current_health', label: 'Health',    min: 0, max: 100,      step: 1   },
    { key: 'morality',       label: 'Morality',  min: 0, max: 100,      step: 1   },
    { key: 'influence',      label: 'Influence', min: 0, max: 100,      step: 1   },
    { key: 'happiness',      label: 'Happiness', min: 0, max: 100,      step: 1   },
    { key: 'money',          label: 'Money',     min: 0, max: moneyMax,  step: 500 },
  ] as const;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75"
      onClick={onClose}
    >
      <div
        className="panel-illuminated p-6 w-[22rem] space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-lg font-bold text-gold leading-tight">
              {person?.name ?? '…'}
            </h2>
            {person && (
              <p className="text-[10px] text-muted mt-0.5">
                {person.race} · Age {person.age}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-gray-300 transition-colors text-base leading-none mt-0.5"
          >
            ✕
          </button>
        </div>

        {isLoading || !drafts ? (
          <p className="text-muted text-xs animate-pulse">Loading…</p>
        ) : (
          <>
            {/* Sliders */}
            <div className="space-y-4">
              {SLIDERS.map(({ key, label, min, max, step }) => {
                const val = drafts[key];
                const isWealth = key === 'money';
                const displayColor = isWealth
                  ? 'text-amber-400'
                  : statTextColor(val as number);
                const displayVal = isWealth
                  ? wealthStr(val as number)
                  : String(val);

                return (
                  <div key={key} className="space-y-1">
                    <div className="flex justify-between items-center">
                      <span className="label">{label}</span>
                      <span className={`text-sm font-bold tabular-nums ${displayColor}`}>
                        {displayVal}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={val}
                      onChange={(e) =>
                        setDrafts((d) => d ? { ...d, [key]: +e.target.value } : d)
                      }
                      className="w-full h-1.5 cursor-pointer accent-amber-500"
                    />
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1 border-t border-border">
              <button onClick={onClose} className="btn-ghost flex-1 text-xs py-1.5">
                Cancel
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="btn-god flex-1 text-xs py-1.5 disabled:opacity-40"
              >
                {mutation.isPending ? '…' : '⚡ Save'}
              </button>
            </div>

            {mutation.isError && (
              <p className="text-red-400 text-[10px]">
                {(mutation.error as Error).message}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function Souls() {
  const qc = useQueryClient();
  const [page,      setPage]      = useState(1);
  const [q,         setQ]         = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['characters', page, PAGE_SIZE],
    queryFn:  () => api.characters.list(page, PAGE_SIZE),
    refetchInterval: 15_000,
    placeholderData: (prev) => prev,
  });

  const souls      = data?.total ?? 0;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="page-title">The Souls</h1>
          <p className="page-subtitle">
            {data
              ? `${souls.toLocaleString()} soul${souls !== 1 ? 's' : ''} dwell here`
              : 'Reading the realm…'
            }
          </p>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          <Link to="/people" className="btn-ghost text-xs">
            ⚲ Filter &amp; Search
          </Link>
          <Link to="/characters/new" className="btn-sim text-xs">
            + Summon Soul
          </Link>
        </div>
      </header>

      {/* ── Quick name search ── */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search by name…"
          className="input-base max-w-xs"
        />
        {q && (
          <Link
            to={`/people?q=${encodeURIComponent(q)}`}
            className="text-[11px] text-gold/70 hover:text-gold transition-colors"
          >
            Advanced filters →
          </Link>
        )}
      </div>

      {/* ── States ── */}
      {isLoading && (
        <div className="label animate-pulse text-amber-400/60">Reading the realm…</div>
      )}
      {isError && (
        <div className="panel p-4 border-blood/40 text-red-400 text-sm">
          Failed to reach the realm. Is the backend running?
        </div>
      )}

      {/* ── Grid ── */}
      {data && (
        <>
          {data.data.length === 0 ? (
            <div className="panel p-16 text-center space-y-4">
              <p className="font-display text-gold text-xl tracking-widest">The World Is Empty</p>
              <p className="text-muted text-sm">No souls dwell here yet.</p>
              <Link to="/characters/new" className="btn-sim inline-block">
                Summon Your First Soul
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {data.data
                .filter(c => !q || c.name.toLowerCase().includes(q.toLowerCase()))
                .map(c => (
                  <CharacterCard
                    key={c.id}
                    person={c as CharacterListItem}
                    onEdit={() => setEditingId(c.id)}
                  />
                ))
              }
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 text-xs pt-2">
              <button
                disabled={page <= 1}
                onClick={() => { setPage(p => p - 1); qc.invalidateQueries({ queryKey: ['characters'] }); }}
                className="btn-ghost disabled:opacity-30"
              >
                ← Prev
              </button>
              <span className="text-muted tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => { setPage(p => p + 1); qc.invalidateQueries({ queryKey: ['characters'] }); }}
                className="btn-ghost disabled:opacity-30"
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}

      {/* ── Quick Edit Modal ── */}
      {editingId && (
        <CharacterEditModal
          personId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}

    </div>
  );
}
