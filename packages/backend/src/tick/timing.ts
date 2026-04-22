// ============================================================
// TICK TIMING — Round 5: engine atomization
// ------------------------------------------------------------
// Every named phase of the tick flows through `withTiming`. When
// DEBUG_TICK_TIMING=1 is set in the environment, each phase logs its
// duration to stderr the moment it finishes. The phase map is also
// attached to the tick response under `timings_ms` when the flag is on,
// so the frontend / ops can see where the budget is going without
// touching the logs.
// ============================================================

const TIMING_ENABLED = process.env.DEBUG_TICK_TIMING === '1';

export type PhaseTimings = Record<string, number>;

/**
 * Wrap a named phase of the tick. On completion the duration (in ms) is
 * recorded into the supplied `timings` map under `label` and optionally
 * logged to stderr. Behaviour is identical to the unwrapped fn when the
 * debug flag is off — the overhead is a single `performance.now()` pair.
 */
export async function withTiming<T>(
  timings: PhaseTimings,
  label:   string,
  fn:      () => Promise<T> | T,
): Promise<T> {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const ms = performance.now() - start;
    timings[label] = Math.round(ms * 100) / 100;
    if (TIMING_ENABLED) {
      // eslint-disable-next-line no-console
      console.error(`[tick] ${label.padEnd(28)} ${timings[label].toFixed(2)}ms`);
    }
  }
}

export function timingsEnabled(): boolean {
  return TIMING_ENABLED;
}
