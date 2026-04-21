// ============================================================
// CharacterCard — shows identity + 6 global force scores
// ============================================================

import { Link } from 'react-router-dom';
import type { CharacterListItem } from '@civ-sim/shared';
import { GLOBAL_TRAITS } from '@civ-sim/shared';
import StatBar, { statTextColor } from './StatBar';

interface Props {
  person: CharacterListItem;
}

const FORCE_BARS: { key: string; label: string; color: string }[] = [
  { key: 'scarcity',  label: 'Scarcity',  color: 'text-amber-400'  },
  { key: 'war',       label: 'War',        color: 'text-red-400'    },
  { key: 'faith',     label: 'Faith',      color: 'text-violet-400' },
  { key: 'plague',    label: 'Plague',     color: 'text-green-400'  },
  { key: 'tyranny',   label: 'Tyranny',    color: 'text-orange-400' },
  { key: 'discovery', label: 'Discovery',  color: 'text-sky-400'    },
];

/**
 * Normalize a child value to 0-100 based on its defined min/max range.
 * Higher = better (the child is toward its maximum).
 */
function normalizeChild(force: string, child: string, value: number): number {
  const def = GLOBAL_TRAITS[force as keyof typeof GLOBAL_TRAITS]?.children[child as never] as
    { min: number; max: number } | undefined;
  if (!def || def.max === def.min) return 50;
  return Math.round(((value - def.min) / (def.max - def.min)) * 100);
}

/** Composite 0-100 score for a force: average of 4 normalized children */
function forceScore(force: string, scores: Record<string, number>): number {
  const children = Object.keys(GLOBAL_TRAITS[force as keyof typeof GLOBAL_TRAITS]?.children ?? {});
  if (!children.length) return 0;
  const total = children.reduce((sum, child) => {
    const val = scores[`${force}.${child}`] ?? 0;
    return sum + normalizeChild(force, child, val);
  }, 0);
  return Math.round(total / children.length);
}

function healthBorder(health: number): string {
  if (health >= 67) return 'border-l-emerald-600/70 hover:border-l-emerald-500';
  if (health >= 34) return 'border-l-amber-600/70   hover:border-l-amber-500';
  return                    'border-l-red-600/70     hover:border-l-red-500';
}

export default function CharacterCard({ person }: Props) {
  const scores = (person.global_scores as Record<string, number>) ?? {};

  return (
    <Link
      to={`/characters/${person.id}`}
      className={`panel block p-4 border-l-2 ${healthBorder(person.health)} hover:border-gray-500 transition-all duration-150 group`}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-3">
        <h2 className="font-display text-sm font-bold text-gray-100 group-hover:text-gold transition-colors leading-snug">
          {person.name}
        </h2>
        <div className="text-right">
          <span className="text-[10px] text-muted">Age {person.age}</span>
        </div>
      </div>

      {/* ── Wealth row ── */}
      <div className="mb-3 text-[10px]">
        <span className="text-muted">Wealth </span>
        <span className={`${statTextColor(Math.min(person.wealth / 1000, 100))} font-medium`}>
          {person.wealth >= 1_000_000
            ? `$${(person.wealth / 1_000_000).toFixed(1)}M`
            : person.wealth >= 1_000
            ? `$${(person.wealth / 1_000).toFixed(1)}K`
            : `$${person.wealth.toFixed(0)}`}
        </span>
      </div>

      {/* ── Divider ── */}
      <div className="border-t border-border my-2" />

      {/* ── 6 global force scores ── */}
      <div className="space-y-1.5">
        {FORCE_BARS.map(({ key, label, color }) => (
          <div key={key} className="flex items-center gap-2">
            <span className={`text-[10px] w-16 shrink-0 ${color}`}>{label}</span>
            <div className="flex-1">
              <StatBar label="" value={forceScore(key, scores)} showValue={false} />
            </div>
            <span className="text-[10px] text-muted w-6 text-right tabular-nums">
              {forceScore(key, scores)}
            </span>
          </div>
        ))}
      </div>
    </Link>
  );
}
