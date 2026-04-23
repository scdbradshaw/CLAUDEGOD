// ============================================================
// Events — Phase 6 catalog/control surface for WorldEvents.
// Layout (top → bottom):
//   1. Catalog   — browse + activate (player picks a def, sets params)
//   2. Active    — currently running events with timers + manual end
//   3. History   — completed events archive (newest first)
//
// Active + History stay editable while a year is running; the
// backend handles in-flight safety. Only the global Advance button
// is locked by the heartbeat (see PipelineProvider).
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import type {
  ActiveEventSummary,
  EventHistoryRow,
  WorldSnapshot,
  SnapshotActiveEvent,
} from '../api/client';
import {
  EVENT_CATALOG,
  EVENT_BY_ID,
  MAX_ACTIVE_EVENTS,
} from '@civ-sim/shared';
import type { EventDefId, ParamFieldDef } from '@civ-sim/shared';

const CATEGORY_COLOR: Record<string, string> = {
  negative: 'text-red-400 border-red-400/40',
  positive: 'text-emerald-400 border-emerald-400/40',
  chaotic:  'text-purple-400 border-purple-400/40',
  neutral:  'text-zinc-400 border-zinc-400/30',
};

const CATEGORY_BG: Record<string, string> = {
  negative: 'bg-red-950/30',
  positive: 'bg-emerald-950/30',
  chaotic:  'bg-purple-950/30',
  neutral:  'bg-zinc-900/30',
};

const END_REASON_LABEL: Record<EventHistoryRow['end_reason'], string> = {
  expired:       'expired',
  manual:        'ended by player',
  condition_met: 'resolved',
};

// ── ParamField (single slider) ────────────────────────────────

function ParamField({
  field, value, onChange,
}: {
  field:    ParamFieldDef;
  value:    number;
  onChange: (key: string, val: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <label className="text-[10px] text-muted">{field.label}</label>
        <span className="text-[10px] text-zinc-300 tabular-nums">
          {field.type === 'percent' ? `${value}%` : value}
        </span>
      </div>
      <input
        type="range"
        min={field.min ?? 0}
        max={field.max ?? 100}
        step={field.type === 'number' && (field.max ?? 100) > 10 ? 1 : 0.01}
        value={value}
        onChange={e => onChange(field.key, parseFloat(e.target.value))}
        className="w-full accent-amber-500"
      />
      {field.description && (
        <p className="text-[9px] text-zinc-700 italic">{field.description}</p>
      )}
    </div>
  );
}

// ── ActivationPanel (selected def → configure → activate) ─────

function ActivationPanel({
  defId, onClose, activeCount,
}: {
  defId:       EventDefId;
  onClose:     () => void;
  activeCount: number;
}) {
  const qc  = useQueryClient();
  const def = EVENT_BY_ID[defId];

  const [params, setParams] = useState<Record<string, number>>(() => {
    const dp = def.default_params() as unknown as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const f of def.param_fields) {
      out[f.key] = (dp[f.key] as number) ?? (f.default as number);
    }
    return out;
  });

  // Phase 4 — optional duration in years. Empty = indefinite.
  const [duration, setDuration] = useState<string>('');

  // War — manual group selectors (free-form for now)
  const [groupAId,   setGroupAId]   = useState('');
  const [groupAType, setGroupAType] = useState<'faction' | 'religion'>('faction');
  const [groupAName, setGroupAName] = useState('');
  const [groupBId,   setGroupBId]   = useState('');
  const [groupBType, setGroupBType] = useState<'faction' | 'religion'>('faction');
  const [groupBName, setGroupBName] = useState('');

  const activate = useMutation({
    mutationFn: () => {
      const fullParams: Record<string, unknown> = { ...params };
      if (defId === 'war') {
        fullParams.group_a = { type: groupAType, id: groupAId, name: groupAName };
        fullParams.group_b = { type: groupBType, id: groupBId, name: groupBName };
      }
      const dur = duration.trim() === '' ? null : Math.max(1, parseInt(duration, 10));
      return api.events.activate(defId, fullParams, dur);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['world-events'] });
      qc.invalidateQueries({ queryKey: ['world'] });
      onClose();
    },
  });

  const cap = activeCount >= MAX_ACTIVE_EVENTS;
  const catColor = CATEGORY_COLOR[def.category].split(' ')[0];

  return (
    <div className="panel p-5 space-y-5 border border-border/60">
      <div className="flex items-start justify-between">
        <div>
          <h3 className={`text-sm font-semibold ${catColor}`}>{def.name}</h3>
          <p className="text-[10px] text-muted mt-0.5 leading-relaxed max-w-md">{def.description}</p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-gray-200 text-lg leading-none ml-4">×</button>
      </div>

      {/* Param sliders */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {def.param_fields.map(f => (
          <ParamField
            key={f.key}
            field={f}
            value={params[f.key] ?? (f.default as number)}
            onChange={(key, val) => setParams(prev => ({ ...prev, [key]: val }))}
          />
        ))}
      </div>

      {/* Duration */}
      <div className="pt-3 border-t border-border space-y-1">
        <div className="flex justify-between items-center">
          <label className="text-[10px] text-muted">Duration (years)</label>
          <span className="text-[9px] text-zinc-600 italic">
            empty = indefinite (player ends manually)
          </span>
        </div>
        <input
          type="number"
          min={1}
          max={500}
          placeholder="∞"
          value={duration}
          onChange={e => setDuration(e.target.value)}
          className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-xs text-gray-200"
        />
      </div>

      {/* War group selectors */}
      {defId === 'war' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-border">
          {(['a', 'b'] as const).map(side => {
            const idVal   = side === 'a' ? groupAId   : groupBId;
            const typeVal = side === 'a' ? groupAType : groupBType;
            const nameVal = side === 'a' ? groupAName : groupBName;
            const setId   = side === 'a' ? setGroupAId   : setGroupBId;
            const setType = side === 'a' ? setGroupAType : setGroupBType;
            const setName = side === 'a' ? setGroupAName : setGroupBName;
            return (
              <div key={side} className="space-y-2">
                <p className="text-[10px] text-muted uppercase tracking-widest">Group {side.toUpperCase()}</p>
                <select
                  value={typeVal}
                  onChange={e => setType(e.target.value as 'faction' | 'religion')}
                  className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-xs text-gray-200"
                >
                  <option value="faction">Faction</option>
                  <option value="religion">Religion</option>
                </select>
                <input
                  type="text" placeholder="Group ID (UUID)"
                  value={idVal}
                  onChange={e => setId(e.target.value)}
                  className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-xs text-gray-200 placeholder:text-zinc-600"
                />
                <input
                  type="text" placeholder="Group Name (display)"
                  value={nameVal}
                  onChange={e => setName(e.target.value)}
                  className="w-full bg-zinc-900 border border-border rounded px-2 py-1 text-xs text-gray-200 placeholder:text-zinc-600"
                />
              </div>
            );
          })}
        </div>
      )}

      {cap && (
        <p className="text-[10px] text-red-400">
          Maximum {MAX_ACTIVE_EVENTS} events active at once. Disable one before adding another.
        </p>
      )}

      <button
        onClick={() => activate.mutate()}
        disabled={activate.isPending || cap}
        className="btn-god text-xs px-4 py-2 disabled:opacity-40 w-full sm:w-auto"
      >
        {activate.isPending ? 'Activating…' : `⚡ Activate ${def.name}`}
      </button>

      {activate.isError && (
        <p className="text-[10px] text-red-400">{(activate.error as Error).message}</p>
      )}
    </div>
  );
}

