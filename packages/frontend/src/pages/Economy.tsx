// ============================================================
// The Exchange — three-market trading floor
// Per-market sliders (trend + volatility), crash/bull buttons,
// and individual history sparklines.
// ============================================================

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import { api } from '../api/client';
import type { MarketHistoryEntry, MarketHighlights, MarketBucketHighlight } from '@civ-sim/shared';

// ── Constants ────────────────────────────────────────────────

const MARKET_COLORS = {
  stable:   '#60a5fa', // blue
  standard: '#fbbf24', // gold
  volatile: '#f87171', // red
};

type Bucket = 'stable' | 'standard' | 'volatile';

// Slider bounds (frontend UX) — kept tighter than backend clamps.
const TREND_MIN      = -0.10;
const TREND_MAX      =  0.20;
const VOLATILITY_MIN =  0.00;
const VOLATILITY_MAX =  0.30;

// Crash/bull shock magnitudes
const CRASH_MULTIPLIER = 0.50;
const BULL_MULTIPLIER  = 1.50;

// ── Per-market sparkline ─────────────────────────────────────

const SPARK_W = 320;
const SPARK_H = 90;
const SPARK_PAD = { top: 6, right: 6, bottom: 14, left: 34 };

function MarketSparkline({ points, color, bucket }: { points: MarketHistoryEntry[]; color: string; bucket: Bucket }) {
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center text-muted text-[10px]" style={{ height: SPARK_H }}>
        awaiting ticks…
      </div>
    );
  }

  const vals = points.map(p => p[bucket]);
  const ticks = points.map(p => p.tick);
  const minX = ticks[0], maxX = ticks[ticks.length - 1];
  const minY = Math.min(...vals), maxY = Math.max(...vals);
  const rangeX = maxX - minX || 1;
  const rangeY = (maxY - minY) || 1;

  const innerW = SPARK_W - SPARK_PAD.left - SPARK_PAD.right;
  const innerH = SPARK_H - SPARK_PAD.top  - SPARK_PAD.bottom;

  const toX = (x: number) => SPARK_PAD.left + ((x - minX) / rangeX) * innerW;
  const toY = (y: number) => SPARK_PAD.top  + (1 - (y - minY) / rangeY) * innerH;

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.tick).toFixed(1)},${toY(p[bucket]).toFixed(1)}`)
    .join(' ');

  // Area fill under the line
  const areaPath =
    `${path} L${toX(maxX).toFixed(1)},${(SPARK_PAD.top + innerH).toFixed(1)} ` +
    `L${toX(minX).toFixed(1)},${(SPARK_PAD.top + innerH).toFixed(1)} Z`;

  const last = points[points.length - 1];
  const yLabels = [minY, maxY];

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="w-full"
      style={{ height: SPARK_H }}
      aria-label={`${bucket} market sparkline`}
    >
      {/* Baseline at y=1.0 if in range */}
      {minY <= 1 && maxY >= 1 && (
        <line
          x1={SPARK_PAD.left} y1={toY(1)} x2={SPARK_PAD.left + innerW} y2={toY(1)}
          stroke="#3a3320" strokeDasharray="2,3" strokeWidth="1"
        />
      )}

      {/* Y-axis labels */}
      {yLabels.map((v, i) => (
        <text
          key={i}
          x={SPARK_PAD.left - 4} y={toY(v)}
          textAnchor="end" dominantBaseline="middle"
          fontSize="9" fill="#7a7060"
        >
          {v.toFixed(2)}
        </text>
      ))}

      {/* Area */}
      <path d={areaPath} fill={color} opacity="0.12" />

      {/* Line */}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />

      {/* End dot */}
      <circle cx={toX(last.tick)} cy={toY(last[bucket])} r="2.5" fill={color} />

      {/* Tick range label */}
      <text
        x={SPARK_PAD.left + innerW} y={SPARK_H - 2}
        textAnchor="end" fontSize="8" fill="#5a5040"
      >
        T{minX}–T{maxX}
      </text>
    </svg>
  );
}

// ── Labeled slider ───────────────────────────────────────────

interface SliderProps {
  label:    string;
  value:    number;
  min:      number;
  max:      number;
  step:     number;
  display:  (v: number) => string;
  onCommit: (v: number) => void;
  disabled?: boolean;
  color:     string;
}

function Slider({ label, value, min, max, step, display, onCommit, disabled, color }: SliderProps) {
  // Local draft so dragging doesn't fire a PATCH on every pixel
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px]">
        <span className="label" style={{ color }}>{label}</span>
        <span className="tabular-nums text-zinc-300">{display(draft)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        onChange={e => setDraft(Number(e.target.value))}
        onMouseUp={() => draft !== value && onCommit(draft)}
        onTouchEnd={() => draft !== value && onCommit(draft)}
        onKeyUp={() => draft !== value && onCommit(draft)}
        className="w-full accent-current"
        style={{ accentColor: color }}
      />
    </div>
  );
}

// ── Market card (control panel + sparkline) ──────────────────

interface MarketCardProps {
  bucket:      Bucket;
  label:       string;
  tagline:     string;
  index:       number;
  trend:       number;
  volatility:  number;
  memberCount: number;
  highlight:   MarketBucketHighlight | null;
  color:       string;
  chartPoints: MarketHistoryEntry[];
  onPatch:     (patch: { trend?: number; volatility?: number; index?: number }) => void;
  pending:     boolean;
}

function MarketCard({
  bucket, label, tagline, index, trend, volatility, memberCount, highlight, color, chartPoints, onPatch, pending,
}: MarketCardProps) {
  const trendUp  = trend >= 0;
  const lastGain = highlight?.gain_per_person ?? null;
  const gainUp   = lastGain !== null && lastGain >= 0;

  return (
    <div className="panel p-4 space-y-4 border-t-2" style={{ borderTopColor: color }}>
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

      {/* Sparkline — just this market */}
      <MarketSparkline points={chartPoints} color={color} bucket={bucket} />

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 text-center border-t border-border/40 pt-3">
        <div>
          <div className="label text-[9px] mb-0.5">Volatility</div>
          <div className="text-xs text-zinc-300">±{(volatility * 100).toFixed(1)}%</div>
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

      {/* Sliders */}
      <div className="space-y-3 pt-1">
        <Slider
          label="Trend / tick"
          value={trend}
          min={TREND_MIN}
          max={TREND_MAX}
          step={0.001}
          display={v => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`}
          onCommit={v => onPatch({ trend: v })}
          disabled={pending}
          color={color}
        />
        <Slider
          label="Volatility"
          value={volatility}
          min={VOLATILITY_MIN}
          max={VOLATILITY_MAX}
          step={0.005}
          display={v => `±${(v * 100).toFixed(1)}%`}
          onCommit={v => onPatch({ volatility: v })}
          disabled={pending}
          color={color}
        />
      </div>

      {/* Shock buttons */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={() => onPatch({ index: Math.max(0.10, index * CRASH_MULTIPLIER) })}
          disabled={pending}
          className="px-3 py-1.5 rounded text-[11px] border border-red-800/60 text-red-400
                     hover:bg-red-900/25 transition-colors disabled:opacity-40"
          title={`Crash to ${(index * CRASH_MULTIPLIER).toFixed(2)}`}
        >
          ↓↓ Crash ×{CRASH_MULTIPLIER}
        </button>
        <button
          onClick={() => onPatch({ index: Math.min(10, index * BULL_MULTIPLIER) })}
          disabled={pending}
          className="btn-sim text-[11px] px-3 py-1.5 disabled:opacity-40"
          title={`Bull to ${(index * BULL_MULTIPLIER).toFixed(2)}`}
        >
          ↑↑ Bull ×{BULL_MULTIPLIER}
        </button>
      </div>

      {/* Quick-set index back to 1.0 */}
      <button
        onClick={() => onPatch({ index: 1.0 })}
        disabled={pending || Math.abs(index - 1.0) < 0.005}
        className="w-full text-[10px] text-muted hover:text-zinc-300 underline underline-offset-2
                   disabled:opacity-30 disabled:no-underline transition-colors"
      >
        reset index → 1.00
      </button>
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
    } else if (data.year_count > 0) {
      const existing = historyRef.current;
      const last = existing[existing.length - 1];
      if (!last || last.tick !== data.year_count) {
        const next = [
          ...existing,
          { tick: data.year_count, stable: data.market_stable_index, standard: data.market_index, volatile: data.market_volatile_index },
        ].slice(-100);
        historyRef.current = next;
        setChartPoints(next);
      }
    }
  }, [data]);

  const patch = useMutation({
    mutationFn: ({ bucket, body }: { bucket: Bucket; body: { trend?: number; volatility?: number; index?: number } }) =>
      api.economy.patchMarket(bucket, body),
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

  const markets: Array<Omit<MarketCardProps, 'onPatch' | 'pending' | 'chartPoints'>> = [
    {
      bucket:      'stable',
      label:       'trusUS',
      tagline:     'Low risk · steady growth',
      index:       data.market_stable_index,
      trend:       data.market_stable_trend,
      volatility:  data.market_stable_volatility,
      memberCount: counts.stable,
      highlight:   h.stable ?? null,
      color:       MARKET_COLORS.stable,
    },
    {
      bucket:      'standard',
      label:       'dreamBIG',
      tagline:     'Medium risk · balanced reward',
      index:       data.market_index,
      trend:       data.market_trend,
      volatility:  data.market_volatility,
      memberCount: counts.standard,
      highlight:   h.standard ?? null,
      color:       MARKET_COLORS.standard,
    },
    {
      bucket:      'volatile',
      label:       'riskAwin',
      tagline:     'High risk · high reward',
      index:       data.market_volatile_index,
      trend:       data.market_volatile_trend,
      volatility:  data.market_volatile_volatility,
      memberCount: counts.volatile,
      highlight:   h.volatile ?? null,
      color:       MARKET_COLORS.volatile,
    },
  ];

  return (
    <div className="page space-y-6">

      {/* ── Header ── */}
      <header>
        <h1 className="page-title">The Exchange</h1>
        <p className="page-subtitle">
          Year {data.current_year} · {chartPoints.length} data points
        </p>
      </header>

      {/* ── Market cards (each with its own chart + sliders + shocks) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {markets.map(m => (
          <MarketCard
            key={m.bucket}
            {...m}
            chartPoints={chartPoints}
            pending={patch.isPending}
            onPatch={body => patch.mutate({ bucket: m.bucket, body })}
          />
        ))}
      </div>

      {/* ── Market highlights ── */}
      <div className="space-y-2">
        <span className="label text-gold/70">Last Year Highlights</span>
        <HighlightsStrip highlights={highlights} />
      </div>

      {/* ── Income note ── */}
      <div className="panel p-3 text-[10px] text-muted border border-amber-900/30">
        <span className="text-amber-400/80 font-medium">Income model (placeholder):</span>{' '}
        Each soul earns <span className="text-zinc-300">20,000 / year</span> — 80% direct wages, 20% auto-invested in their assigned market.
        Assignment is trait-driven: high intelligence + high cunning → riskAwin; high intelligence → trusUS; everyone else → dreamBIG.
      </div>

      {/* ── Stats strip ── */}
      <div className="panel p-4 grid grid-cols-3 gap-4 text-center">
        {[
          { label: 'Years Elapsed', value: data.year_count,    color: 'text-zinc-200' },
          { label: 'Current Year',  value: data.current_year,  color: 'text-gold'     },
          { label: 'Souls Lost',    value: data.total_deaths,  color: 'text-red-400'  },
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
