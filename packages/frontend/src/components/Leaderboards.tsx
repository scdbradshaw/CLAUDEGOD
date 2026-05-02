// Leaderboard panel — replaces the paginated residents list per Sam's spec.
// Tabs across 8 metrics; click a row to navigate to the person dossier.

import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  useLeaderboard,
  type LeaderboardMetric,
  type LeaderboardPerson,
} from '../hooks/useCity';

const METRICS: { metric: LeaderboardMetric; label: string; column: ColumnKey }[] = [
  { metric: 'richest', label: 'Richest', column: 'wealth' },
  { metric: 'poorest', label: 'Poorest', column: 'wealth' },
  { metric: 'happiest', label: 'Happiest', column: 'happiness' },
  { metric: 'smartest', label: 'Smartest', column: 'intelligence' },
  { metric: 'strongest', label: 'Strongest', column: 'combat' },
  { metric: 'oldest', label: 'Oldest', column: 'age' },
  { metric: 'famous', label: 'Famous', column: 'happiness' },
  { metric: 'infamous', label: 'Infamous', column: 'wealth' },
];

type ColumnKey = 'wealth' | 'happiness' | 'intelligence' | 'combat' | 'age';

interface Props {
  cityId: string;
}

export function Leaderboards({ cityId }: Props) {
  const [active, setActive] = useState<LeaderboardMetric>('richest');
  const cfg = METRICS.find((m) => m.metric === active) ?? METRICS[0];
  const q = useLeaderboard(cityId, active);
  const { worldId } = useParams<{ worldId: string }>();
  const navigate = useNavigate();

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Leaderboards</h2>
      </header>
      <div className="flex flex-wrap gap-1 px-2 pt-2">
        {METRICS.map((m) => (
          <button
            key={m.metric}
            onClick={() => setActive(m.metric)}
            className={
              'px-3 py-1.5 text-xs uppercase tracking-wider rounded transition ' +
              (m.metric === active
                ? 'bg-emerald-700 text-white'
                : 'text-muted hover:text-amber-300 hover:bg-amber-400/10')
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="px-2 pb-2 pt-2">
        {q.isLoading && <div className="px-4 py-6 text-muted text-sm">Loading…</div>}
        {q.error && (
          <div className="px-4 py-6 text-blood text-sm">Failed to load.</div>
        )}
        {q.data && q.data.rows.length === 0 && (
          <div className="px-4 py-6 text-muted text-sm italic">No real persons match.</div>
        )}
        {q.data && q.data.rows.length > 0 && (
          <ol className="divide-y divide-border-warm">
            {q.data.rows.map((p, i) => (
              <li key={p.id}>
                <button
                  className="w-full text-left px-3 py-2 hover:bg-panel transition flex items-center gap-3"
                  onClick={() => navigate(`/world/${worldId}/person/${p.id}`)}
                >
                  <span className="text-muted text-xs tabular-nums w-5 text-right">
                    {i + 1}
                  </span>
                  <span className="flex-1">
                    <span className="font-display text-gold-bright">{p.name}</span>
                    {p.is_pinned && <span className="ml-2 text-rune text-xs">★</span>}
                    <span className="ml-2 text-muted text-xs">{p.type}</span>
                  </span>
                  <span className="font-mono text-sm text-gold tabular-nums">
                    {formatColumn(p, cfg.column)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function formatColumn(p: LeaderboardPerson, col: ColumnKey): string {
  switch (col) {
    case 'wealth':
      return p.wealth.toLocaleString();
    case 'happiness':
      return `${p.happiness}`;
    case 'intelligence':
      return `${p.intelligence}`;
    case 'combat':
      return `${p.combat}`;
    case 'age':
      return `${p.age}y`;
  }
}
