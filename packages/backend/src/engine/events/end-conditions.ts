// Phase 8 — End-condition evaluation (DESIGN.md §9.4).
//
// Pure dispatch on EndConditionDescriptor.kind. Returns:
//   'continue'      — event ticks again next year
//   'expired'       — duration ran out (for fixed-duration events)
//   'condition_met' — condition-bound event resolved (plague-clear etc.)
//
// Caller persists the result by archiving the WorldEvent with the matching
// `EventEndReason`.

import type { EndConditionDescriptor } from '@claude-god/shared';

export type EndConditionResult = 'continue' | 'expired' | 'condition_met';

/** Snapshot needed to evaluate condition-bound events. */
export interface EndConditionContext {
  /** Year being ticked (i.e. next year, after age++ has happened). */
  current_year: number;
  /** When the WorldEvent.started_year. */
  started_year: number;
  /** For Plague: fraction of city population currently infected (0..1). */
  infected_pct?: number;
  /** For FactionWar: army_size of the warring faction(s). 0 → resolved. */
  army_size?: number;
  /** For Siege: whether the besieging force still holds (true) or city
   *  was relieved / fell (false) — caller decides which condition fires. */
  siege_unresolved?: boolean;
  /** For GreatCrash: current global market_index. */
  market_index?: number;
}

export function evaluateEndCondition(
  cond: EndConditionDescriptor,
  ctx: EndConditionContext,
): EndConditionResult {
  switch (cond.kind) {
    case 'duration': {
      const elapsed = ctx.current_year - ctx.started_year;
      // started_year=Y, years=N → ends at Y+N (so on year Y+N tick → expired).
      return elapsed >= cond.years ? 'expired' : 'continue';
    }
    case 'plague-clear': {
      if (ctx.infected_pct === undefined) return 'continue';
      return ctx.infected_pct < cond.clear_pct ? 'condition_met' : 'continue';
    }
    case 'war-resolved': {
      if (ctx.army_size !== undefined && ctx.army_size <= 0) {
        return 'condition_met';
      }
      const elapsed = ctx.current_year - ctx.started_year;
      return elapsed >= cond.fallback_years ? 'expired' : 'continue';
    }
    case 'siege-resolved': {
      if (ctx.siege_unresolved === undefined) return 'continue';
      return ctx.siege_unresolved ? 'continue' : 'condition_met';
    }
    case 'crash-recovered': {
      if (ctx.market_index === undefined) return 'continue';
      return ctx.market_index >= cond.threshold ? 'condition_met' : 'continue';
    }
  }
}
