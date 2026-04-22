// ============================================================
// CharacterCard — 5 key stats at a glance.
// Stats: Health, Morality, Influence, Happiness, Wealth.
// Click card body to open CharacterDetail.
// onEdit prop (optional) shows an edit button for quick stat sliders.
// ============================================================

import { useNavigate } from 'react-router-dom';
import type { CharacterListItem } from '@civ-sim/shared';
import StatBar, { statTextColor } from './StatBar';

interface Props {
  person:  CharacterListItem;
  onEdit?: () => void;
}

function wealthStr(w: number): string {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(1)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(1)}K`;
  return `$${w.toFixed(0)}`;
}

/** Left border color encodes health at a glance */
function healthBorder(health: number): string {
  if (health >= 67) return 'border-l-emerald-700/70 hover:border-l-emerald-500';
  if (health >= 34) return 'border-l-amber-700/70   hover:border-l-amber-500';
  return                    'border-l-red-700/70     hover:border-l-red-500';
}

/** Derive the 3 social vitals from traits JSONB */
function deriveVitals(traits: Record<string, number>) {
  const avg = (...vals: number[]) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  return {
    morality:  avg(traits.honesty ?? 50, traits.courage ?? 50, traits.discipline ?? 50),
    influence: avg(traits.charisma ?? 50, traits.leadership ?? 50),
    happiness: avg(traits.humor ?? 50, traits.empathy ?? 50),
  };
}

export default function CharacterCard({ person, onEdit }: Props) {
  const navigate = useNavigate();
  const traits   = (person.traits ?? {}) as Record<string, number>;
  const { morality, influence, happiness } = deriveVitals(traits);
  const wealthPct = Math.min((person.wealth / 50_000) * 100, 100);

  return (
    <div
      onClick={() => navigate(`/characters/${person.id}`)}
      className={`panel block p-4 border-l-2 ${healthBorder(person.health)}
                  hover:border-border-warm transition-all duration-150 group space-y-3 cursor-pointer`}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-display text-sm font-bold text-gray-100 group-hover:text-gold
                       transition-colors leading-snug truncate">
          {person.name}
        </h2>
        <div className="flex items-center gap-1.5 shrink-0">
          {onEdit && (
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(); }}
              className="text-[10px] text-muted hover:text-gold transition-colors leading-none"
              title="Edit stats"
            >
              ✏
            </button>
          )}
          <span className="text-[10px] text-muted">Age {person.age}</span>
        </div>
      </div>

      {/* ── Race + occupation ── */}
      {(person.race || person.occupation) && (
        <p className="text-[10px] text-muted leading-none">
          {person.race}
          {person.occupation && <> · <span className="text-zinc-500">{person.occupation}</span></>}
        </p>
      )}

      {/* ── 5 key stats ── */}
      <div className="space-y-1.5 pt-1 border-t border-border/40">
        <StatBar label="Health"    value={person.health} />
        <StatBar label="Morality"  value={morality}      />
        <StatBar label="Influence" value={influence}     />
        <StatBar label="Happiness" value={happiness}     />

        {/* Wealth uses a custom bar since it's not 0-100 */}
        <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
          <span className="text-[10px] text-muted uppercase tracking-widest truncate">Wealth</span>
          <div className="stat-bar-track">
            <div
              className="h-full rounded-full transition-all duration-500 bg-amber-500"
              style={{ width: `${wealthPct}%`, opacity: 0.5 + wealthPct / 200 }}
            />
          </div>
          <span className={`text-[11px] font-medium w-14 text-right tabular-nums ${statTextColor(wealthPct)}`}>
            {wealthStr(person.wealth)}
          </span>
        </div>
      </div>

      {/* ── Religion tag ── */}
      {person.religion && person.religion !== 'None' && (
        <div className="flex flex-wrap gap-1 pt-1">
          <span className="text-[9px] text-violet-400/80 border border-violet-800/40
                           rounded px-1.5 py-0.5 leading-none">
            ✦ {person.religion}
          </span>
        </div>
      )}
    </div>
  );
}
