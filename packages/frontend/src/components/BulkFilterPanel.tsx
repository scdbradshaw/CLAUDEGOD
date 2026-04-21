// ============================================================
// BulkFilterPanel — filter builder + delta application (Step 14)
// ============================================================

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EmotionalImpact, FilterClause, BulkDeltaField } from '@civ-sim/shared';
import { api } from '../api/client';

// ── Constants ─────────────────────────────────────────────────

const SCALAR_NUMERIC = ['age', 'health', 'morality', 'happiness', 'reputation', 'influence', 'intelligence', 'wealth'] as const;
const SCALAR_STRING  = ['race', 'occupation', 'religion', 'gender'] as const;
const NUMERIC_OPS    = ['lt', 'lte', 'gt', 'gte', 'between'] as const;
const STRING_OPS     = ['eq', 'in'] as const;
const EMOTIONAL_OPTS = ['traumatic', 'negative', 'neutral', 'positive', 'euphoric'] as const;

type ScalarNumericField = typeof SCALAR_NUMERIC[number];
type ScalarStringField  = typeof SCALAR_STRING[number];

// ── Local state shapes ────────────────────────────────────────

interface LocalFilterClause {
  id:       number;
  field:    string;
  op:       string;
  value:    string;   // single numeric / string value
  min:      string;
  max:      string;
  values:   string;  // comma-separated for 'in'
}

interface LocalDeltaField {
  id:    number;
  key:   string;
  mode:  'set' | 'nudge';
  value: string;
}

let _seq = 0;
const nextId = () => ++_seq;

function defaultFilter(): LocalFilterClause {
  return { id: nextId(), field: 'age', op: 'lt', value: '', min: '', max: '', values: '' };
}

function defaultDelta(): LocalDeltaField {
  return { id: nextId(), key: 'wealth', mode: 'nudge', value: '' };
}

function fieldType(field: string): 'numeric' | 'string' | 'jsonb' {
  if (SCALAR_NUMERIC.includes(field as ScalarNumericField)) return 'numeric';
  if (SCALAR_STRING.includes(field as ScalarStringField))   return 'string';
  return 'jsonb';
}

// ── Component ─────────────────────────────────────────────────

