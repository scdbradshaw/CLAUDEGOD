// ============================================================
// World Designer — create, switch, archive, and delete worlds
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { WorldListItem, PopulationTier } from '@civ-sim/shared';

const TIER_LABELS: Record<PopulationTier, string> = {
  intimate:     'Intimate  (≤50)',
  town:         'Town  (50–500)',
  civilization: 'Civilization  (500+)',
};

// ── Create World Form ─────────────────────────────────────────

function CreateWorldForm({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [name,  setName]  = useState('');
  const [desc,  setDesc]  = useState('');
  const [tier,  setTier]  = useState<PopulationTier>('intimate');
  const [open,  setOpen]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.worlds.create({
      name:            name.trim(),
      description:     desc.trim() || undefined,
      population_tier: tier,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worlds'] });
      setName(''); setDesc(''); setTier('intimate'); setOpen(false); setError(null);
      onCreated();
    },
    onError: (e: Error) => setError(e.message),
  });

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-sim text-xs px-4 py-2"
      >
        + New World
      </button>
    );
  }

  return (
    <div className="panel p-4 space-y-3">
      <span className="text-xs text-zinc-500 uppercase tracking-widest">New World</span>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] text-muted uppercase tracking-widest block">Name *</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. The Iron Age"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="space-y-1">
          <label className="text-[10px] text-muted uppercase tracking-widest block">Population Tier</label>
          <select
            value={tier} onChange={e => setTier(e.target.value as PopulationTier)}
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-amber-500"
          >
            {(Object.keys(TIER_LABELS) as PopulationTier[]).map(t => (
              <option key={t} value={t}>{TIER_LABELS[t]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-1 sm:col-span-2">
          <label className="text-[10px] text-muted uppercase tracking-widest block">Description</label>
          <input
            value={desc} onChange={e => setDesc(e.target.value)}
            placeholder="Optional"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-amber-500"
          />
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => create.mutate()}
          disabled={create.isPending || !name.trim()}
          className="btn-sim text-xs px-4 py-1.5 disabled:opacity-40"
        >
          {create.isPending ? 'Creating…' : 'Create World'}
        </button>
        <button
          onClick={() => { setOpen(false); setError(null); }}
          className="text-xs px-4 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-300 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── World Card ────────────────────────────────────────────────

function WorldCard({ world }: { world: WorldListItem }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activate = useMutation({
    mutationFn: () => api.worlds.activate(world.id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['worlds'] }); setError(null); },
    onError:    (e: Error) => setError(e.message),
  });

  const archive = useMutation({
    mutationFn: () => api.worlds.archive(world.id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['worlds'] }); setError(null); },
    onError:    (e: Error) => setError(e.message),
  });

  const unarchive = useMutation({
    mutationFn: () => api.worlds.unarchive(world.id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['worlds'] }); setError(null); },
    onError:    (e: Error) => setError(e.message),
  });

  const del = useMutation({
    mutationFn: () => api.worlds.delete(world.id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['worlds'] }); setError(null); },
    onError:    (e: Error) => { setError(e.message); setConfirmDelete(false); },
  });

  const isArchived = !!world.archived_at;

  return (
    <div className={`panel p-4 space-y-3 ${world.is_active ? 'border-amber-700/60' : ''} ${isArchived ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-zinc-200">{world.name}</span>
            {world.is_active && (
              <span className="text-[10px] uppercase tracking-widest text-amber-400 border border-amber-700/60 px-1.5 py-0.5 rounded">
                Active
              </span>
            )}
            {isArchived && (
              <span className="text-[10px] uppercase tracking-widest text-zinc-500 border border-zinc-700 px-1.5 py-0.5 rounded">
                Archived
              </span>
            )}
          </div>
          {world.description && (
            <p className="text-xs text-zinc-500 mt-1">{world.description}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {!world.is_active && !isArchived && (
            <button
              onClick={() => activate.mutate()}
              disabled={activate.isPending}
              className="btn-sim text-[11px] px-3 py-1.5 disabled:opacity-40"
            >
              Activate
            </button>
          )}
          {isArchived ? (
            <button
              onClick={() => unarchive.mutate()}
              disabled={unarchive.isPending}
              className="text-[11px] px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
            >
              Unarchive
            </button>
          ) : !world.is_active ? (
            <button
              onClick={() => archive.mutate()}
              disabled={archive.isPending}
              className="text-[11px] px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
            >
              Archive
            </button>
          ) : null}
          {!world.is_active && (
            confirmDelete ? (
              <div className="flex gap-1">
                <button
                  onClick={() => del.mutate()}
                  disabled={del.isPending}
                  className="text-[11px] px-2 py-1 rounded bg-red-900/60 border border-red-700 text-red-300 hover:bg-red-800/60 transition-colors disabled:opacity-40"
                >
                  Confirm Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-[11px] px-3 py-1.5 rounded border border-zinc-800 text-zinc-600 hover:border-red-800 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            )
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-[10px] text-zinc-500 border-t border-border/40 pt-2">
        <span>
          Year <span className="text-zinc-300">{world.current_year}</span>
        </span>
        <span>
          Population <span className="text-zinc-300">{world.population}</span>
        </span>
        <span>
          Deaths <span className="text-zinc-300">{world.total_deaths}</span>
        </span>
        <span>
          Ticks <span className="text-zinc-300">{world.tick_count}</span>
        </span>
        <span>
          Tier <span className="text-zinc-300 capitalize">{world.population_tier}</span>
        </span>
        {world.ruleset_name && (
          <span>
            Ruleset <span className="text-zinc-300">{world.ruleset_name}</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function WorldDesigner() {
  const { data: worlds, isLoading, isError } = useQuery({
    queryKey: ['worlds'],
    queryFn:  api.worlds.list,
  });

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-gold tracking-widest uppercase">
              World Designer
            </h1>
            <p className="text-[11px] text-muted mt-1 tracking-wide">
              Create and switch between parallel worlds — only one can be active at a time
            </p>
          </div>
        </div>
      </header>

      <div className="mb-6">
        <CreateWorldForm onCreated={() => {}} />
      </div>

      {isLoading && (
        <div className="text-muted text-sm animate-pulse">Reading the multiverse…</div>
      )}
      {isError && (
        <div className="panel border-red-700 p-3 text-sm text-red-400">
          Failed to load worlds. Is the backend running?
        </div>
      )}

      <div className="space-y-3">
        {worlds?.map((w: WorldListItem) => (
          <WorldCard key={w.id} world={w} />
        ))}

        {worlds?.length === 0 && (
          <div className="panel p-12 text-center">
            <p className="font-display text-gold text-lg tracking-widest mb-2">No Worlds Yet</p>
            <p className="text-muted text-sm">Create a world above to begin.</p>
          </div>
        )}
      </div>
    </div>
  );
}
