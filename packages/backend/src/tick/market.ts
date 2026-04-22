// ============================================================
// TICK PHASE — market engine (three-market system)
// ------------------------------------------------------------
// Three abstract markets, each with its own risk profile:
//   stable   — bonds-like: low volatility, steady long-term upside
//   standard — index-like: moderate volatility, decent upside
//   volatile — speculative: huge swings, high expected return
//
// Every tick:
//   1. Compute a random return per market (trend + noise + mean-reversion).
//   2. Apply flat 20k income to all living persons; 20% (4k) is treated
//      as invested in their market bucket and earns/loses accordingly.
//      Net wealth change = 16000 + 4000*(1+R) = 20000 + 4000*R
//   3. Detect extreme events (crash/boom/bubble/depression) per market.
//   4. Return per-market results + highlights for the tick response.
//
// NOTE: the base income of 20,000 per tick is a placeholder — will be
// replaced with a more nuanced income model in a future round.
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

// Income / investment constants (placeholder — will be refined later)
const BASE_INCOME    = 20_000;
const INVEST_RATE    = 0.20;
const INVEST_AMOUNT  = BASE_INCOME * INVEST_RATE; // 4000 per tick

// ── Types ────────────────────────────────────────────────────

export type MarketEventKind = 'crash' | 'boom' | 'bubble' | 'depression';

export interface MarketEvent {
  kind:        MarketEventKind;
  return_pct:  number;   // tick's return, rounded to 0.1
  market_idx:  number;   // post-update index, rounded to 0.01
  description: string;   // reportage-voice one-liner
  market:      'stable' | 'standard' | 'volatile';
}

export interface MarketBucketResult {
  newIndex:    number;
  marketReturn: number;
  event:       MarketEvent | null;
}

export interface MarketHighlights {
  stable: {
    return_pct:      number;
    gain_per_person: number;  // 4000 * R, can be negative
    member_count:    number;
  };
  standard: {
    return_pct:      number;
    gain_per_person: number;
    member_count:    number;
  };
  volatile: {
    return_pct:      number;
    gain_per_person: number;
    member_count:    number;
  };
  top_gainer: { name: string; market: string; gain: number } | null;
  top_loser:  { name: string; market: string; gain: number } | null;
}

export interface MarketHistoryEntry {
  tick:     number;
  stable:   number;
  standard: number;
  volatile: number;
}

export interface UpdateThreeMarketsInput {
  prisma:            PrismaClient;
  worldId:           string;
  tickCount:         number;
  // Stable market params
  stableIndex:       number;
  stableTrend:       number;
  stableVolatility:  number;
  // Standard market params (old market_index)
  standardIndex:     number;
  standardTrend:     number;
  standardVolatility: number;
  // Volatile market params
  volatileIndex:     number;
  volatileTrend:     number;
  volatileVolatility: number;
  // Existing market history (to append to)
  marketHistory:     MarketHistoryEntry[];
}

export interface UpdateThreeMarketsOutput {
  stable:   MarketBucketResult;
  standard: MarketBucketResult;
  volatile: MarketBucketResult;
  highlights: MarketHighlights;
  marketHistory: MarketHistoryEntry[];
  /** Most severe event across all three markets, or null */
  topEvent: MarketEvent | null;
}

// ── Core math helpers ────────────────────────────────────────

function computeSingleMarket(
  index:      number,
  trend:      number,
  volatility: number,
): { newIndex: number; marketReturn: number } {
  const noise             = randFloat(-volatility, volatility);
  const meanReversionPull = (1.0 - index) * MARKET_MEAN_REVERSION;
  const marketReturn      = trend + noise + meanReversionPull;
  const raw               = index * (1 + marketReturn);
  const newIndex          = Math.min(MARKET_CEILING, Math.max(MARKET_FLOOR, raw));
  return { newIndex, marketReturn };
}

function round1(n: number): number {
  return Math.round(n * 1000) / 10;
}

// ── Three-market update (main export) ───────────────────────

