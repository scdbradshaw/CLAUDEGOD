// Action-queue editor (Phase 11e).
// Backend rejects enqueue for non-pinned persons; we mirror that gating in UI.

import { useState } from 'react';
import {
  AGENTIC_ACTION_TYPES,
  type AgenticActionType,
} from '@claude-god/shared';
import {
  useEnqueueAction,
  useDequeueAction,
  type PersonRow,
} from '../hooks/usePerson';

interface Props {
  person: PersonRow;
  currentYear: number;
}

export function QueueEditor({ person, currentYear }: Props) {
  const [actionType, setActionType] = useState<AgenticActionType>('marry');
  const [targetId, setTargetId] = useState('');
  const [scheduledYear, setScheduledYear] = useState(currentYear + 1);

  const enqueue = useEnqueueAction(person.id);
  const dequeue = useDequeueAction(person.id);

  const queue = person.action_queue ?? [];
  const canEdit = person.is_pinned && person.is_alive;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    enqueue.mutate(
      {
        action_type: actionType,
        target_id: targetId.trim() || undefined,
        scheduled_year: scheduledYear,
      },
      {
        onSuccess: () => {
          setTargetId('');
          setScheduledYear(scheduledYear + 1);
        },
      },
    );
  };

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">Action queue</h2>
        {!canEdit && (
          <span className="text-muted text-xs italic">
            Pin this person to enqueue actions.
          </span>
        )}
      </header>

      {queue.length === 0 ? (
        <div className="px-4 py-3 text-muted text-sm italic">No queued actions.</div>
      ) : (
        <ul className="divide-y divide-border-warm">
          {queue.map((q) => (
            <li
              key={q.scheduled_year}
              className="px-4 py-2 flex items-center gap-3 text-sm"
            >
              <span className="text-muted text-xs tabular-nums w-12">yr {q.scheduled_year}</span>
              <span className="font-display text-gold-bright">{q.action_type}</span>
              {q.target_id && (
                <span className="text-muted font-mono text-xs truncate">
                  → {q.target_id.slice(0, 8)}
                </span>
              )}
              <span className="flex-1" />
              {canEdit && (
                <button
                  className="text-muted hover:text-blood text-xs"
                  onClick={() => dequeue.mutate(q.scheduled_year)}
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          onSubmit={submit}
          className="px-4 py-3 border-t border-border-warm grid grid-cols-1 md:grid-cols-[1fr_2fr_auto_auto] gap-2 items-end"
        >
          <Field label="Action">
            <select
              className="w-full bg-surface border border-border-warm rounded px-2 py-1.5 text-sm"
              value={actionType}
              onChange={(e) => setActionType(e.target.value as AgenticActionType)}
            >
              {AGENTIC_ACTION_TYPES.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target id (optional)">
            <input
              className="w-full bg-surface border border-border-warm rounded px-2 py-1.5 text-sm font-mono"
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              placeholder="uuid"
            />
          </Field>
          <Field label="Year">
            <input
              type="number"
              min={currentYear}
              className="w-24 bg-surface border border-border-warm rounded px-2 py-1.5 text-sm tabular-nums"
              value={scheduledYear}
              onChange={(e) => setScheduledYear(Number(e.target.value))}
            />
          </Field>
          <button
            type="submit"
            disabled={enqueue.isPending}
            className="bg-emerald-700 hover:bg-emerald-600 text-white px-4 py-1.5 rounded font-display tracking-wider text-sm disabled:opacity-50"
          >
            {enqueue.isPending ? '…' : 'Add'}
          </button>
          {enqueue.error && (
            <div className="md:col-span-4 text-blood text-xs">{enqueue.error.message}</div>
          )}
        </form>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-muted text-[10px] uppercase tracking-wider mb-1">
        {label}
      </span>
      {children}
    </label>
  );
}
