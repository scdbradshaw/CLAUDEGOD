// ============================================================
// AgeHistogram — vertical bar chart of the 6 age buckets.
// Heights are proportional to the tallest bucket. Each bar shows
// its count on hover (title) and the label below.
// ============================================================

import type { AgeBucket } from '../api/client';

interface Props {
  buckets: AgeBucket[];
}

export default function AgeHistogram({ buckets }: Props) {
  const maxCount = Math.max(1, ...buckets.map(b => b.count));

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1.5 h-28">
        {buckets.map(b => {
          const pct = (b.count / maxCount) * 100;
          return (
            <div
              key={b.label}
              className="flex-1 flex flex-col justify-end"
              title={`${b.label}: ${b.count}`}
            >
              <div
                className="bg-gradient-to-t from-amber-700/70 to-amber-400/90 rounded-t-sm transition-all"
                style={{ height: `${pct}%`, minHeight: b.count > 0 ? '3px' : '0' }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {buckets.map(b => (
          <div key={b.label} className="flex-1 text-center">
            <div className="text-[9px] text-muted tracking-wider">{b.label}</div>
            <div className="text-[10px] text-gray-200 tabular-nums font-medium">{b.count.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
