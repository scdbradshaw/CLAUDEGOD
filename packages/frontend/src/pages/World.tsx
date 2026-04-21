// ============================================================
// World — Aggregated world state panel
// ============================================================

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import StatBar, { statTextColor } from '../components/StatBar';
import { GLOBAL_TRAITS } from '@civ-sim/shared';

const FORCE_CONFIG: { key: string; label: string; color: string; border: string }[] = [
  { key: 'scarcity',  label: 'Scarcity',  color: 'text-amber-400',  border: 'border-amber-700/60'  },
  { key: 'war',       label: 'War',        color: 'text-red-400',    border: 'border-red-700/60'    },
  { key: 'faith',     label: 'Faith',      color: 'text-violet-400', border: 'border-violet-700/60' },
  { key: 'plague',    label: 'Plague',     color: 'text-green-400',  border: 'border-green-700/60'  },
  { key: 'tyranny',   label: 'Tyranny',    color: 'text-orange-400', border: 'border-orange-700/60' },
  { key: 'discovery', label: 'Discovery',  color: 'text-sky-400',    border: 'border-sky-700/60'    },
];

function wealthStr(w: number): string {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(1)}K`;
  return `$${w.toFixed(0)}`;
}

function trendLabel(t: number): { label: string; color: string } {
  const pct = (t * 100).toFixed(1);
  return t >= 0
    ? { label: `+${pct}% / tick`, color: 'text-emerald-400' }
    : { label: `${pct}% / tick`,  color: 'text-red-400'     };
}

export default function World() {
  const { data, isLoading } = useQuery({
    queryKey:        ['world'],
    queryFn:         api.world.getState,
    refetchInterval: 8_000,
  });

  if (isLoading || !data) {
    return (
      <div className="min-h-screen p-6 max-w-5xl mx-auto">
        <div className="text-muted text-sm animate-pulse">Reading the world…</div>
      </div>
    );
  }

  const trend = trendLabel(data.market_trend);

  return (
    <div className="min-h-screen p-6 max-w-5xl mx-auto space-y-6">

      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-gold tracking-widest uppercase">
            World State
          </h1>
          <p className="text-[11px] text-muted mt-1 tracking-wide">
            Year {data.current_year} · Tick {data.tick_count}
          </p>
        </div>
        <Link to="/" className="text-xs text-zinc-500 hover:text-zinc-300 mt-1">← Realm</Link>
      </header>

      {/* ── Vital stats strip ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Population',    value: data.population.toString(),       color: 'text-zinc-100' },
          { label: 'World Year',    value: data.current_year.toString(),     color: 'text-zinc-100' },
          { label: 'Ticks Run',     value: data.tick_count.toString(),       color: 'text-zinc-100' },
          { label: 'Souls Lost',    value: data.total_deaths.toString(),     color: 'text-red-400'  },
        ].map(({ label, value, color }) => (
          <div key={label} className="panel p-4 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1">{label}</div>
            <div className={`text-2xl font-bold font-display tabular-nums ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Population health ── */}
      <div className="panel p-5 space-y-4">
        <span className="text-xs text-zinc-500 uppercase tracking-widest">Population Averages</span>

        <div className="space-y-2.5">
          <StatBar label="Health"    value={data.avg_health}    />
          <StatBar label="Happiness" value={data.avg_happiness} />
          <StatBar label="Morality"  value={data.avg_morality}  />
        </div>

        <div className="pt-2 border-t border-border text-[11px]">
          <span className="text-zinc-500">Avg Wealth </span>
          <span className={`font-medium ${statTextColor(Math.min(data.avg_wealth / 1000, 100))}`}>
            {wealthStr(data.avg_wealth)}
          </span>
        </div>
      </div>

      {/* ── Market ── */}
      <div className="panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 uppercase tracking-widest">Market</span>
          <Link to="/economy" className="text-[10px] text-amber-500 hover:text-amber-400">
            Edit in Exchange →
          </Link>
        </div>

        <div className="flex items-end gap-4">
          <span className="font-display text-3xl font-bold text-gold">
            {data.market_index.toFixed(2)}
          </span>
          <span className={`text-sm mb-0.5 ${trend.color}`}>{trend.label}</span>
        </div>

        <div className="text-[11px] text-zinc-500">
          Volatility <span className="text-zinc-300">±{(data.market_volatility * 100).toFixed(1)}% / tick</span>
        </div>
      </div>

      {/* ── World forces overview ── */}
      <div className="panel p-5 space-y-5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 uppercase tracking-widest">World Forces</span>
          <Link to="/economy" className="text-[10px] text-amber-500 hover:text-amber-400">
            Adjust in Exchange →
          </Link>
        </div>

        {/* Composite bars */}
        <div className="space-y-2">
          {FORCE_CONFIG.map(({ key, label, color }) => (
            <div key={key} className="flex items-center gap-2">
              <span className={`text-[10px] w-20 shrink-0 font-medium ${color}`}>{label}</span>
              <div className="flex-1">
                <StatBar label="" value={data.force_scores[key] ?? 0} showValue={false} />
              </div>
              <span className="text-[10px] text-muted w-6 text-right tabular-nums">
                {data.force_scores[key] ?? 0}
              </span>
            </div>
          ))}
        </div>

        {/* Child breakdowns */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 pt-3 border-t border-border">
          {FORCE_CONFIG.map(({ key, label, color, border }) => {
            const children = Object.entries(GLOBAL_TRAITS[key as keyof typeof GLOBAL_TRAITS].children);
            return (
              <div key={key} className={`border-l-2 pl-3 ${border}`}>
                <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${color}`}>{label}</p>
                <div className="space-y-1.5">
                  {children.map(([child, childDef]) => {
                    const val = data.global_traits[`${key}.${child}`] ?? 0;
                    const norm = Math.round(((val - childDef.min) / (childDef.max - childDef.min)) * 100);
                    return (
                      <div key={child} className="flex items-center gap-2">
                        <span className="text-[9px] text-zinc-500 w-28 shrink-0 capitalize leading-tight">
                          {child.replace(/_/g, ' ')}
                        </span>
                        <div className="flex-1">
                          <StatBar label="" value={norm} showValue={false} />
                        </div>
                        <span className="text-[9px] text-zinc-500 w-8 text-right tabular-nums">
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
      </div>

      {/* ── Force multipliers ── */}
      <div className="panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500 uppercase tracking-widest">Effect Multipliers</span>
          <Link to="/economy" className="text-[10px] text-amber-500 hover:text-amber-400">
            Edit in Exchange →
          </Link>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          {FORCE_CONFIG.map(({ key, label, color }) => (
            <div key={key} className="text-center">
              <div className={`text-[10px] uppercase tracking-widest ${color} mb-1`}>{label}</div>
              <div className="text-lg font-bold text-zinc-200 tabular-nums">
                {(data.global_trait_multipliers[key] ?? 1).toFixed(1)}×
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
