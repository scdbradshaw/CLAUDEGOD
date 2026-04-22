// ============================================================
// The Exchange — three-market trading floor
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { MarketHistoryEntry, MarketHighlights, MarketBucketHighlight } from '@civ-sim/shared';

// ── Chart ────────────────────────────────────────────────────

const CHART_W = 600;
const CHART_H = 130;
const PAD     = { top: 10, right: 16, bottom: 22, left: 48 };

const MARKET_COLORS = {
  stable:   '#60a5fa', // blue
  standard: '#fbbf24', // gold
  volatile: '#f87171', // red
};

interface ChartProps {
  points: MarketHistoryEntry[];
}

function ThreeMarketChart({ points }: ChartProps) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-32 text-muted text-xs">
        Watching the markets…
      </div>
    );
  }

  const ticks   = points.map(p => p.tick);
  const allVals = points.flatMap(p => [p.stable, p.standard, p.volatile]);
  const minX = ticks[0],   maxX = ticks[ticks.length - 1];
  const minY = Math.min(...allVals), maxY = Math.max(...allVals);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top  - PAD.bottom;

  const toX = (x: number) => PAD.left + ((x - minX) / rangeX) * innerW;
  const toY = (y: number) => PAD.top  + (1 - (y - minY) / rangeY) * innerH;

  const linePath = (key: keyof Omit<MarketHistoryEntry, 'tick'>) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.tick).toFixed(1)},${toY(p[key]).toFixed(1)}`).join(' ');

  const yLabels = [minY, (minY + maxY) / 2, maxY];

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="w-full"
      style={{ height: `${CHART_H}px` }}
      aria-label="Three-market history"
    >
      {/* Grid lines */}
      {yLabels.map((v, i) => (
        <g key={i}>
          <line
            x1={PAD.left} y1={toY(v)} x2={PAD.left + innerW} y2={toY(v)}
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

      {/* X-axis labels */}
      {[minX, Math.round((minX + maxX) / 2), maxX].map((t, i) => (
        <text key={i} x={toX(t)} y={PAD.top + innerH + 14} textAnchor="middle" fontSize="9" fill="#7a7060">
          T{t}
        </text>
      ))}

      {/* Lines per market */}
      {(['stable', 'standard', 'volatile'] as const).map(key => (
        <path
          key={key}
          d={linePath(key)}
          fill="none"
          stroke={MARKET_COLORS[key]}
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.9"
        />
      ))}

      {/* End dots */}
      {(['stable', 'standard', 'volatile'] as const).map(key => {
        const last = points[points.length - 1];
        return (
          <circle
            key={key}
            cx={toX(last.tick)} cy={toY(last[key])}
            r="3" fill={MARKET_COLORS[key]}
          />
        );
      })}
    </svg>
  );
}

// ── Market card ──────────────────────────────────────────────

interface MarketCardProps {
  label:       string;
  tagline:     string;
  index:       number;
  trend:       number;
  volatility:  number;
  memberCount: number;
  highlight:   MarketBucketHighlight | null;
  color:       string;
  borderColor: string;
}

function MarketCard({
  label, tagline, index, trend, volatility, memberCount, highlight, color, borderColor,
}: MarketCardProps) {
  const trendUp  = trend >= 0;
  const lastGain = highlight?.gain_per_person ?? null;
  const gainUp   = lastGain !== null && lastGain >= 0;

  return (
    <div className={`panel p-4 space-y-3 border-t-2`} style={{ borderTopColor: borderColor }}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-sm font-semibold" style={{ color }}>{label}</div>
          <div className="text-[10px] text-muted mt-0.5">{tagline}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-xl font-bold text-zinc-100 tabular-nums">{index.toFixed(2)}</div>
          <div className={`text-[10px] ${trendUp ? 'text-emerald-400' : 'text-red-400'}`}>
            {trendUp ? '+' : ''}{(trend * 100).toFixed(1)}% trend/tick
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center border-t border-border/40 pt-3">
        <div>
          <div className="label text-[9px] mb-0.5">Volatility</div>
          <div className="text-xs text-zinc-300">±{(volatility * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div className="label text-[9px] mb-0.5">Investors</div>
          <div className="text-xs text-zinc-300">{memberCount.toLocaleString()}</div>
        </div>
        <div>
          <div className="label text-[9px] mb-0.5">Last tick</div>
          {lastGain !== null ? (
            <div className={`text-xs font-medium ${gainUp ? 'text-emerald-400' : 'text-red-400'}`}>
              {gainUp ? '+' : ''}{lastGain.toLocaleString()}
            </div>
          ) : (
            <div className="text-xs text-muted">—</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Highlights strip ─────────────────────────────────────────

function HighlightsStrip({ highlights }: { highlights: MarketHighlights | Record<string, never> }) {
  const h = highlights as Partial<MarketHighlights>;
  if (!h.top_gainer && !h.top_loser) {
    return (
      <div className="panel p-4 text-center text-xs text-muted">
        No market highlights yet — run a tick to see action.
      </div>
    );
  }

  return (
    <div className="panel p-4 grid grid-cols-2 gap-4">
      <div className="space-y-1">
        <div className="label text-[10px] text-emerald-400/70">Top Gainer — Last Tick</div>
        {h.top_gainer ? (
          <>
            <div className="text-sm text-zinc-100 font-medium">{h.top_gainer.name}</div>
            <div className="text-[11px] text-muted capitalize">
              {h.top_gainer.market} market
              <span className="text-emerald-400 ml-1 font-medium">
                +{h.top_gainer.gain.toLocaleString()}
              </span>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted">No gains this tick.</div>
        )}
      </div>
      <div className="space-y-1 border-l border-border/40 pl-4">
        <div className="label text-[10px] text-red-400/70">Top Loser — Last Tick</div>
        {h.top_loser ? (
          <>
            <div className="text-sm text-zinc-100 font-medium">{h.top_loser.name}</div>
            <div className="text-[11px] text-muted capitalize">
              {h.top_loser.market} market
              <span className="text-red-400 ml-1 font-medium">
                {h.top_loser.gain.toLocaleString()}
              </span>
            </div>
          </>
        ) : (
          <div className="text-xs text-muted">No losses this tick.</div>
        )}
      </div>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────

export default function Economy() {
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey:        ['economy'],
    queryFn:         api.economy.getState,
    refetchInterval: 5_000,
  });

  // Accumulate chart history across refetches (live overlay on top of server history)
  const historyRef = useRef<MarketHistoryEntry[]>([]);
  const [chartPoints, setChartPoints] = useState<MarketHistoryEntry[]>([]);

  useEffect(() => {
    if (!data) return;
    const serverHistory = data.market_history ?? [];
    if (serverHistory.length > 0) {
      historyRef.current = serverHistory;
      setChartPoints(serverHistory);
    } else if (data.tick_count > 0) {
      // No DB history yet — seed from current snapshot
      const existing = historyRef.current;
      const last = existing[existing.length - 1];
      if (!last || last.tick !== data.tick_count) {
        const next = [
          ...existing,
          { tick: data.tick_count, stable: data.market_stable_index, standard: data.market_index, volatile: data.market_volatile_index },
        ].slice(-100);
        historyRef.current = next;
        setChartPoints(next);
      }
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

  const highlights = data.market_highlights as MarketHighlights | Record<string, never>;
  const counts     = data.market_member_counts ?? { stable: 0, standard: 0, volatile: 0 };
  const h          = highlights as Partial<MarketHighlights>;

  const markets: MarketCardProps[] = [
    {
      label:       'Stable',
      tagline:     'Bonds · low risk, steady growth',
      index:       data.market_stable_index,
      trend:       data.market_stable_trend,
      volatility:  data.market_stable_volatility,
      memberCount: counts.stable,
      highlight:   h.stable ?? null,
      color:       MARKET_COLORS.stable,
      borderColor: MARKET_COLORS.stable,
    },
    {
      label:       'Standard',
      tagline:     'Index · balanced risk / reward',
      index:       data.market_index,
      trend:       data.market_trend,
      volatility:  data.market_volatility,
      memberCount: counts.standard,
      highlight:   h.standard ?? null,
      color:       MARKET_COLORS.standard,
      borderColor: MARKET_COLORS.standard,
    },
    {
      label:       'Volatile',
      tagline:     'Speculative · high risk, high reward',
      index:       data.market_volatile_index,
      trend:       data.market_volatile_trend,
      volatility:  data.market_volatile_volatility,
      memberCount: counts.volatile,
      highlight:   h.volatile ?? null,
      color:       MARKET_COLORS.volatile,
      borderColor: MARKET_COLORS.volatile,
    },
  ];

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header className="flex items-end justify-between">
        <div>
          <h1 className="page-title">The Exchange</h1>
          <p className="page-subtitle">
            Year {data.current_year} · Tick {data.tick_count}
          </p>
        </div>
        {/* Bull/Bear controls */}
        <div className="flex gap-2">
          <button
            onClick={() => push.mutate('up')}
            disabled={push.isPending}
            className="btn-sim text-xs px-4 py-1.5 disabled:opacity-40"
          >
            ↑ Bull
          </button>
          <button
            onClick={() => push.mutate('down')}
            disabled={push.isPending}
            className="px-4 py-1.5 rounded text-xs border border-red-800/60 text-red-400
                       hover:bg-red-900/20 transition-colors disabled:opacity-40"
          >
            ↓ Bear
          </button>
          <span className="text-[10px] text-muted self-center">±0.5%/tick on standard</span>
        </div>
      </header>

      {/* ── Market cards ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {markets.map(m => <MarketCard key={m.label} {...m} />)}
      </div>

      {/* ── Combined history chart ── */}
      <div className="panel p-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="label text-gold/70">Market History</span>
          <div className="flex gap-3 text-[10px]">
            {(['stable', 'standard', 'volatile'] as const).map(k => (
              <span key={k} className="flex items-center gap-1" style={{ color: MARKET_COLORS[k] }}>
                <span className="w-2 h-0.5 inline-block" style={{ background: MARKET_COLORS[k] }} />
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </span>
            ))}
          </div>
          <span className="text-[9px] text-muted">last {chartPoints.length} ticks</span>
        </div>
        <ThreeMarketChart points={chartPoints} />
      </div>

      {/* ── Market highlights ── */}
      <div className="space-y-2">
        <span className="label text-gold/70">Last Tick Highlights</span>
        <HighlightsStrip highlights={highlights} />
      </div>

      {/* ── Income note ── */}
      <div className="panel p-3 text-[10px] text-muted border border-amber-900/30">
        <span className="text-amber-400/80 font-medium">Income model (placeholder):</span>{' '}
        Each soul earns <span className="text-zinc-300">20,000 / tick</span> — 80% direct wages, 20% auto-invested in their assigned market.
        Assignment is trait-driven: high intelligence + high cunning → volatile; high intelligence → stable; everyone else → standard.
      </div>

      {/* ── Stats strip ── */}
      <div className="panel p-4 grid grid-cols-3 gap-4 text-center">
        {[
          { label: 'Ticks Run',    value: data.tick_count,               color: 'text-zinc-200' },
          { label: 'Years Elapsed', value: data.current_year,            color: 'text-gold'     },
          { label: 'Souls Lost',   value: data.total_deaths,             color: 'text-red-400'  },
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
