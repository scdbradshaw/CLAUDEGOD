// ============================================================
// HeadlineGenerator — queues a headline job and polls until done.
// Shared by the Chronicle page (year + decade forms) and the
// Dashboard quick-button. Kicks React Query invalidation on
// completion so Chronicle re-fetches automatically.
// ============================================================

import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type JobRow } from '../api/client';

type Target =
  | { kind: 'year';   value: number }
  | { kind: 'decade'; value: number };  // value = decadeStart (e.g. 1940)

interface Props {
  target:   Target;
  label?:   string;
  compact?: boolean;
}

export default function HeadlineGenerator({ target, label, compact }: Props) {
  const qc = useQueryClient();
  const [job, setJob] = useState<JobRow | null>(null);

  const enqueue = useMutation({
    mutationFn: () =>
      target.kind === 'year'
        ? api.time.generateHeadlines(target.value)
        : api.time.generateDecadeHeadlines(target.value),
    onSuccess: (res) => setJob(res.job),
  });

  // Poll active job until terminal.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const t = setInterval(async () => {
      const latest = await api.time.getJob(job.id);
      setJob(latest);
      if (latest.status === 'done') {
        qc.invalidateQueries({ queryKey: ['headlines'] });
      }
    }, 1500);
    return () => clearInterval(t);
  }, [job?.id, job?.status, qc]);

  const busy = enqueue.isPending || (job && (job.status === 'pending' || job.status === 'running'));

  const displayLabel = label ?? (target.kind === 'year'
    ? `Generate Year ${target.value} headlines`
    : `Generate ${target.value}s decade`);

  return (
    <div className={compact ? '' : 'panel p-3 space-y-2'}>
      <button
        type="button"
        onClick={() => { setJob(null); enqueue.mutate(); }}
        disabled={!!busy}
        className={`btn-sim ${compact ? 'text-[10px] px-2 py-1' : 'text-xs px-3 py-1.5'} disabled:opacity-40`}
      >
        {enqueue.isPending      ? 'Queueing…'
         : job?.status === 'running' ? 'Writing…'
         : job?.status === 'pending' ? 'Waiting…'
         : job?.status === 'done'    ? '✓ Regenerate'
         : job?.status === 'failed'  ? '✗ Retry'
         : '✎ ' + displayLabel}
      </button>

      {job && job.status === 'done' && !compact && (
        <p className="text-[10px] text-emerald-400">
          Chronicle updated. {(job.result as { headline_count?: number })?.headline_count ?? ''} headlines written.
        </p>
      )}
      {job?.status === 'failed' && (
        <p className="text-[10px] text-red-400 break-words">
          {job.error?.split('\n')[0] ?? 'Job failed'}
        </p>
      )}
    </div>
  );
}
