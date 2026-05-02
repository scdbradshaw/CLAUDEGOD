// World map (Phase 11c).
//
// SVG-only — no Canvas, no Pixi. v1 has a single city at (x, y) on a 0–100
// coordinate grid; the map is mostly decoration but renders a region-tinted
// background, the city dot (sized by population), and active world-event
// chips along the top.

import { useNavigate, useParams } from 'react-router-dom';
import type { RegionResource } from '@claude-god/shared';
import { useWorld } from '../hooks/useWorld';
import { useActiveEvents } from '../hooks/useActiveEvents';
import type { CityRow } from '../lib/wireTypes';

const REGION_COLORS: Record<RegionResource, { fill: string; label: string }> = {
  farmland: { fill: '#3a3220', label: 'Farmland' },
  coast: { fill: '#1d3146', label: 'Coast' },
  mountains: { fill: '#2c2c30', label: 'Mountains' },
  forest: { fill: '#1f2c1c', label: 'Forest' },
  desert: { fill: '#3d3520', label: 'Desert' },
  crossroads: { fill: '#3a2c1a', label: 'Crossroads' },
};

export function WorldMap() {
  const { worldId } = useParams<{ worldId: string }>();
  const navigate = useNavigate();
  const worldQ = useWorld(worldId);
  const eventsQ = useActiveEvents(worldId);

  if (worldQ.isLoading) return <Centered>Loading world…</Centered>;
  if (worldQ.error) return <Centered tone="bad">Failed to load world.</Centered>;
  if (!worldQ.data) return <Centered>World not found.</Centered>;

  const { world, city } = worldQ.data;
  const events = eventsQ.data ?? [];

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-gold-bright">{world.name}</h1>
          <p className="text-muted text-xs mt-1">
            Year {world.current_year} · seed{' '}
            <span className="font-mono">{world.random_seed_root}</span>
          </p>
        </div>
        <div className="text-muted text-xs">
          {city ? <RegionPill region={city.region_resource} /> : null}
        </div>
      </header>

      {events.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {events.map((e) => (
            <span
              key={e.id}
              className="text-xs uppercase tracking-wider px-2 py-1 border border-blood/60 text-blood rounded"
              title={`Started year ${e.started_year}`}
            >
              {e.event_def_id}
            </span>
          ))}
        </div>
      )}

      {city ? (
        <CityMap city={city} onSelect={() => navigate(`/world/${world.id}/city/${city.id}`)} />
      ) : (
        <Centered>No city on this world.</Centered>
      )}

      {city && <CityRollup city={city} />}

      {world.market_index_history && world.market_index_history.length > 1 && (
        <MarketChart
          history={world.market_index_history}
          currentIndex={world.market_index}
        />
      )}
    </div>
  );
}

function MarketChart({
  history,
  currentIndex,
}: {
  history: Array<{ year: number; index: number }>;
  currentIndex: number;
}) {
  const w = 600;
  const h = 140;
  const padX = 32;
  const padY = 14;
  const minIdx = Math.min(0.2, ...history.map((p) => p.index));
  const maxIdx = Math.max(2.0, ...history.map((p) => p.index));
  const span = Math.max(0.1, maxIdx - minIdx);
  const minYear = history[0].year;
  const maxYear = history[history.length - 1].year;
  const xRange = Math.max(1, maxYear - minYear);

  const points = history
    .map((p) => {
      const x = padX + ((p.year - minYear) / xRange) * (w - 2 * padX);
      const y = h - padY - ((p.index - minIdx) / span) * (h - 2 * padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Reference baseline at index = 1.0.
  const baselineY = h - padY - ((1 - minIdx) / span) * (h - 2 * padY);

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">Market index</h2>
        <span className="text-muted text-xs tabular-nums">
          now {currentIndex.toFixed(2)} · year {minYear} → {maxYear}
        </span>
      </header>
      <div className="px-4 py-3">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-36"
          preserveAspectRatio="none"
        >
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
        </svg>
      </div>
    </section>
  );
}

function CityMap({ city, onSelect }: { city: CityRow; onSelect: () => void }) {
  const region = REGION_COLORS[city.region_resource] ?? REGION_COLORS.farmland;
  // Population scaling — radius between 1.5 and 5 in viewBox units.
  const r = Math.max(1.5, Math.min(5, Math.sqrt(city.population_total / 4000)));

  return (
    <div className="rounded border border-border-warm bg-panel-warm overflow-hidden">
      <svg
        viewBox="0 0 100 100"
        className="w-full h-[28rem] cursor-pointer"
        onClick={onSelect}
        role="img"
        aria-label="World map"
      >
        <defs>
          <radialGradient id="terrain" cx="50%" cy="50%" r="80%">
            <stop offset="0%" stopColor={region.fill} stopOpacity={1} />
            <stop offset="100%" stopColor="#080b0f" stopOpacity={1} />
          </radialGradient>
          <pattern
            id="grid"
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 10 0 L 0 0 0 10"
              fill="none"
              stroke="#252010"
              strokeOpacity="0.6"
              strokeWidth="0.2"
            />
          </pattern>
        </defs>
        <rect width="100" height="100" fill="url(#terrain)" />
        <rect width="100" height="100" fill="url(#grid)" />

        {city.is_ruined ? (
          <g>
            <circle cx={city.x} cy={city.y} r={r} fill="#3d3850" stroke="#8b1a1a" strokeWidth="0.4" />
            <text
              x={city.x}
              y={city.y - r - 1.2}
              textAnchor="middle"
              fontSize="2.4"
              fill="#8b1a1a"
              className="font-display"
            >
              {city.name} ✝
            </text>
          </g>
        ) : (
          <g className="hover:opacity-90 transition">
            <circle
              cx={city.x}
              cy={city.y}
              r={r + 1.5}
              fill="#c9a432"
              fillOpacity="0.18"
            />
            <circle
              cx={city.x}
              cy={city.y}
              r={r}
              fill="#e0bc50"
              stroke="#5e4a18"
              strokeWidth="0.4"
            />
            <text
              x={city.x}
              y={city.y - r - 1.2}
              textAnchor="middle"
              fontSize="2.6"
              fill="#e0bc50"
              className="font-display"
            >
              {city.name}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

function CityRollup({ city }: { city: CityRow }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <Stat label="Population" value={city.population_total.toLocaleString()} />
      <Stat label="Avg wealth" value={city.avg_wealth.toLocaleString()} />
      <Stat label="Mood" value={city.mood_score.toFixed(1)} />
      <Stat label="Treasury" value={city.treasury.toLocaleString()} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border-warm rounded p-3 bg-panel">
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className="font-display text-gold-bright text-xl tabular-nums">{value}</div>
    </div>
  );
}

function RegionPill({ region }: { region: RegionResource }) {
  const r = REGION_COLORS[region] ?? REGION_COLORS.farmland;
  return (
    <span
      className="px-2 py-1 rounded border text-xs uppercase tracking-wider"
      style={{ borderColor: r.fill, color: '#c9a432' }}
    >
      {r.label}
    </span>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'bad';
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className={tone === 'bad' ? 'text-blood' : 'text-muted'}>{children}</div>
    </div>
  );
}
