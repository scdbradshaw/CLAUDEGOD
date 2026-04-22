// ============================================================
// ForceInteractionPanel — Step 15: run one forced interaction
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ForceInteractionResult } from '../api/client';

export default function ForceInteractionPanel() {
  const qc = useQueryClient();

  const [open,       setOpen]       = useState(false);
  const [subjectId,  setSubjectId]  = useState('');
  const [antaId,     setAntaId]     = useState('');
  const [typeId,     setTypeId]     = useState('');
  const [result,     setResult]     = useState<ForceInteractionResult | null>(null);
  const [errMsg,     setErrMsg]     = useState<string | null>(null);

  // Load characters for dropdowns (first 100)
  const { data: charData } = useQuery({
    queryKey: ['characters'],
    queryFn:  () => api.characters.list(1, 100),
    enabled:  open,
  });

  // Load active ruleset for interaction type list
  const { data: ruleset } = useQuery({
    queryKey: ['ruleset-active'],
    queryFn:  api.rulesets.active,
    enabled:  open,
  });

  const chars       = charData?.data ?? [];
  const iTypes      = ruleset?.rules?.interaction_types ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      if (!subjectId)  throw new Error('Select a subject');
      if (!antaId)     throw new Error('Select an antagonist');
      if (!typeId)     throw new Error('Select an interaction type');
      return api.interactions.force({
        subject_id:          subjectId,
        antagonist_id:       antaId,
        interaction_type_id: typeId,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setErrMsg(null);
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['character', subjectId] });
      qc.invalidateQueries({ queryKey: ['character', antaId] });
    },
    onError: (err: Error) => {
      setErrMsg(err.message);
      setResult(null);
    },
  });

  // Score colour hint
  function scoreColor(score: number): string {
    if (score >=  60) return 'text-emerald-400';
    if (score >= -30) return 'text-amber-300';
    return 'text-red-400';
  }

  return (
    <div className="panel p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-sky-400 uppercase tracking-widest font-bold">⚔ Force Interaction</span>
        <button
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▲ collapse' : '▼ expand'}
        </button>
      </div>

      {!open && (
        <p className="text-[10px] text-zinc-600">
          Force a specific interaction between two people.
        </p>
      )}

      {open && (
        <>
          <div className="grid grid-cols-1 gap-2">
            {/* Subject */}
            <div>
              <label className="text-[10px] text-muted block mb-1">Subject</label>
              <select
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-sky-600"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                <option value="">— select subject —</option>
                {chars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (age {c.age}, hp {c.health})
                  </option>
                ))}
              </select>
            </div>

            {/* Antagonist */}
            <div>
              <label className="text-[10px] text-muted block mb-1">Antagonist</label>
              <select
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-sky-600"
                value={antaId}
                onChange={(e) => setAntaId(e.target.value)}
              >
                <option value="">— select antagonist —</option>
                {chars
                  .filter((c) => c.id !== subjectId)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (age {c.age}, hp {c.health})
                    </option>
                  ))}
              </select>
            </div>

            {/* Interaction type */}
            <div>
              <label className="text-[10px] text-muted block mb-1">Interaction Type</label>
              {iTypes.length === 0 ? (
                <p className="text-[10px] text-zinc-600 italic">No active ruleset loaded.</p>
              ) : (
                <select
                  className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-sky-600"
                  value={typeId}
                  onChange={(e) => setTypeId(e.target.value)}
                >
                  <option value="">— select type —</option>
                  {iTypes.map((t) => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={() => { setResult(null); setErrMsg(null); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="w-full btn bg-sky-900/50 border border-sky-700 hover:bg-sky-800 text-sky-300 disabled:opacity-40"
          >
            {mutation.isPending ? 'Running interaction…' : '⚔ Run Forced Interaction'}
          </button>

          {errMsg && <p className="text-red-400 text-[10px]">{errMsg}</p>}

          {/* Result card */}
          {result && (
            <div className="border border-border rounded p-3 space-y-1.5 bg-zinc-900/60">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">
                  {result.subject_name} <span className="text-zinc-600">vs</span> {result.antagonist_name}
                </span>
                <span className="text-[10px] text-zinc-500 italic">{result.interaction_type.label}</span>
              </div>

              <div className="flex items-end gap-2">
                <span className={`font-display text-xl font-bold tabular-nums ${scoreColor(result.score)}`}>
                  {result.score > 0 ? `+${result.score}` : result.score}
                </span>
                <span className="text-xs text-zinc-300 mb-0.5">{result.outcome}</span>
                {result.grudge_bonus !== 0 && (
                  <span className={`text-[10px] mb-0.5 ${result.grudge_bonus > 0 ? 'text-emerald-600' : 'text-red-700'}`}>
                    (grudge {result.grudge_bonus > 0 ? '+' : ''}{result.grudge_bonus})
                  </span>
                )}
              </div>

              {/* Trait changes */}
              {(Object.keys(result.subject_traits_changed).length > 0 ||
                Object.keys(result.antagonist_traits_changed).length > 0) && (
                <div className="text-[10px] text-zinc-500 space-y-0.5 pt-1 border-t border-border">
                  {Object.entries(result.subject_traits_changed).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span>{result.subject_name} · {k}</span>
                      <span className={v >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {v > 0 ? `+${v}` : v}
                      </span>
                    </div>
                  ))}
                  {Object.entries(result.antagonist_traits_changed).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span>{result.antagonist_name} · {k}</span>
                      <span className={v >= 0 ? 'text-emerald-500' : 'text-red-500'}>
                        {v > 0 ? `+${v}` : v}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {result.creates_memory && (
                <p className="text-[10px] text-zinc-600 italic">Memory entries written for both parties.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
