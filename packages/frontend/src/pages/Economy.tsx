// ============================================================
// Exchange — Market index, controls, and history chart.
// World force editing has moved to /world.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';

// ── SVG line chart ─────────────────────────────────────────────

interface ChartPoint { tick: number; value: number }

const CHART_W = 600;
const CHART_H = 120;
const PAD     = { top: 10, right: 12, bottom: 22, left: 42 };

function MarketChart({ points }: { points: ChartPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-28 text-muted text-xs">
        Watching the market…
      </div>
    );
  }

  const xs   = points.map(p => p.tick);
  const ys   = points.map(p => p.value);
  const minX = xs[0],  maxX = xs[xs.length - 1];
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeY = maxY - minY || 1;
  const rangeX = maxX - minX || 1;

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top  - PAD.bottom;

  const toX = (x: number) => PAD.left + ((x - minX) / rangeX) * innerW;
  const toY = (y: number) => PAD.top  + (1 - (y - minY) / rangeY) * innerH;

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.tick).toFixed(1)},${toY(p.value).toFixed(1)}`)
    .join(' ');

  // Filled area
  const areaD = `${pathD} L${toX(maxX).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${toX(minX).toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`;

  const isUp    = ys[ys.length - 1] >= ys[0];
  const lineClr = isUp ? '#34d399' : '#f87171';
  const fillId  = isUp ? 'fillUp' : 'fillDown';

  // Y-axis labels (3 ticks)
  const yLabels = [minY, (minY + maxY) / 2, maxY];

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full"
      style={{ height: `${CHART_H}px` }}
      aria-label="Market index history"
    >
      <defs>
        <linearGradient id="fillUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#34d399" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0"    />
        </linearGradient>
        <linearGradient id="fillDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#f87171" stopOpacity="0.20" />
          <stop offset="100%" stopColor="#f87171" stopOpacity="0"    />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {yLabels.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left} y1={toY(v)}
            x2={PAD.left + innerW} y2={toY(v)}
            stroke="#252010" strokeWidth="1"
          />
          <text
            x={PAD.left - 4} y={toY(v)}
            textAnchor="end" dominantBaseline="middle"
            fontSize="9" fill="#7a7060"
          >
            {v.toFixed(1)}
          </text>
        </g>
      ))}

      {/* X-axis tick labels */}
      {[minX, Math.round((minX + maxX) / 2), maxX].map((t, i) => (
        <text
          key={i}
          x={toX(t)} y={PAD.top + innerH + 14}
          textAnchor="middle" fontSize="9" fill="#7a7060"
        >
          T{t}
        </text>
      ))}

      {/* Area fill */}
      <path d={areaD} fill={`url(#${fillId})`} />

      {/* Line */}
      <path d={pathD} fill="none" stroke={lineClr} strokeWidth="1.5" strokeLinejoin="round" />

      {/* End dot */}
      <circle
        cx={toX(maxX)} cy={toY(ys[ys.length - 1])}
        r="3" fill={lineClr}
      />
    </svg>
  );
}

// ── Main page ──────────────────────────────────────────────────

export default function Economy() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['economy'],
    queryFn:  api.economy.getState,
    refetchInterval: 5_000,
  });

  // Accumulate market history across refetches
  const historyRef = useRef<ChartPoint[]>([]);
  const [chartPoints, setChartPoints] = useState<ChartPoint[]>([]);

  useEffect(() => {
    if (!data) return;
    const existing = historyRef.current;
    const last = existing[existing.length - 1];
    if (!last || last.tick !== data.tick_count) {
      const next = [...existing, { tick: data.tick_count, value: data.market_index }].slice(-80);
      historyRef.current = next;
      setChartPoints(next);
    }
  }, [data]);

  const push = useMutation({
    mutationFn: (dir: 'up' | 'down') => api.economy.push(dir),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['economy'] }),
  });

  if (!data) {
    return (
      <div className="page">
        <p className="label animate-pulse text-amber-400/60">Loading exchange…</p>
      </div>
    );
  }

  const annualTrend = (data.market_trend * 2 * 100).toFixed(1);
  const trendUp     = parseFloat(annualTrend) >= 0;

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header>
        <h1 className="page-title">The Exchange</h1>
        <p className="page-subtitle">
          Year {data.current_year} · Tick {data.tick_count}
        </p>
      </header>

      {/* ── Market index ── */}
      <div className="panel p-5 space-y-4">
        <span className="label text-gold/70">Market Index</span>

        <div className="flex items-end gap-4">
          <span className="font-display text-4xl font-bold text-gold tabular-nums">
            {data.market_index.toFixed(2)}
          </span>
          <span className={`text-sm mb-1 ${data.market_trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {data.market_trend >= 0 ? '+' : ''}
            {(data.market_trend * 100).toFixed(1)}% / tick
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4 text-[11px] text-muted">
          <div>
            Annualized{' '}
            <span className={`font-medium ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {trendUp ? '+' : ''}{annualTrend}%
            </span>
          </div>
          <div>
            Volatility{' '}
            <span className="font-medium text-zinc-300">
              ±{(data.market_volatility * 100).toFixed(1)}% / tick
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
            className="px-5 py-1.5 rounded text-xs border border-red-800/60 text-red-400
                       hover:bg-red-900/20 transition-colors disabled:opacity-40"
          >
            ↓ Bear Push
          </button>
          <span className="text-[10px] text-muted self-center ml-1">±0.5% per press</span>
        </div>
      </div>

      {/* ── History chart ── */}
      <div className="panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="label text-gold/70">Market History</span>
          <span className="text-[9px] text-muted">last {chartPoints.length} ticks</span>
        </div>
        <MarketChart points={chartPoints} />
      </div>

      {/* ── Stats strip ── */}
      <div className="panel p-4 grid grid-cols-3 gap-4 text-center">
        {[
          { label: 'Ticks Run',    value: data.tick_count,   color: 'text-zinc-200' },
          { label: 'Years Elapsed',value: data.current_year, color: 'text-gold'     },
          { label: 'Souls Lost',   value: data.total_deaths, color: 'text-red-400'  },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div className="label mb-1">{label}</div>
            <div className={`text-lg font-medium font-display tabular-nums ${color}`}>{value}</div>
          </div>
        ))}
      </div>

    </div>
  );
}
