// Market page (§6.4 v2). Charts the stock-market history off the new
// World.market_signals_history field plus the existing market_index_history.
//
// All charts are custom SVG, matching the WorldMap MarketChart pattern.
// Empty-state when fewer than two history points exist (charts need at
// least a line).

import { useParams } from 'react-router-dom';
import type { RegionResource } from '@claude-god/shared';
import {
  REGION_PRODUCTION_BONUS,
  CASCADE_FOOD_RATIO_FLOOR,
} from '@claude-god/shared';
import { useWorld } from '../hooks/useWorld';
import { useActiveEvents } from '../hooks/useActiveEvents';
import type { MarketSignalsEntry } from '../lib/wireTypes';

const ECONOMY_EVENT_TYPES = new Set([
  'Famine',
  'Drought',
  'BountifulHarvest',
  'GreatCrash',
  'GoldenAge',
]);

export function Market() {
  const { worldId } = useParams<{ worldId: string }>();
  const worldQ = useWorld(worldId);
  const eventsQ = useActiveEvents(worldId);

  if (worldQ.isLoading) return <Centered>Loading market…</Centered>;
  if (worldQ.error) return <Centered tone="bad">Failed to load.</Centered>;
  if (!worldQ.data) return <Centered>World not found.</Centered>;

  const { world, city } = worldQ.data;
  const indexHistory = world.market_index_history ?? [];
  const signalsHistory = world.market_signals_history ?? [];
  const latest = signalsHistory[signalsHistory.length - 1];
  const economyEvents = (eventsQ.data ?? []).filter((e) =>
    ECONOMY_EVENT_TYPES.has(e.event_def_id),
  );

  const status = marketStatus(world.market_index);

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-gold-bright">Market</h1>
          <p className="text-muted text-xs mt-1">
            {world.name} · year {world.current_year}
          </p>
        </div>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-2xl text-parchment tabular-nums">
            {world.market_index.toFixed(2)}
          </span>
          <StatusChip status={status} />
        </div>
      </header>

      {economyEvents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {economyEvents.map((e) => (
            <span
              key={e.id}
              className="text-xs uppercase tracking-wider px-2 py-1 border border-rune/60 text-rune rounded"
              title={`Started year ${e.started_year}`}
            >
              {e.event_def_id}
            </span>
          ))}
        </div>
      )}

      {indexHistory.length > 1 ? (
        <MarketIndexChart history={indexHistory} currentIndex={world.market_index} />
      ) : (
        <EmptyChart label="Market index" />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {signalsHistory.length > 1 ? (
          <FoodChart history={signalsHistory} />
        ) : (
          <EmptyChart label="Food production vs consumption" />
        )}
        {signalsHistory.length > 1 ? (
          <ClassSignalsChart history={signalsHistory} />
        ) : (
          <EmptyChart label="Class signal breakdown" />
        )}
      </div>

      <SnapshotPanel
        latest={latest}
        region={city?.region_resource}
        status={status}
      />
    </div>
  );
}

// ─── Charts ────────────────────────────────────────────────────────────────

