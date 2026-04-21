// ============================================================
// GodModePanel — force-set any stat or apply a simulation delta
// ============================================================

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EmotionalImpact, PersonDelta } from '@civ-sim/shared';
import { api } from '../api/client';

const NUMERIC_STATS = [
  'health', 'morality', 'happiness', 'reputation', 'influence', 'intelligence',
  'age', 'lifespan', 'wealth',
] as const;

type NumericStat = typeof NUMERIC_STATS[number];

interface Props {
  personId: string;
}

export default function GodModePanel({ personId }: Props) {
  const qc = useQueryClient();

  const [mode, setMode]                   = useState<'god' | 'sim'>('god');
  const [stat, setStat]                   = useState<NumericStat>('happiness');
  const [value, setValue]                 = useState('');
  const [summary, setSummary]             = useState('');
  const [impact, setImpact]               = useState<EmotionalImpact>('neutral');
  const [errorMsg, setErrorMsg]           = useState('');
  const [successMsg, setSuccessMsg]       = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) throw new Error('Value must be a number');
      if (!summary.trim())     throw new Error('Event summary is required');

      const delta: PersonDelta = { [stat]: parsed };
      const body = { delta, event_summary: summary.trim(), emotional_impact: impact, force: mode === 'god' };

      return mode === 'god'
        ? api.godMode.apply(personId, body)
        : api.characters.applyDelta(personId, body);
    },
    onSuccess: () => {
      setSuccessMsg('Applied successfully!');
      setErrorMsg('');
      setValue('');
      setSummary('');
      qc.invalidateQueries({ queryKey: ['character', personId] });
      setTimeout(() => setSuccessMsg(''), 3000);
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
      setSuccessMsg('');
    },
  });

  return (
    <div className="panel p-4 space-y-3">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-xs font-bold tracking-widest flex-1 uppercase">
          <span className={mode === 'god' ? 'text-amber-400' : 'text-emerald-400'}>
            {mode === 'god' ? '⚡ God Mode' : '⚙ Simulation'}
          </span>
        </h3>
        <button
          onClick={() => setMode(mode === 'god' ? 'sim' : 'god')}
          className={mode === 'god' ? 'btn-god' : 'btn-sim'}
        >
          {mode === 'god' ? 'Switch → Sim' : 'Switch → God'}
        </button>
      </div>

      {mode === 'god' && (
        <p className="text-[10px] text-amber-500 italic">
          God Mode bypasses all simulation rules. Changes are absolute.
        </p>
      )}

      {/* Stat selector */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-muted block mb-1">Attribute</label>
          <select
            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
            value={stat}
            onChange={(e) => setStat(e.target.value as NumericStat)}
          >
            {NUMERIC_STATS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] text-muted block mb-1">New Value</label>
          <input
            type="number"
            className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
            placeholder="e.g. 75"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>

      {/* Emotional impact */}
      <div>
        <label className="text-[10px] text-muted block mb-1">Emotional Impact</label>
        <select
          className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
          value={impact}
          onChange={(e) => setImpact(e.target.value as EmotionalImpact)}
        >
          {(['traumatic', 'negative', 'neutral', 'positive', 'euphoric'] as EmotionalImpact[]).map((i) => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      {/* Event summary */}
      <div>
        <label className="text-[10px] text-muted block mb-1">Event Summary</label>
        <textarea
          rows={2}
          className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 resize-none focus:outline-none focus:border-gray-500"
          placeholder="Describe what happened..."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
      </div>

      {/* Submit */}
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className={mode === 'god' ? 'btn-god w-full' : 'btn-sim w-full'}
      >
        {mutation.isPending ? 'Applying…' : mode === 'god' ? '⚡ Apply God Mode' : '⚙ Apply Delta'}
      </button>

      {errorMsg   && <p className="text-red-400 text-[10px]">{errorMsg}</p>}
      {successMsg && <p className="text-emerald-400 text-[10px]">{successMsg}</p>}
    </div>
  );
}
