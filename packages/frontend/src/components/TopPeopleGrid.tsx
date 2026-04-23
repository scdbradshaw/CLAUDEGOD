// ============================================================
// TopPeopleGrid — vanity leaderboards. One card per axis.
// Each card links to the person's detail page.
// ============================================================

import { Link } from 'react-router-dom';
import type { SnapshotTopPeople } from '../api/client';

interface SlotDef {
  key:   keyof SnapshotTopPeople;
  label: string;
  glyph: string;
  tint:  string;             // text color class for the value
  unit?: string;             // optional suffix (e.g. '$', 'yrs')
}

const SLOTS: SlotDef[] = [
  { key: 'richest',          label: 'Richest',          glyph: '◆', tint: 'text-emerald-300' },
  { key: 'oldest',           label: 'Oldest',           glyph: '⌛', tint: 'text-amber-300',   unit: 'yrs' },
  { key: 'most_connected',   label: 'Most Connected',   glyph: '★', tint: 'text-sky-300',     unit: 'links' },
  { key: 'most_traumatized', label: 'Most Traumatized', glyph: '☠', tint: 'text-red-400' },
  { key: 'most_virtuous',    label: 'Most Virtuous',    glyph: '✦', tint: 'text-emerald-400' },
  { key: 'most_corrupt',     label: 'Most Corrupt',     glyph: '◇', tint: 'text-red-300' },
  { key: 'happiest',         label: 'Happiest',         glyph: '♥', tint: 'text-pink-300' },
  { key: 'saddest',          label: 'Saddest',          glyph: '✧', tint: 'text-slate-300' },
];

function fmtValue(key: keyof SnapshotTopPeople, value: number): string {
  if (key === 'richest') {
    if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 1_000)     return `$${(value / 1_000).toFixed(0)}K`;
    return `$${value}`;
  }
  return value.toLocaleString();
}

export default function TopPeopleGrid({ data }: { data: SnapshotTopPeople }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {SLOTS.map(slot => {
        const row = data[slot.key];
        return (
          <div key={slot.key} className="panel p-3 space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-gold-dim text-sm">{slot.glyph}</span>
              <span className="text-[9px] uppercase tracking-widest text-muted truncate">
                {slot.label}
              </span>
            </div>
            {row ? (
              <>
                <Link
                  to={`/characters/${row.id}`}
                  className="block text-xs text-gray-100 font-medium hover:text-gold transition-colors truncate"
                  title={row.name}
                >
                  {row.name}
                </Link>
                <div className={`text-sm font-display tabular-nums ${slot.tint}`}>
                  {fmtValue(slot.key, row.value)}
                  {slot.unit ? <span className="text-[10px] text-muted ml-1">{slot.unit}</span> : null}
                </div>
              </>
            ) : (
              <div className="text-[10px] text-muted italic">—</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
