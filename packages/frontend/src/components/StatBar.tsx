// ============================================================
// StatBar — renders one 0-100 stat with color-coded fill
// ============================================================

interface Props {
  label: string;
  value: number;
  max?:  number;    // defaults to 100
  /** Show the numeric value next to the bar */
  showValue?: boolean;
}

/** Returns a Tailwind bg color class based on the 0-100 value */
export function statColor(value: number, max = 100): string {
  const pct = (value / max) * 100;
  if (pct >= 67) return 'bg-emerald-500';
  if (pct >= 34) return 'bg-amber-400';
  return 'bg-red-500';
}

/** Returns a text color class */
export function statTextColor(value: number, max = 100): string {
  const pct = (value / max) * 100;
  if (pct >= 67) return 'text-emerald-400';
  if (pct >= 34) return 'text-amber-300';
  return 'text-red-400';
}

export default function StatBar({ label, value, max = 100, showValue = true }: Props) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const fill = statColor(value, max);
  const textColor = statTextColor(value, max);

  return (
    <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
      <span className="text-[10px] text-muted uppercase tracking-widest truncate">
        {label}
      </span>

      <div className="stat-bar-track">
        <div
          className={`h-full rounded-full transition-all duration-500 ${fill}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {showValue && (
        <span className={`text-[11px] font-medium w-7 text-right tabular-nums ${textColor}`}>
          {value}
        </span>
      )}
    </div>
  );
}
