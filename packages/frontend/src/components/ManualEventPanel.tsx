// ============================================================
// ManualEventPanel — Step 16: author a custom event for any character
// from the dashboard, without navigating to CharacterDetail.
// ============================================================

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmotionalImpact } from '@civ-sim/shared';
import { api } from '../api/client';

const EMOTIONAL_OPTS = ['traumatic', 'negative', 'neutral', 'positive', 'euphoric'] as const;

const STAT_KEYS = ['health', 'age', 'death_age', 'wealth'] as const;

interface DeltaRow {
  id:    number;
  key:   string;
  value: string;
}

let _seq = 0;
const nextId = () => ++_seq;

function defaultRow(): DeltaRow {
  return { id: nextId(), key: 'health', value: '' };
}

export default function ManualEventPanel() {
  const qc = useQueryClient();

  const [open,      setOpen]      = useState(false);
  const [personId,  setPersonId]  = useState('');
  const [rows,      setRows]      = useState<DeltaRow[]>([defaultRow()]);
  const [summary,   setSummary]   = useState('');
  const [impact,    setImpact]    = useState<EmotionalImpact>('neutral');
  const [result,    setResult]    = useState<string | null>(null);
  const [errMsg,    setErrMsg]    = useState<string | null>(null);

  const { data: charData } = useQuery({
    queryKey: ['characters'],
    queryFn:  () => api.characters.list(1, 100),
    enabled:  open,
  });

  const chars = charData?.data ?? [];

  function updateRow(id: number, patch: Partial<DeltaRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() { setRows((prev) => [...prev, defaultRow()]); }
  function removeRow(id: number) { setRows((prev) => prev.filter((r) => r.id !== id)); }

  const mutation = useMutation({
    mutationFn: () => {
      if (!personId)     throw new Error('Select a character');
      if (!summary.trim()) throw new Error('Event summary is required');
      if (rows.some((r) => r.value === '' || isNaN(parseFloat(r.value)))) {
        throw new Error('All delta values must be valid numbers');
      }

      const delta: Record<string, number> = {};
      for (const r of rows) {
        delta[r.key] = parseFloat(r.value);
      }

      return api.godMode.apply(personId, {
        delta,
        event_summary:    summary.trim(),
        emotional_impact: impact,
        force: true,
      });
    },
    onSuccess: (_data) => {
      const name = chars.find((c) => c.id === personId)?.name ?? 'Character';
      setResult(`Event applied to ${name}.`);
      setErrMsg(null);
      setSummary('');
      setRows([defaultRow()]);
      qc.invalidateQueries({ queryKey: ['characters'] });
      qc.invalidateQueries({ queryKey: ['character', personId] });
    },
    onError: (err: Error) => {
      setErrMsg(err.message);
      setResult(null);
    },
  });

  return (
    <div className="panel p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-violet-400 uppercase tracking-widest font-bold">✍ Author Event</span>
        <button
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▲ collapse' : '▼ expand'}
        </button>
      </div>

      {!open && (
        <p className="text-[10px] text-zinc-600">
          Write a custom memory + stat delta for any character.
        </p>
      )}

      {open && (
        <>
          {/* Character picker */}
          <div>
            <label className="text-[10px] text-muted block mb-1">Character</label>
            <select
              className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-violet-600"
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">— select character —</option>
              {chars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (age {c.age}, hp {c.health})
                </option>
              ))}
            </select>
          </div>

          {/* Stat deltas */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Stat Deltas (absolute)</span>
              <button onClick={addRow} className="text-[10px] text-violet-500 hover:text-violet-300">+ add</button>
            </div>

            {rows.map((r) => (
              <div key={r.id} className="flex gap-2 items-end">
                <div className="flex-1">
                  <select
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-violet-600"
                    value={r.key}
                    onChange={(e) => updateRow(r.id, { key: e.target.value })}
                  >
                    {STAT_KEYS.map((k) => <option key={k} value={k}>{k}</option>)}
                    <option value="trait.charisma">trait.charisma</option>
                    <option value="trait.leadership">trait.leadership</option>
                    <option value="trait.cunning">trait.cunning</option>
                    <option value="trait.combat">trait.combat</option>
                    <option value="trait.resilience">trait.resilience</option>
                    <option value="trait.ambition">trait.ambition</option>
                  </select>
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-violet-600"
                    placeholder="value"
                    value={r.value}
                    onChange={(e) => updateRow(r.id, { value: e.target.value })}
                  />
                </div>
                {rows.length > 1 && (
                  <button
                    onClick={() => removeRow(r.id)}
                    className="text-[10px] text-red-700 hover:text-red-400 pb-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Impact + Summary */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div>
              <label className="text-[10px] text-muted block mb-1">Emotional Impact</label>
              <select
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
                value={impact}
                onChange={(e) => setImpact(e.target.value as EmotionalImpact)}
              >
                {EMOTIONAL_OPTS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>

            <div>
              <label className="text-[10px] text-muted block mb-1">Event Summary (becomes a memory)</label>
              <textarea
                rows={3}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 resize-none focus:outline-none focus:border-gray-500"
                placeholder="Describe what happened…"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={() => { setResult(null); setErrMsg(null); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="w-full btn bg-violet-900/50 border border-violet-700 hover:bg-violet-800 text-violet-300 disabled:opacity-40"
          >
            {mutation.isPending ? 'Writing event…' : '✍ Apply Event'}
          </button>

          {errMsg  && <p className="text-red-400 text-[10px]">{errMsg}</p>}
          {result  && <p className="text-emerald-400 text-[10px]">{result}</p>}
        </>
      )}
    </div>
  );
}
