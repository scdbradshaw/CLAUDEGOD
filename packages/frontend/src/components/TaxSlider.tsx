// Tax-rate slider. Persists to backend on `pointerup` (drag-release) only,
// per Sam's 11d direction — not on every drag tick.

import { useEffect, useState } from 'react';
import { useUpdateTaxRate } from '../hooks/useCity';

interface Props {
  cityId: string;
  initialValue: number;
}

export function TaxSlider({ cityId, initialValue }: Props) {
  const [value, setValue] = useState(initialValue);
  const update = useUpdateTaxRate(cityId);

  // If the source-of-truth changes (e.g. year advance), pull it back in.
  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const commit = () => {
    if (value !== initialValue) update.mutate(value);
  };

  return (
    <div className="border border-border-warm rounded bg-panel-warm p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-muted text-[10px] uppercase tracking-wider">
          Tax rate
        </span>
        <span className="font-display text-2xl text-gold-bright tabular-nums">
          {value}%
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={50}
        step={1}
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={(e) => {
          // Commit on key release for keyboard users.
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) {
            commit();
          }
        }}
        className="w-full"
        disabled={update.isPending}
      />
      <div className="flex justify-between text-[10px] text-muted mt-1">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
      </div>
      {update.error && (
        <div className="text-blood text-xs mt-2">{update.error.message}</div>
      )}
    </div>
  );
}
