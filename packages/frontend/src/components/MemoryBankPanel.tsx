// ============================================================
// MemoryBankPanel — scrollable list of memory entries
// ============================================================

import type { MemoryEntry, EmotionalImpact } from '@civ-sim/shared';

const impactStyle: Record<EmotionalImpact, string> = {
  traumatic: 'bg-red-950 border-red-700   text-red-400',
  negative:  'bg-orange-950 border-orange-700 text-orange-400',
  neutral:   'bg-gray-900  border-border   text-muted',
  positive:  'bg-emerald-950 border-emerald-700 text-emerald-400',
  euphoric:  'bg-amber-950 border-amber-600 text-amber-300',
};

interface Props {
  entries: MemoryEntry[];
}

export default function MemoryBankPanel({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <p className="text-muted text-xs italic p-4">No memory entries yet.</p>
    );
  }

  return (
    <ol className="space-y-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className={`panel border px-3 py-2 text-xs ${impactStyle[entry.emotional_impact]}`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="tag uppercase">{entry.emotional_impact}</span>
            <time className="text-[10px] text-muted">
              {new Date(entry.timestamp).toLocaleString()}
            </time>
          </div>

          <p className="text-gray-200 leading-snug mb-1">{entry.event_summary}</p>

          {/* Delta snapshot */}
          {Object.keys(entry.delta_applied).length > 0 && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-muted hover:text-gray-300">
                delta
              </summary>
              <pre className="mt-1 text-[10px] text-muted overflow-x-auto">
                {JSON.stringify(entry.delta_applied, null, 2)}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}