export default function BulkFilterPanel() {
  const qc = useQueryClient();

  const [open,    setOpen]    = useState(false);
  const [filters, setFilters] = useState<LocalFilterClause[]>([defaultFilter()]);
  const [deltas,  setDeltas]  = useState<LocalDeltaField[]>([defaultDelta()]);
  const [summary, setSummary] = useState('');
  const [impact,  setImpact]  = useState<EmotionalImpact>('neutral');
  const [result,  setResult]  = useState<string | null>(null);
  const [errMsg,  setErrMsg]  = useState<string | null>(null);

  // ── Filter helpers ───────────────────────────────────────────

  function updateFilter(id: number, patch: Partial<LocalFilterClause>) {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }

  function addFilter() {
    setFilters((prev) => [...prev, defaultFilter()]);
  }

  function removeFilter(id: number) {
    setFilters((prev) => prev.filter((f) => f.id !== id));
  }

  // ── Delta helpers ────────────────────────────────────────────

  function updateDelta(id: number, patch: Partial<LocalDeltaField>) {
    setDeltas((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function addDelta() {
    setDeltas((prev) => [...prev, defaultDelta()]);
  }

  function removeDelta(id: number) {
    setDeltas((prev) => prev.filter((d) => d.id !== id));
  }

  // ── Serialise to API types ────────────────────────────────────

  function buildRequest() {
    const builtFilters: FilterClause[] = filters.map((f) => {
      if (f.op === 'eq') {
        return { field: f.field as ScalarStringField, op: 'eq', value: f.value };
      }
      if (f.op === 'in') {
        return {
          field:  f.field as ScalarStringField,
          op:     'in',
          values: f.values.split(',').map((v) => v.trim()).filter(Boolean),
        };
      }
      if (f.op === 'between') {
        return {
          field: f.field as ScalarNumericField,
          op:    'between',
          min:   parseFloat(f.min),
          max:   parseFloat(f.max),
        } as FilterClause;
      }
      return {
        field: f.field as ScalarNumericField,
        op:    f.op as 'lt' | 'lte' | 'gt' | 'gte',
        value: parseFloat(f.value),
      } as FilterClause;
    });

    const builtDelta: Record<string, BulkDeltaField> = {};
    for (const d of deltas) {
      builtDelta[d.key] = { mode: d.mode, value: parseFloat(d.value) };
    }

    return {
      filters:          builtFilters,
      delta:            builtDelta,
      event_summary:    summary.trim(),
      emotional_impact: impact,
    };
  }

  // ── Mutation ──────────────────────────────────────────────────

  const mutation = useMutation({
    mutationFn: () => {
      if (!summary.trim()) throw new Error('Event summary is required');
      if (deltas.some((d) => d.value === '' || isNaN(parseFloat(d.value)))) {
        throw new Error('All delta values must be valid numbers');
      }
      return api.godMode.bulk(buildRequest());
    },
    onSuccess: (data) => {
      setResult(`Matched ${data.matched} souls · Affected ${data.affected} · ${data.memory_entries_created} memories written.`);
      setErrMsg(null);
      qc.invalidateQueries({ queryKey: ['characters'] });
    },
    onError: (err: Error) => {
      setErrMsg(err.message);
      setResult(null);
    },
  });

  // ── Render ────────────────────────────────────────────────────

  return (
    <div className="panel p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-amber-400 uppercase tracking-widest font-bold">⚡ Bulk God Mode</span>
        <button
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '▲ collapse' : '▼ expand'}
        </button>
      </div>

      {!open && (
        <p className="text-[10px] text-zinc-600">
          Apply a delta to all persons matching a filter.
        </p>
      )}

      {open && (
        <>
          {/* ── Filter clauses ─────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Filters (AND)</span>
              <button onClick={addFilter} className="text-[10px] text-amber-500 hover:text-amber-300">+ add</button>
            </div>

            {filters.map((f) => {
              const type = fieldType(f.field);
              const ops  = type === 'string' ? STRING_OPS : NUMERIC_OPS;

              return (
                <div key={f.id} className="flex flex-wrap gap-1.5 items-end">
                  {/* Field */}
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-zinc-600 uppercase">field</label>
                    <input
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-44"
                      value={f.field}
                      onChange={(e) => updateFilter(f.id, { field: e.target.value, op: 'lt', value: '', min: '', max: '', values: '' })}
                      placeholder="age / trait.charisma / …"
                      list="filter-field-suggestions"
                    />
                  </div>

                  {/* Op */}
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-zinc-600 uppercase">op</label>
                    <select
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600"
                      value={f.op}
                      onChange={(e) => updateFilter(f.id, { op: e.target.value })}
                    >
                      {ops.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>

                  {/* Value inputs */}
                  {f.op === 'between' ? (
                    <>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[9px] text-zinc-600 uppercase">min</label>
                        <input
                          type="number"
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-20"
                          value={f.min}
                          onChange={(e) => updateFilter(f.id, { min: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <label className="text-[9px] text-zinc-600 uppercase">max</label>
                        <input
                          type="number"
                          className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-20"
                          value={f.max}
                          onChange={(e) => updateFilter(f.id, { max: e.target.value })}
                        />
                      </div>
                    </>
                  ) : f.op === 'in' ? (
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-zinc-600 uppercase">values (comma-sep)</label>
                      <input
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-44"
                        value={f.values}
                        onChange={(e) => updateFilter(f.id, { values: e.target.value })}
                        placeholder="human, elf, orc"
                      />
                    </div>
                  ) : (
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-zinc-600 uppercase">value</label>
                      <input
                        type={type === 'string' ? 'text' : 'number'}
                        className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-24"
                        value={f.value}
                        onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                      />
                    </div>
                  )}

                  {filters.length > 1 && (
                    <button
                      onClick={() => removeFilter(f.id)}
                      className="text-[10px] text-red-700 hover:text-red-400 pb-1"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* ── Delta fields ───────────────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-zinc-500 uppercase tracking-widest">Delta</span>
              <button onClick={addDelta} className="text-[10px] text-amber-500 hover:text-amber-300">+ add</button>
            </div>

            {deltas.map((d) => (
              <div key={d.id} className="flex flex-wrap gap-1.5 items-end">
                {/* Key */}
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] text-zinc-600 uppercase">field</label>
                  <input
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-44"
                    value={d.key}
                    onChange={(e) => updateDelta(d.id, { key: e.target.value })}
                    placeholder="wealth / trait.charisma / …"
                    list="delta-field-suggestions"
                  />
                </div>

                {/* Mode */}
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] text-zinc-600 uppercase">mode</label>
                  <select
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600"
                    value={d.mode}
                    onChange={(e) => updateDelta(d.id, { mode: e.target.value as 'set' | 'nudge' })}
                  >
                    <option value="nudge">nudge (+/−)</option>
                    <option value="set">set (absolute)</option>
                  </select>
                </div>

                {/* Value */}
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] text-zinc-600 uppercase">value</label>
                  <input
                    type="number"
                    className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 focus:outline-none focus:border-amber-600 w-24"
                    value={d.value}
                    onChange={(e) => updateDelta(d.id, { value: e.target.value })}
                  />
                </div>

                {deltas.length > 1 && (
                  <button
                    onClick={() => removeDelta(d.id)}
                    className="text-[10px] text-red-700 hover:text-red-400 pb-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* ── Event summary + impact ──────────────────────── */}
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="grid grid-cols-2 gap-2">
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
            </div>

            <div>
              <label className="text-[10px] text-muted block mb-1">Event Summary</label>
              <textarea
                rows={2}
                className="w-full bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200 resize-none focus:outline-none focus:border-gray-500"
                placeholder="Describe what happened to the matched souls…"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
          </div>

          {/* ── Submit ─────────────────────────────────────── */}
          <button
            onClick={() => { setResult(null); setErrMsg(null); mutation.mutate(); }}
            disabled={mutation.isPending}
            className="btn-god w-full disabled:opacity-40"
          >
            {mutation.isPending ? 'Applying bulk action…' : '⚡ Apply to Matched Souls'}
          </button>

          {errMsg  && <p className="text-red-400 text-[10px]">{errMsg}</p>}
          {result  && <p className="text-emerald-400 text-[10px]">{result}</p>}
        </>
      )}

      {/* Datalist hints */}
      <datalist id="filter-field-suggestions">
        {SCALAR_NUMERIC.map((f) => <option key={f} value={f} />)}
        {SCALAR_STRING.map((f) => <option key={f} value={f} />)}
        <option value="trait.charisma" />
        <option value="trait.leadership" />
        <option value="trait.cunning" />
        <option value="trait.combat" />
        <option value="global_score.faith.devotion" />
        <option value="global_score.war.morale" />
      </datalist>
      <datalist id="delta-field-suggestions">
        {SCALAR_NUMERIC.map((f) => <option key={f} value={f} />)}
        <option value="trait.charisma" />
        <option value="trait.leadership" />
        <option value="trait.cunning" />
        <option value="trait.combat" />
        <option value="trait.health" />
        <option value="trait.resilience" />
      </datalist>
    </div>
  );
}
