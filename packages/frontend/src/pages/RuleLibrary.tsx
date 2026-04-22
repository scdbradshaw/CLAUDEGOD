// ============================================================
// Rule Library — view, activate, clone, and delete rulesets
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type { RulesetListItem } from '../api/client';

export default function RuleLibrary() {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: rulesets, isLoading } = useQuery({
    queryKey: ['rulesets'],
    queryFn:  api.rulesets.list,
  });

  const activate = useMutation({
    mutationFn: (id: string) => api.rulesets.activate(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['rulesets'] }); setError(null); },
    onError:    (e: Error) => setError(e.message),
  });

  const clone = useMutation({
    mutationFn: (id: string) => api.rulesets.clone(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['rulesets'] }); setError(null); },
    onError:    (e: Error) => setError(e.message),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.rulesets.delete(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['rulesets'] }); setConfirmDelete(null); setError(null); },
    onError:    (e: Error) => { setError(e.message); setConfirmDelete(null); },
  });

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold text-gold tracking-widest uppercase">
              Rule Library
            </h1>
            <p className="text-[11px] text-muted mt-1 tracking-wide">
              Manage interaction rulesets — activate to apply to the current world
            </p>
          </div>
        </div>
      </header>

      {error && (
        <div className="panel border-red-700 p-3 text-sm text-red-400 mb-4">{error}</div>
      )}

      {isLoading && (
        <div className="text-muted text-sm animate-pulse">Loading rulesets…</div>
      )}

      <div className="space-y-3">
        {rulesets?.map((r: RulesetListItem) => (
          <div
            key={r.id}
            className={`panel p-4 flex items-start gap-4 ${r.is_active ? 'border-amber-700/60' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-zinc-200 truncate">{r.name}</span>
                {r.is_active && (
                  <span className="text-[10px] uppercase tracking-widest text-amber-400 border border-amber-700/60 px-1.5 py-0.5 rounded">
                    Active
                  </span>
                )}
              </div>
              {r.description && (
                <p className="text-xs text-zinc-500 mt-1 truncate">{r.description}</p>
              )}
              <p className="text-[10px] text-zinc-600 mt-1">
                Created {new Date(r.created_at).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {!r.is_active && (
                <button
                  onClick={() => activate.mutate(r.id)}
                  disabled={activate.isPending}
                  className="btn-sim text-[11px] px-3 py-1.5 disabled:opacity-40"
                >
                  Activate
                </button>
              )}
              <button
                onClick={() => clone.mutate(r.id)}
                disabled={clone.isPending}
                className="text-[11px] px-3 py-1.5 rounded border border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-colors disabled:opacity-40"
              >
                Clone
              </button>
              {!r.is_active && (
                confirmDelete === r.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => del.mutate(r.id)}
                      disabled={del.isPending}
                      className="text-[11px] px-2 py-1 rounded bg-red-900/60 border border-red-700 text-red-300 hover:bg-red-800/60 transition-colors disabled:opacity-40"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(r.id)}
                    className="text-[11px] px-3 py-1.5 rounded border border-zinc-800 text-zinc-600 hover:border-red-800 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                )
              )}
            </div>
          </div>
        ))}

        {rulesets?.length === 0 && (
          <div className="panel p-12 text-center">
            <p className="font-display text-gold text-lg tracking-widest mb-2">No Rulesets</p>
            <p className="text-muted text-sm">No rulesets found. Seed one from the backend.</p>
          </div>
        )}
      </div>
    </div>
  );
}