// ── ActiveEventCard ───────────────────────────────────────────
// Pulls richer per-event stats from the snapshot when available
// (infected_count, years_remaining); falls back to the bare
// /api/events list payload otherwise.
function ActiveEventCard({
  event, snapEvent,
}: {
  event:     ActiveEventSummary;
  snapEvent: SnapshotActiveEvent | undefined;
}) {
  const qc = useQueryClient();
  const def = EVENT_BY_ID[event.event_def_id as EventDefId];

  const deactivate = useMutation({
    mutationFn: () => api.events.deactivate(event.id),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['world-events'] });
      qc.invalidateQueries({ queryKey: ['event-history'] });
      qc.invalidateQueries({ queryKey: ['world'] });
    },
  });

  if (!def) return null;

  const [textCol, borderCol] = CATEGORY_COLOR[def.category].split(' ');
  const bgCol = CATEGORY_BG[def.category];

  const yearsRemaining = snapEvent?.years_remaining ?? event.years_remaining;
  const durationYears  = snapEvent?.duration_years  ?? event.duration_years;
  const infected       = snapEvent?.stats.infected_count ?? 0;

  const paramSummary = def.param_fields.slice(0, 3).map(f => {
    const val = event.params[f.key];
    if (val == null) return null;
    return (
      <div key={f.key} className="flex justify-between text-[10px]">
        <span className="text-muted">{f.label}</span>
        <span className="text-zinc-300 tabular-nums">
          {f.type === 'percent' ? `${val}%` : String(val)}
        </span>
      </div>
    );
  }).filter(Boolean);

  return (
    <div className={`panel p-4 space-y-3 border ${borderCol} ${bgCol}`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${textCol}`}>{def.name}</span>
        <button
          onClick={() => deactivate.mutate()}
          disabled={deactivate.isPending}
          className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-40"
        >
          {deactivate.isPending ? 'Stopping…' : '✕ End now'}
        </button>
      </div>

      <p className="text-[9px] text-muted leading-relaxed">{def.description.split('.')[0]}.</p>

      {/* Timer */}
      <div className="flex items-center gap-2 text-[10px]">
        <span className="text-muted">Timer</span>
        {durationYears == null ? (
          <span className="text-amber-300/80">∞ indefinite</span>
        ) : (
          <span className="tabular-nums text-zinc-200">
            {yearsRemaining !== undefined ? yearsRemaining.toFixed(1) : '?'} / {durationYears} yrs left
          </span>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-border/40">
        {paramSummary}
        {infected > 0 && (
          <div className="flex justify-between text-[10px]">
            <span className="text-muted">Infected</span>
            <span className="text-rose-300 tabular-nums">{infected}</span>
          </div>
        )}
      </div>

      <div className="text-[9px] text-zinc-700">
        Started year {event.started_year}
      </div>
    </div>
  );
}

// ── HistoryRow ────────────────────────────────────────────────

function HistoryRow({ row }: { row: EventHistoryRow }) {
  const def = EVENT_BY_ID[row.event_def_id as EventDefId];
  const name = def?.name ?? row.event_def_id;
  const textCol = def ? CATEGORY_COLOR[def.category].split(' ')[0] : 'text-zinc-300';

  return (
    <div className="flex items-center gap-3 text-[11px] py-2 border-b border-border/40 last:border-b-0">
      <span className={`font-semibold w-32 truncate ${textCol}`}>{name}</span>
      <span className="text-zinc-500 tabular-nums w-28">
        yr {row.started_year} → {row.ended_year}
      </span>
      <span className="text-zinc-500 tabular-nums w-12 text-right">
        {row.duration_actual != null ? `${row.duration_actual}y` : '—'}
      </span>
      <span className="text-zinc-400 italic">{END_REASON_LABEL[row.end_reason]}</span>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────

export default function Events() {
  const [selectedDef, setSelectedDef] = useState<EventDefId | null>(null);

  const { data: snapshot } = useQuery<WorldSnapshot>({
    queryKey:        ['world'],
    queryFn:         api.world.getState,
    refetchInterval: 4_000,
  });

  const { data: activeEvents = [] } = useQuery({
    queryKey:        ['world-events'],
    queryFn:         api.events.list,
    refetchInterval: 4_000,
  });

  const { data: history = [] } = useQuery({
    queryKey: ['event-history'],
    queryFn:  api.events.history,
  });

  const activeCount = activeEvents.length;
  const snapshotEventsById = new Map(
    (snapshot?.active_events ?? []).map(e => [e.id, e]),
  );

  return (
    <div className="page space-y-8">

      {/* ── Header ── */}
      <header>
        <h1 className="page-title">Events</h1>
        <p className="page-subtitle">
          Catalog · Active ({activeCount} / {MAX_ACTIVE_EVENTS}) · History ({history.length})
        </p>
      </header>

      {/* ─────────────────────────────────────────────────────
          1. CATALOG
          ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="divider">
          <span className="divider-text">◆ Catalog</span>
        </div>

        {selectedDef == null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {EVENT_CATALOG.map(def => {
              const isRunning = activeEvents.some(ev => ev.event_def_id === def.id);
              const [textCol, borderCol] = CATEGORY_COLOR[def.category].split(' ');
              const bgCol = CATEGORY_BG[def.category];
              return (
                <button
                  key={def.id}
                  onClick={() => !isRunning && setSelectedDef(def.id)}
                  disabled={isRunning}
                  className={`
                    text-left panel p-4 space-y-2 border transition-all
                    ${borderCol} ${bgCol}
                    ${isRunning ? 'opacity-50 cursor-not-allowed' : 'hover:brightness-125 cursor-pointer'}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-semibold ${textCol}`}>{def.name}</span>
                    {isRunning && (
                      <span className="text-[9px] text-emerald-400 uppercase tracking-widest animate-pulse">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted leading-relaxed">
                    {def.description.split('.')[0]}.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <span className={`text-[9px] uppercase tracking-widest ${textCol} opacity-60`}>
                      {def.category}
                    </span>
                    {def.supports_targeting && (
                      <span className="text-[9px] text-zinc-600">· targetable</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <ActivationPanel
            defId={selectedDef}
            activeCount={activeCount}
            onClose={() => setSelectedDef(null)}
          />
        )}
      </section>

      {/* ─────────────────────────────────────────────────────
          2. ACTIVE
          ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="divider">
          <span className="divider-text">⚡ Active</span>
        </div>
        {activeCount === 0 ? (
          <p className="text-[11px] text-muted italic">No events are running. Activate one from the catalog above.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {activeEvents.map(ev => (
              <ActiveEventCard
                key={ev.id}
                event={ev}
                snapEvent={snapshotEventsById.get(ev.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────
          3. HISTORY
          ───────────────────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="divider">
          <span className="divider-text">◉ History</span>
        </div>
        {history.length === 0 ? (
          <p className="text-[11px] text-muted italic">No completed events yet.</p>
        ) : (
          <div className="panel p-4">
            {history.map(row => <HistoryRow key={row.id} row={row} />)}
          </div>
        )}
      </section>

    </div>
  );
}
