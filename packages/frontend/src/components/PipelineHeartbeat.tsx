// ============================================================
// PipelineHeartbeat — sticky top bar showing year-pipeline phase
// + progress while a year is being advanced. Hidden when idle.
// Sits ABOVE the NavBar; the layout pushes nav down when active.
// ============================================================

import { usePipeline } from './PipelineProvider';
import type { YearRunPhase } from '../api/client';

const PHASE_LABEL: Record<YearRunPhase, string> = {
  bi_annual_a: 'Bi-Annual A · interactions, events, births',
  bi_annual_b: 'Bi-Annual B · interactions, events, births',
  year_end:    'Year-End · aging, conversions, decay',
  completed:   'Year complete',
  failed:      'Pipeline failed',
};

export default function PipelineHeartbeat() {
  const { running, status, year, phase, progressPct, message } = usePipeline();

  // Show during a run AND briefly after completion so the user sees the result.
  const visible = running || status === 'completed' || status === 'failed';
  if (!visible) return null;

  const failed   = status === 'failed';
  const finished = status === 'completed';

  const tone = failed
    ? 'border-red-500/60 bg-red-950/70 text-red-200'
    : finished
    ? 'border-emerald-500/50 bg-emerald-950/60 text-emerald-200'
    : 'border-gold/40 bg-panel/95 text-gold';

  const barColor = failed
    ? 'bg-red-500'
    : finished
    ? 'bg-emerald-500'
    : 'bg-gold';

  return (
    <div className={`fixed top-0 left-0 right-0 z-[60] border-b backdrop-blur-sm ${tone}`}>
      <div className="h-7 px-3 flex items-center justify-between gap-3 text-[11px] tracking-wide">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-1.5 h-1.5 rounded-full ${barColor} ${running ? 'animate-pulse' : ''}`} />
          <span className="font-display uppercase opacity-70">
            {year != null ? `Year ${year}` : 'Year pipeline'}
          </span>
          <span className="opacity-50">·</span>
          <span className="truncate">
            {phase ? PHASE_LABEL[phase] : 'Queuing…'}
          </span>
          {message && (
            <span className="opacity-60 truncate hidden sm:inline">— {message}</span>
          )}
        </div>
        <span className="tabular-nums shrink-0 opacity-80">{progressPct}%</span>
      </div>
      {/* Progress sliver */}
      <div className="h-0.5 bg-black/40 overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-300`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}
