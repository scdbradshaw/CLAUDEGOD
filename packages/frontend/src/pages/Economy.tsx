// ============================================================
// Economy — Stock market controls + global trait multipliers
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { api } from '../api/client';
import { GLOBAL_TRAITS } from '@civ-sim/shared';

const TRAIT_KEYS = Object.keys(GLOBAL_TRAITS) as Array<keyof typeof GLOBAL_TRAITS>;

const TRAIT_COLORS: Record<string, string> = {
  scarcity:  'text-amber-400',
  war:       'text-red-400',
  faith:     'text-violet-400',
  plague:    'text-green-400',
  tyranny:   'text-orange-400',
  discovery: 'text-sky-400',
};

const BORDER_COLORS: Record<string, string> = {
  scarcity:  'border-amber-800/50',
  war:       'border-red-800/50',
  faith:     'border-violet-800/50',
  plague:    'border-green-800/50',
  tyranny:   'border-orange-800/50',
  discovery: 'border-sky-800/50',
};

function fmt(n: number, decimals = 2) {
  return n.toFixed(decimals);
}

function trendLabel(trend: number) {
  const pct = (trend * 100).toFixed(1);
  return trend >= 0 ? `+${pct}% / tick` : `${pct}% / tick`;
}

export default function Economy() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['economy'],
    queryFn:  api.economy.getState,
    refetchInterval: 5_000,
  });

  // Local multiplier state (synced from server on load)
  const [mults, setMults] = useState<Record<string, number>>({});

  // Local world trait state
  const [localTraits, setLocalTraits] = useState<Record<string, number>>({});
  const localMults = data
    ? { ...data.global_trait_multipliers, ...mults }
    : mults;

  const push = useMutation({
    mutationFn: (dir: 'up' | 'down') => api.economy.push(dir),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['economy'] }),
  });

  const saveMults = useMutation({
    mutationFn: () => api.economy.setMultipliers(localMults),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['economy'] });
      setMults({});
    },
  });

  const saveTraits = useMutation({
    mutationFn: () => api.economy.setGlobalTraits({ ...data!.global_traits, ...localTraits }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['economy'] });
      setLocalTraits({});
    },
  });

  const multsAreDirty  = Object.keys(mults).length > 0;
  const traitsAreDirty = Object.keys(localTraits).length > 0;

  if (isLoading || !data) {
    return (
      <div className="min-h-screen p-6 max-w-4xl mx-auto">
        <div className="text-muted text-sm animate-pulse">Loading economy…</div>
      </div>
    );
  }

  const annualTrend = (data.market_trend * 2 * 100).toFixed(1);

  return (
    <div className="min-h-screen p-6 max-w-4xl mx-auto space-y-6">

      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-gold tracking-widest uppercase">
            The Exchange
          </h1>
          <p className="text-[11px] text-muted mt-1 tracking-wide">
            Year {data.current_year} · Tick {data.tick_count} · {data.total_deaths} souls lost
          </p>
        </div>
        <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300 mt-1">← Realm</Link>
      </header>

      {/* ── Market Index ── */}
      <div className="panel p-5 space-y-4">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">Market Index</span>

        <div className="flex items-end gap-4">
          <span className="font-display text-4xl font-bold text-gold">
            {fmt(data.market_index)}
          </span>
          <span className={`text-sm mb-1 ${data.market_trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {trendLabel(data.market_trend)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-[11px] text-zinc-400">
          <div>
            Annualized trend{' '}
            <span className={`font-medium ${parseFloat(annualTrend) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {parseFloat(annualTrend) >= 0 ? '+' : ''}{annualTrend}%
            </span>
          </div>
          <div>
            Volatility{' '}
            <span className="font-medium text-zinc-300">
              ±{fmt(data.market_volatility * 100, 1)}% / tick
            </span>
          </div>
        </div>

        {/* Push controls */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => push.mutate('up')}
            disabled={push.isPending}
            className="btn-sim text-xs px-5 py-1.5 disabled:opacity-40"
          >
            ↑ Bull Push
          </button>
          <button
            onClick={() => push.mutate('down')}
            disabled={push.isPending}
            className="px-5 py-1.5 rounded text-xs border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors disabled:opacity-40"
          >
            ↓ Bear Push
          </button>
          <span className="text-[10px] text-zinc-600 self-center ml-1">±0.5% per press</span>
        </div>
      </div>

      {/* ── Global Trait Multipliers ── */}
      <div className="panel p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 uppercase tracking-widest">World Force Multipliers</span>
          {multsAreDirty && (
            <button
              onClick={() => saveMults.mutate()}
              disabled={saveMults.isPending}
              className="btn-sim text-[10px] px-3 py-1 disabled:opacity-40"
            >
              {saveMults.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>

        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Scale how strongly each global force amplifies interaction scores.
          1× is neutral. 0× disables the force entirely.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TRAIT_KEYS.map((key) => {
            const val = localMults[key] ?? 1.0;
            return (
              <div key={key} className="space-y-1">
                <div className="flex justify-between items-center">
                  <label className={`text-xs font-medium capitalize ${TRAIT_COLORS[key] ?? 'text-zinc-300'}`}>
                    {key}
                  </label>
                  <span className="text-[11px] text-zinc-400">{fmt(val, 2)}×</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={5}
                  step={0.1}
                  value={val}
                  onChange={e => setMults(prev => ({ ...prev, [key]: parseFloat(e.target.value) }))}
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

      {/* ── World Forces (child values) ── */}
      <div className="panel p-5 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 uppercase tracking-widest">World Forces</span>
          {traitsAreDirty && (
            <button
              onClick={() => saveTraits.mutate()}
              disabled={saveTraits.isPending}
              className="btn-sim text-[10px] px-3 py-1 disabled:opacity-40"
            >
              {saveTraits.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>

        <p className="text-[10px] text-zinc-600 leading-relaxed">
          Adjust the world state mid-game. New characters will be generated relative to these values.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {TRAIT_KEYS.map((force) => {
            const forceDef = GLOBAL_TRAITS[force];
            const borderColor = BORDER_COLORS[force] ?? 'border-zinc-700/50';
            return (
              <div key={force} className={`space-y-3 border-l-2 pl-3 ${borderColor}`}>
                <p className={`text-xs font-semibold uppercase tracking-widest ${TRAIT_COLORS[force] ?? 'text-zinc-300'}`}>
                  {force}
                </p>
                {Object.entries(forceDef.children).map(([child, childDef]) => {
                  const traitKey = `${force}.${child}`;
                  const serverVal = data?.global_traits?.[traitKey] ?? 0;
                  const val = localTraits[traitKey] ?? serverVal;
                  return (
                    <div key={child} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-zinc-400 capitalize">
                          {child.replace(/_/g, ' ')}
                        </label>
                        <span className="text-[10px] text-zinc-300 tabular-nums">
                          {val > 0 ? `+${val}` : val}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={childDef.min}
                        max={childDef.max}
                        step={1}
                        value={val}
                        onChange={e =>
                          setLocalTraits(prev => ({ ...prev, [traitKey]: parseInt(e.target.value) }))
                        }
                        className="w-full accent-amber-500"
                      />
                      <p className="text-[9px] text-zinc-700 italic">{childDef.description}</p>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Stats strip ── */}
      <div className="panel p-4 grid grid-cols-3 gap-4 text-center text-[11px]">
        <div>
          <div className="text-zinc-500 mb-1">Total Ticks Run</div>
          <div className="text-zinc-200 font-medium text-lg">{data.tick_count}</div>
        </div>
        <div>
          <div className="text-zinc-500 mb-1">Years Elapsed</div>
          <div className="text-zinc-200 font-medium text-lg">{data.current_year}</div>
        </div>
        <div>
          <div className="text-zinc-500 mb-1">Souls Lost</div>
          <div className="text-red-400 font-medium text-lg">{data.total_deaths}</div>
        </div>
      </div>

    </div>
  );
}