function MarketIndexChart({
  history,
  currentIndex,
}: {
  history: Array<{ year: number; index: number }>;
  currentIndex: number;
}) {
  const w = 800;
  const h = 200;
  const padX = 40;
  const padY = 20;
  const minIdx = Math.min(0.2, ...history.map((p) => p.index));
  const maxIdx = Math.max(2.0, ...history.map((p) => p.index));
  const span = Math.max(0.1, maxIdx - minIdx);
  const minYear = history[0].year;
  const maxYear = history[history.length - 1].year;
  const xRange = Math.max(1, maxYear - minYear);

  const yFor = (v: number) => h - padY - ((v - minIdx) / span) * (h - 2 * padY);
  const xFor = (year: number) =>
    padX + ((year - minYear) / xRange) * (w - 2 * padX);

  const points = history.map((p) => `${xFor(p.year).toFixed(1)},${yFor(p.index).toFixed(1)}`).join(' ');
  const baselineY = yFor(1);
  const boomY = yFor(1.6);
  const crashY = yFor(0.3);

  return (
    <ChartCard
      title="Market index"
      subtitle={`now ${currentIndex.toFixed(2)} · year ${minYear} → ${maxYear}`}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-52" preserveAspectRatio="none">
        {/* Boom band ≥ 1.6 */}
        <rect
          x={padX}
          y={padY}
          width={w - 2 * padX}
          height={Math.max(0, boomY - padY)}
          className="fill-gold-bright/10"
        />
        {/* Crash band < 0.3 */}
        <rect
          x={padX}
          y={crashY}
          width={w - 2 * padX}
          height={Math.max(0, h - padY - crashY)}
          className="fill-blood/10"
        />
        {/* Reference baseline at 1.0 */}
        <line
          x1={padX}
          x2={w - padX}
          y1={baselineY}
          y2={baselineY}
          stroke="currentColor"
          strokeDasharray="3,3"
          strokeWidth="0.5"
          className="text-muted/60"
        />
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={points}
          className="text-gold-bright"
        />
        <AxisLabels
          minY={minIdx}
          maxY={maxIdx}
          minYear={minYear}
          maxYear={maxYear}
          padX={padX}
          padY={padY}
          h={h}
          w={w}
          format={(v) => v.toFixed(1)}
        />
      </svg>
    </ChartCard>
  );
}

function FoodChart({ history }: { history: MarketSignalsEntry[] }) {
  const w = 600;
  const h = 200;
  const padX = 40;
  const padY = 20;
  const minYear = history[0].year;
  const maxYear = history[history.length - 1].year;
  const xRange = Math.max(1, maxYear - minYear);
  const maxFood = Math.max(
    1,
    ...history.map((e) => Math.max(e.food_produced, e.food_needed)),
  );

  const yFor = (v: number) => h - padY - (v / maxFood) * (h - 2 * padY);
  const xFor = (year: number) =>
    padX + ((year - minYear) / xRange) * (w - 2 * padX);

  const producedPts = history.map((e) => `${xFor(e.year).toFixed(1)},${yFor(e.food_produced).toFixed(1)}`).join(' ');
  const neededPts = history.map((e) => `${xFor(e.year).toFixed(1)},${yFor(e.food_needed).toFixed(1)}`).join(' ');

  // Danger band: where food_produced < FLOOR × food_needed (i.e. food_ratio < 0.7)
  const dangerPts: string[] = [];
  for (const e of history) {
    const dangerLevel = e.food_needed * CASCADE_FOOD_RATIO_FLOOR;
    dangerPts.push(`${xFor(e.year).toFixed(1)},${yFor(dangerLevel).toFixed(1)}`);
  }
  const dangerLine = dangerPts.join(' ');

  const latest = history[history.length - 1];

  return (
    <ChartCard
      title="Food production vs consumption"
      subtitle={`ratio ${latest.food_ratio.toFixed(2)}`}
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-52" preserveAspectRatio="none">
        {/* Danger threshold line (food_ratio = 0.7) */}
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="0.5"
          strokeDasharray="2,2"
          points={dangerLine}
          className="text-blood/60"
        />
        {/* Needed (consumption) */}
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="4,2"
          points={neededPts}
          className="text-muted"
        />
        {/* Produced */}
        <polyline
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          points={producedPts}
          className="text-ember"
        />
        <AxisLabels
          minY={0}
          maxY={maxFood}
          minYear={minYear}
          maxYear={maxYear}
          padX={padX}
          padY={padY}
          h={h}
          w={w}
          format={(v) => formatCount(v)}
        />
      </svg>
      <Legend
        items={[
          { label: 'produced', className: 'text-ember' },
          { label: 'needed', className: 'text-muted', dashed: true },
          { label: 'famine threshold', className: 'text-blood/80', dashed: true },
        ]}
      />
    </ChartCard>
  );
}

