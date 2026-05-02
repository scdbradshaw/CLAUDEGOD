// Modal wrapper around <PersonPicker>. Used inline anywhere a person ID is
// required (group leader, convert/recruit input, etc.).

import { useEffect } from 'react';
import { PersonPicker } from './PersonPicker';
import type { PersonSearchRow } from '../hooks/usePersonSearch';

export interface PersonPickerModalProps {
  worldId: string;
  open: boolean;
  onClose: () => void;
  onSelect: (row: PersonSearchRow) => void;
  selectedId?: string | null;
  title?: string;
  selectLabel?: string;
}

export function PersonPickerModal({
  worldId,
  open,
  onClose,
  onSelect,
  selectedId,
  title = 'Select a person',
  selectLabel = 'Select',
}: PersonPickerModalProps) {
  // Close on Escape, lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-panel-warm border border-border-warm rounded shadow-2xl shadow-black/50 w-full max-w-6xl h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
          <h2 className="font-display text-lg text-gold-bright">{title}</h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-gold-bright text-xl leading-none px-2"
            aria-label="Close"
          >
            ×
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <PersonPicker
            worldId={worldId}
            onSelect={(row) => {
              onSelect(row);
              onClose();
            }}
            selectedId={selectedId ?? null}
            selectLabel={selectLabel}
          />
        </div>
      </div>
    </div>
  );
}
