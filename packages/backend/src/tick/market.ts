// ============================================================
// TICK PHASE — update market (Round 8)
// ------------------------------------------------------------
// Combines the drift/mean-reversion math, trait-weighted wealth update,
// and market-event detection (crash / boom / bubble) into a single
// phase. Returns a structured MarketEvent so the route handler can
// surface it to the client without duplicating the threshold logic.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import { randFloat } from './scoring';

// ── Tunables ────────────────────────────────────────────────
export const MARKET_CEILING        = 10.0;
export const MARKET_FLOOR          = 0.1;
/** Fraction of the distance from current index back to 1.0 per tick. */
export const MARKET_MEAN_REVERSION = 0.005;
/** Annualised return threshold that triggers a crash headline. */
export const MARKET_CRASH_RETURN   = -0.08;
/** Annualised return threshold that triggers a boom headline. */
export const MARKET_BOOM_RETURN    =  0.08;
/** Market index above this constitutes a bubble regardless of this tick's return. */
export const MARKET_BUBBLE_INDEX   =  1.6;
/** Market index below this is a depression floor; persists until reversion pulls it up. */
export const MARKET_DEPRESSION_INDEX = 0.5;

export type MarketEventKind = 'crash' | 'boom' | 'bubble' | 'depression';

export interface MarketEvent {
  kind:        MarketEventKind;
  return_pct:  number;   // ← the tick's return, rounded to 0.1
  market_idx:  number;   // ← post-update index, rounded to 0.01
  description: string;   // reportage-voice one-liner
}

export interface UpdateMarketInput {
  prisma:            PrismaClient;
  worldId:           string;
  marketIndex:       number;
  marketTrend:       number;
  marketVolatility:  number;
}

export interface UpdateMarketOutput {
  newMarketIdx: number;
  marketReturn: number;
  marketEvent:  MarketEvent | null;
}

/**
 * Run the market math, apply trait-weighted wealth drift, and detect any
 * extreme event. Wealth update is weighted by `craftsmanship` and `cunning`
 * so skilled/shrewd characters capture more upside — and carry more
 * downside — than the average participant. Sensitivity range is [0.5, 1.5]
 * around the mean, giving ~3x spread between least and most exposed.
 */
export async function updateMarketPhase(
  input: UpdateMarketInput,
): Promise<UpdateMarketOutput> {
  const { prisma, worldId, marketIndex, marketTrend, marketVolatility } = input;

  const noise             = randFloat(-marketVolatility, marketVolatility);
  const meanReversionPull = (1.0 - marketIndex) * MARKET_MEAN_REVERSION;
  const marketReturn      = marketTrend + noise + meanReversionPull;
  const rawMarketIdx      = marketIndex * (1 + marketReturn);
  const newMarketIdx      = Math.min(MARKET_CEILING, Math.max(MARKET_FLOOR, rawMarketIdx));

  // Trait-weighted wealth drift.
  //   sensitivity = 0.5 + craftsmanship/200 + cunning/200
  //   range: 0.5 (both 0) → 1.5 (both 100); baseline 1.0 at trait=50.
  // Applied multiplicatively so a -5% return hits a shrewd merchant ~3x
  // harder than a sheltered one, and the same for upside.
  if (Math.abs(marketReturn) > 0.0005) {
    await prisma.$executeRaw`
      UPDATE persons SET
        wealth = wealth * (1 + ${marketReturn} * (
          0.5
          + COALESCE((traits->>'craftsmanship')::float, 50) / 200.0
          + COALESCE((traits->>'cunning')::float,       50) / 200.0
        )),
        updated_at = NOW()
      WHERE world_id = ${worldId}::uuid AND health > 0 AND wealth > 0
    `;
  }

  const marketEvent = detectMarketEvent(marketReturn, newMarketIdx);

  return { newMarketIdx, marketReturn, marketEvent };
}

/**
 * Classify this tick's market movement. Priority is crash/boom (return-
 * based) over bubble/depression (level-based), so a recovering crash
 * doesn't also fire a depression headline on the same tick.
 */
export function detectMarketEvent(
  marketReturn: number,
  marketIdx:    number,
): MarketEvent | null {
  const return_pct = Math.round(marketReturn * 1000) / 10;
  const market_idx = Math.round(marketIdx * 100) / 100;

  if (marketReturn <= MARKET_CRASH_RETURN) {
    return {
      kind: 'crash',
      return_pct,
      market_idx,
      description: `Markets crashed ${Math.abs(return_pct).toFixed(1)}% — fortunes vanish overnight.`,
    };
  }
  if (marketReturn >= MARKET_BOOM_RETURN) {
    return {
      kind: 'boom',
      return_pct,
      market_idx,
      description: `Markets surged ${return_pct.toFixed(1)}% — fortunes multiplied in a single season.`,
    };
  }
  if (marketIdx >= MARKET_BUBBLE_INDEX) {
    return {
      kind: 'bubble',
      return_pct,
      market_idx,
      description: `Market index at ${market_idx.toFixed(2)} — the air thins at these altitudes.`,
    };
  }
  if (marketIdx <= MARKET_DEPRESSION_INDEX) {
    return {
      kind: 'depression',
      return_pct,
      market_idx,
      description: `Market index at ${market_idx.toFixed(2)} — a long grey winter on the ledgers.`,
    };
  }
  return null;
}