function ClassSignalsChart({ history }: { history: MarketSignalsEntry[] }) {
  const w = 600;
  const h = 200;
  const padX = 40;
  const padY = 20;
  const minYear = history[0].year;
  const maxYear = history[history.length - 1].year;
  const xRange = Math.max(1, maxYear - minYear);

  // Find the absolute max delta magnitude so positive + negative scale symmetrically.
  const allDeltas = history.flatMap((e) => [e.delta_food, e.delta_labor, e.delta_craft, e.delta_capital]);
  const maxAbs = Math.max(0.05, ...allDeltas.map((d) => Math.abs(d)));

  const zeroY = h / 2;
  const yFor = (v: number) => zeroY - (v / maxAbs) * (h / 2 - padY);
  const xFor = (year: number) =>
    padX + ((year - minYear) / xRange) * (w - 2 * padX);

  const series: Array<{ key: keyof MarketSignalsEntry & string; className: string; label: string }> = [
    { key: 'delta_food', className: 'text-ember', label: 'food' },
    { key: 'delta_labor', className: 'text-gold-bright', label: 'labor' },
    { key: 'delta_craft', className: 'text-rune', label: 'craft' },
    { key: 'delta_capital', className: 'text-parchment', label: 'capital' },
  ];

  return (
    <ChartCard
      title="Class signal breakdown"
      subtitle="contribution to market move per year"
    >
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-52" preserveAspectRatio="none">
        {/* Zero line */}
        <line
          x1={padX}
          x2={w - padX}
          y1={zeroY}
          y2={zeroY}
          stroke="currentColor"
          strokeWidth="0.5"
          className="text-muted/60"
        />
        {series.map((s) => {
          const pts = history
            .map((e) => `${xFor(e.year).toFixed(1)},${yFor(e[s.key] as number).toFixed(1)}`)
            .join(' ');
          return (
            <polyline
              key={s.key}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.2"
              points={pts}
              className={s.className}
            />
          );
        })}
        <AxisLabels
          minY={-maxAbs}
          maxY={maxAbs}
          minYear={minYear}
          maxYear={maxYear}
          padX={padX}
          padY={padY}
          h={h}
          w={w}
          format={(v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`}
        />
      </svg>
      <Legend items={series.map((s) => ({ label: s.label, className: s.className }))} />
    </ChartCard>
  );
}

// ─── Snapshot panel ────────────────────────────────────────────────────────

function SnapshotPanel({
  latest,
  region,
  status,
}: {
  latest: MarketSignalsEntry | undefined;
  region: RegionResource | undefined;
  status: ReturnType<typeof marketStatus>;
}) {
  const regionMods = region ? REGION_PRODUCTION_BONUS[region] : null;
  const classes = latest?.classes;
  const totalCount = classes
    ? classes.farmer.count + classes.laborer.count + classes.artisan.count + classes.merchant.count
    : 0;

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">Current snapshot</h2>
        <StatusChip status={status} />
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 p-4">
        <div className="space-y-3">
          {region && regionMods && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted mb-1">Region</div>
              <div className="text-parchment capitalize text-base">{region}</div>
              <div className="font-mono text-xs text-muted mt-1">
                farmer ×{regionMods.farmer.toFixed(2)} ·
                laborer ×{regionMods.laborer.toFixed(2)} ·
                artisan ×{regionMods.artisan.toFixed(2)}
              </div>
            </div>
          )}
          {latest && (
            <div>
              <div className="text-xs uppercase tracking-wider text-muted mb-1">
                This year's deltas
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm tabular-nums">
                <DeltaRow label="food" value={latest.delta_food} colorClass="text-ember" />
                <DeltaRow label="labor" value={latest.delta_labor} colorClass="text-gold-bright" />
                <DeltaRow label="craft" value={latest.delta_craft} colorClass="text-rune" />
                <DeltaRow label="capital" value={latest.delta_capital} colorClass="text-parchment" />
              </div>
              <div className="text-xs text-muted mt-2">
                food ratio{' '}
                <span
                  className={
                    latest.food_ratio < CASCADE_FOOD_RATIO_FLOOR ? 'text-blood' : 'text-parchment'
                  }
                >
                  {latest.food_ratio.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider text-muted mb-1">
            Lower-class population
          </div>
          {classes && totalCount > 0 ? (
            <>
              <ClassBar
                label="Farmer"
                count={classes.farmer.count}
                wealth={classes.farmer.avg_wealth}
                total={totalCount}
                colorClass="bg-ember"
              />
              <ClassBar
                label="Laborer"
                count={classes.laborer.count}
                wealth={classes.laborer.avg_wealth}
                total={totalCount}
                colorClass="bg-gold-bright"
              />
              <ClassBar
                label="Artisan"
                count={classes.artisan.count}
                wealth={classes.artisan.avg_wealth}
                total={totalCount}
                colorClass="bg-rune"
              />
              <ClassBar
                label="Merchant"
                count={classes.merchant.count}
                wealth={classes.merchant.avg_wealth}
                total={totalCount}
                colorClass="bg-parchment"
              />
            </>
          ) : (
            <div className="text-muted text-sm">No data yet — advance a year.</div>
          )}
        </div>
      </div>
    </section>
  );
}

function ClassBar({
  label,
  count,
  wealth,
  total,
  colorClass,
}: {
  label: string;
  count: number;
  wealth: number;
  total: number;
  colorClass: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="grid grid-cols-[5rem_1fr_4rem_4rem] items-center gap-2 text-sm">
      <span className="text-parchment">{label}</span>
      <div className="h-2 rounded bg-ash/60 overflow-hidden">
        <div className={`${colorClass} h-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-right text-muted tabular-nums">
        {formatCount(count)}
      </span>
      <span className="font-mono text-right text-muted tabular-nums">
        ${formatCount(wealth)}
      </span>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">{title}</h2>
        {subtitle && <span className="text-muted text-xs tabular-nums">{subtitle}</span>}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <ChartCard title={label}>
      <div className="text-muted text-sm py-8 text-center">
        Advance a few years to populate this chart.
      </div>
    </ChartCard>
  );
}

function AxisLabels({
  minY,
  maxY,
  minYear,
  maxYear,
  padX,
  padY,
  h,
  w,
  format,
}: {
  minY: number;
  maxY: number;
  minYear: number;
  maxYear: number;
  padX: number;
  padY: number;
  h: number;
  w: number;
  format: (v: number) => string;
}) {
  return (
    <g className="text-muted" fontSize="9" fill="currentColor">
      <text x={4} y={padY + 4} textAnchor="start">{format(maxY)}</text>
      <text x={4} y={h - padY + 4} textAnchor="start">{format(minY)}</text>
      <text x={padX} y={h - 4} textAnchor="middle">{minYear}</text>
      <text x={w - padX} y={h - 4} textAnchor="middle">{maxYear}</text>
    </g>
  );
}

function Legend({
  items,
}: {
  items: Array<{ label: string; className: string; dashed?: boolean }>;
}) {
  return (
    <div className="flex flex-wrap gap-3 mt-2 text-xs">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          <span
            className={`inline-block w-3 h-0.5 ${it.className}`}
            style={{
              backgroundColor: 'currentColor',
              borderTop: it.dashed ? '0.5px dashed currentColor' : undefined,
            }}
          />
          <span className="text-muted">{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function DeltaRow({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: number;
  colorClass: string;
}) {
  const sign = value >= 0 ? '+' : '';
  return (
    <>
      <span className="text-muted">{label}</span>
      <span className={colorClass}>{sign}{value.toFixed(3)}</span>
    </>
  );
}

function StatusChip({ status }: { status: ReturnType<typeof marketStatus> }) {
  const palette = {
    boom: 'border-gold-bright/60 text-gold-bright',
    crash: 'border-blood/60 text-blood',
    weak: 'border-rune/60 text-rune',
    normal: 'border-muted/40 text-muted',
  } as const;
  return (
    <span className={`text-xs uppercase tracking-wider px-2 py-1 border rounded ${palette[status]}`}>
      {status}
    </span>
  );
}

function marketStatus(idx: number): 'boom' | 'crash' | 'weak' | 'normal' {
  if (idx >= 1.6) return 'boom';
  if (idx < 0.3) return 'crash';
  if (idx < 0.7) return 'weak';
  return 'normal';
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toString();
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'bad';
}) {
  const cls = tone === 'bad' ? 'text-blood' : 'text-muted';
  return (
    <div className={`min-h-[40vh] flex items-center justify-center ${cls}`}>{children}</div>
  );
}