export async function updateThreeMarkets(
  input: UpdateThreeMarketsInput,
): Promise<UpdateThreeMarketsOutput> {
  const { prisma, worldId, tickCount } = input;

  // 1. Compute returns for all three markets
  const stable   = computeSingleMarket(input.stableIndex,   input.stableTrend,   input.stableVolatility);
  const standard = computeSingleMarket(input.standardIndex, input.standardTrend, input.standardVolatility);
  const volatile_ = computeSingleMarket(input.volatileIndex, input.volatileTrend, input.volatileVolatility);

  const sR  = stable.marketReturn;
  const stR = standard.marketReturn;
  const vR  = volatile_.marketReturn;

  // 2. Apply income + investment in one SQL pass.
  //    Net change = 16000 (wages) + 4000*(1+R) (invested capital + return)
  //               = 20000 + 4000*R
  await prisma.$executeRaw`
    UPDATE persons SET
      wealth = wealth
               + ${BASE_INCOME}::float
               + ${INVEST_AMOUNT}::float * CASE market_bucket
                   WHEN 'stable'   THEN ${sR}::float
                   WHEN 'volatile' THEN ${vR}::float
                   ELSE                 ${stR}::float
                 END,
      updated_at = NOW()
    WHERE world_id = ${worldId}::uuid AND health > 0
  `;

  // 3. Count members + pull one sample name per bucket (for highlights)
  type BucketRow = { market_bucket: string; cnt: bigint; sample_name: string | null };
  const bucketRows = await prisma.$queryRaw<BucketRow[]>`
    SELECT
      market_bucket,
      COUNT(*)                                                  AS cnt,
      (array_agg(name ORDER BY random()))[1]                   AS sample_name
    FROM persons
    WHERE world_id = ${worldId}::uuid AND health > 0
    GROUP BY market_bucket
  `;

  const counts: Record<string, number>      = {};
  const samples: Record<string, string>     = {};
  for (const row of bucketRows) {
    counts[row.market_bucket]  = Number(row.cnt);
    samples[row.market_bucket] = row.sample_name ?? '—';
  }

  // 4. Build per-bucket highlight data
  const buckets = [
    { key: 'stable',   R: sR  },
    { key: 'standard', R: stR },
    { key: 'volatile', R: vR  },
  ] as const;

  const gainPerPerson = (R: number) => Math.round(INVEST_AMOUNT * R);

  const best  = buckets.reduce((a, b) => b.R > a.R ? b : a);
  const worst = buckets.reduce((a, b) => b.R < a.R ? b : a);

  const highlights: MarketHighlights = {
    stable: {
      return_pct:      round1(sR),
      gain_per_person: gainPerPerson(sR),
      member_count:    counts['stable'] ?? 0,
    },
    standard: {
      return_pct:      round1(stR),
      gain_per_person: gainPerPerson(stR),
      member_count:    counts['standard'] ?? 0,
    },
    volatile: {
      return_pct:      round1(vR),
      gain_per_person: gainPerPerson(vR),
      member_count:    counts['volatile'] ?? 0,
    },
    top_gainer:
      best.R > 0
        ? { name: samples[best.key] ?? '—', market: best.key, gain: gainPerPerson(best.R) }
        : null,
    top_loser:
      worst.R < 0
        ? { name: samples[worst.key] ?? '—', market: worst.key, gain: gainPerPerson(worst.R) }
        : null,
  };

  // 5. Update market history (keep last 100 ticks)
  const newEntry: MarketHistoryEntry = {
    tick:     tickCount,
    stable:   Math.round(stable.newIndex   * 100) / 100,
    standard: Math.round(standard.newIndex * 100) / 100,
    volatile: Math.round(volatile_.newIndex * 100) / 100,
  };
  const marketHistory = [...input.marketHistory, newEntry].slice(-100);

  // 6. Detect events per market
  const stableEvent   = detectMarketEvent(sR,  stable.newIndex,   'stable');
  const standardEvent = detectMarketEvent(stR, standard.newIndex, 'standard');
  const volatileEvent = detectMarketEvent(vR,  volatile_.newIndex, 'volatile');

  // Pick most severe event to surface as the top-level tick event
  const events = [stableEvent, standardEvent, volatileEvent].filter(Boolean) as MarketEvent[];
  const severity: Record<MarketEventKind, number> = { crash: 4, boom: 3, depression: 2, bubble: 1 };
  const topEvent = events.length
    ? events.reduce((a, b) => (severity[b.kind] ?? 0) > (severity[a.kind] ?? 0) ? b : a)
    : null;

  return {
    stable:   { newIndex: stable.newIndex,    marketReturn: sR,  event: stableEvent   },
    standard: { newIndex: standard.newIndex,  marketReturn: stR, event: standardEvent },
    volatile: { newIndex: volatile_.newIndex, marketReturn: vR,  event: volatileEvent },
    highlights,
    marketHistory,
    topEvent,
  };
}

// ── Event detection ──────────────────────────────────────────

/**
 * Classify this tick's market movement. Priority is crash/boom (return-
 * based) over bubble/depression (level-based), so a recovering crash
 * doesn't also fire a depression headline on the same tick.
 */
export function detectMarketEvent(
  marketReturn: number,
  marketIdx:    number,
  market:       'stable' | 'standard' | 'volatile' = 'standard',
): MarketEvent | null {
  const return_pct = Math.round(marketReturn * 1000) / 10;
  const market_idx = Math.round(marketIdx * 100) / 100;
  const label = market.charAt(0).toUpperCase() + market.slice(1);

  if (marketReturn <= MARKET_CRASH_RETURN) {
    return {
      kind: 'crash', return_pct, market_idx, market,
      description: `${label} market crashed ${Math.abs(return_pct).toFixed(1)}% — fortunes vanish overnight.`,
    };
  }
  if (marketReturn >= MARKET_BOOM_RETURN) {
    return {
      kind: 'boom', return_pct, market_idx, market,
      description: `${label} market surged ${return_pct.toFixed(1)}% — fortunes multiplied in a single season.`,
    };
  }
  if (marketIdx >= MARKET_BUBBLE_INDEX) {
    return {
      kind: 'bubble', return_pct, market_idx, market,
      description: `${label} market index at ${market_idx.toFixed(2)} — the air thins at these altitudes.`,
    };
  }
  if (marketIdx <= MARKET_DEPRESSION_INDEX) {
    return {
      kind: 'depression', return_pct, market_idx, market,
      description: `${label} market index at ${market_idx.toFixed(2)} — a long grey winter on the ledgers.`,
    };
  }
  return null;
}

// ── Legacy single-market function (kept for existing tests) ─

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
 * @deprecated Use updateThreeMarkets instead.
 * Kept so the existing unit tests continue to pass.
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

  const marketEvent = detectMarketEvent(marketReturn, newMarketIdx, 'standard');

  return { newMarketIdx, marketReturn, marketEvent };
}
