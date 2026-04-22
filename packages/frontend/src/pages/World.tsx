// ============================================================
// World — World state + forces viewer + live force editor.
// All world force knobs live here (moved from Economy).
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import StatBar, { statTextColor } from '../components/StatBar';
import { GLOBAL_TRAITS } from '@civ-sim/shared';
import { FORCE_CONFIG } from '../constants/forces';

function wealthStr(w: number): string {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(1)}K`;
  return `$${w.toFixed(0)}`;
}

// ── ForceEditor ────────────────────────────────────────────────
// Inline sliders for global_traits + multipliers, with save.

function ForceEditor() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['economy'],
    queryFn:  api.economy.getState,
    refetchInterval: 8_000,
  });

  const [localTraits, setLocalTraits] = useState<Record<string, number>>({});
  const [localMults,  setLocalMults]  = useState<Record<string, number>>({});

  const effectiveMults  = data ? { ...data.global_trait_multipliers, ...localMults }  : localMults;

  const saveTraits = useMutation({
    mutationFn: () => api.economy.setGlobalTraits({ ...data!.global_traits, ...localTraits }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['economy'] }); setLocalTraits({}); },
  });

  const saveMults = useMutation({
    mutationFn: () => api.economy.setMultipliers(effectiveMults),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['economy'] }); setLocalMults({}); },
  });

  if (!data) return <p className="label animate-pulse text-amber-400/60">Loading forces…</p>;

  const traitsAreDirty = Object.keys(localTraits).length > 0;
  const multsAreDirty  = Object.keys(localMults).length  > 0;

  return (
    <div className="space-y-8">

      {/* ── Child trait sliders ── */}
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <span className="label text-gold/70">Force Values</span>
          {traitsAreDirty && (
            <button
              onClick={() => saveTraits.mutate()}
              disabled={saveTraits.isPending}
              className="btn-god text-[10px] px-3 py-1 disabled:opacity-40"
            >
              {saveTraits.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted leading-relaxed">
          Adjust world state mid-game. New characters will be shaped by these values.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {FORCE_CONFIG.map(({ key, label, textColor, borderColor }) => {
            const forceDef = GLOBAL_TRAITS[key as keyof typeof GLOBAL_TRAITS];
            return (
              <div key={key} className={`space-y-3 border-l-2 pl-3 ${borderColor}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-widest ${textColor}`}>{label}</p>
                {Object.entries(forceDef.children).map(([child, childDef]) => {
                  const traitKey  = `${key}.${child}`;
                  const serverVal = data.global_traits?.[traitKey] ?? 0;
                  const val       = localTraits[traitKey] ?? serverVal;
                  return (
                    <div key={child} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-muted capitalize">
                          {child.replace(/_/g, ' ')}
                        </label>
                        <span className="text-[10px] text-zinc-300 tabular-nums">
                          {val > 0 ? `+${val}` : val}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={(childDef as { min: number; max: number }).min}
                        max={(childDef as { min: number; max: number }).max}
                        step={1}
                        value={val}
                        onChange={e => setLocalTraits(prev => ({ ...prev, [traitKey]: parseInt(e.target.value) }))}
                        className="w-full accent-amber-500"
                      />
                      <p className="text-[9px] text-zinc-700 italic">
                        {(childDef as { description?: string }).description ?? ''}
                      </p>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Multiplier sliders ── */}
      <div className="space-y-5 pt-4 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="label text-gold/70">Effect Multipliers</span>
          {multsAreDirty && (
            <button
              onClick={() => saveMults.mutate()}
              disabled={saveMults.isPending}
              className="btn-god text-[10px] px-3 py-1 disabled:opacity-40"
            >
              {saveMults.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>
        <p className="text-[10px] text-muted leading-relaxed">
          Scale how strongly each force amplifies interactions. 1× is neutral; 0× disables it entirely.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FORCE_CONFIG.map(({ key, label, textColor }) => {
            const val = effectiveMults[key] ?? 1.0;
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between">
                  <label className={`text-xs font-medium ${textColor}`}>{label}</label>
                  <span className="text-[11px] text-zinc-400">{val.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0} max={5} step={0.1} value={val}
                  onChange={e => setLocalMults(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
                  className="w-full accent-amber-500"
                />
                <div className="flex justify-between text-[9px] text-zinc-700">
                  <span>0×</span><span>2.5×</span><span>5×</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────

export default function World() {
  const [editMode, setEditMode] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey:        ['world'],
    queryFn:         api.world.getState,
    refetchInterval: 8_000,
  });

  if (isLoading || !data) {
    return (
      <div className="page">
        <p className="label animate-pulse text-amber-400/60">Reading the world…</p>
      </div>
    );
  }

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header>
        <h1 className="page-title">The World</h1>
        <p className="page-subtitle">
          Year {data.current_year} · Tick {data.tick_count}
        </p>
      </header>

      {/* ── Vital stats ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Population', value: data.population.toLocaleString(), color: 'text-gray-100' },
          { label: 'World Year', value: data.current_year.toString(),     color: 'text-gold'     },
          { label: 'Ticks Run',  value: data.tick_count.toString(),       color: 'text-zinc-300' },
          { label: 'Souls Lost', value: data.total_deaths.toLocaleString(), color: 'text-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="panel p-4 text-center">
            <div className="label mb-1">{label}</div>
            <div className={`text-2xl font-bold font-display tabular-nums ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Population averages ── */}
      <div className="panel p-5 space-y-3">
        <span className="label text-gold/70">Population Averages</span>
        <StatBar label="Avg Health" value={data.avg_health} />
        <div className="pt-2 border-t border-border text-[11px]">
          <span className="text-muted">Avg Wealth </span>
          <span className={`font-medium ${statTextColor(Math.min(data.avg_wealth / 1000, 100))}`}>
            {wealthStr(data.avg_wealth)}
          </span>
        </div>
      </div>

      {/* ── World forces overview ── */}
      <div className="panel p-5 space-y-5">
        <div className="flex items-center justify-between">
          <span className="label text-gold/70">World Forces</span>
          <button
            onClick={() => setEditMode(m => !m)}
            className="btn-ghost text-[10px] px-3 py-1"
          >
            {editMode ? '◀ View' : '⚡ Edit Forces'}
          </button>
        </div>

        {/* Composite score bars */}
        <div className="space-y-2">
          {FORCE_CONFIG.map(({ key, label, textColor }) => (
            <div key={key} className="flex items-center gap-2">
              <span className={`text-[10px] w-20 shrink-0 font-medium ${textColor}`}>{label}</span>
              <div className="flex-1">
                <StatBar label="" value={data.force_scores[key] ?? 0} showValue={false} />
              </div>
              <span className="text-[10px] text-muted w-6 text-right tabular-nums">
                {data.force_scores[key] ?? 0}
              </span>
            </div>
          ))}
        </div>

        {/* Child breakdowns (read-only) */}
        {!editMode && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-3 border-t border-border">
            {FORCE_CONFIG.map(({ key, label, textColor, borderColor }) => {
              const children = Object.entries(GLOBAL_TRAITS[key as keyof typeof GLOBAL_TRAITS].children);
              return (
                <div key={key} className={`border-l-2 pl-3 ${borderColor}`}>
                  <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${textColor}`}>{label}</p>
                  <div className="space-y-1.5">
                    {children.map(([child, childDef]) => {
                      const val  = data.global_traits[`${key}.${child}`] ?? 0;
                      const def  = childDef as { min: number; max: number };
                      const norm = def.max === def.min ? 50 : Math.round(((val - def.min) / (def.max - def.min)) * 100);
                      return (
                        <div key={child} className="flex items-center gap-2">
                          <span className="text-[9px] text-muted w-28 shrink-0 capitalize leading-tight">
                            {child.replace(/_/g, ' ')}
                          </span>
                          <div className="flex-1">
                            <StatBar label="" value={norm} showValue={false} />
                          </div>
                          <span className="text-[9px] text-muted w-8 text-right tabular-nums">
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
        )}

        {/* Edit mode */}
        {editMode && (
          <div className="pt-3 border-t border-border">
            <ForceEditor />
          </div>
        )}
      </div>

    </div>
  );
}
