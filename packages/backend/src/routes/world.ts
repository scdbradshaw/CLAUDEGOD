// ============================================================
// /api/world — Aggregated world state snapshot
// Phase 6: reads exclusively from world_snapshots (denormalized
// view written at every pipeline phase). No live aggregation.
// Falls back to a minimal computed payload if no snapshot exists
// yet (fresh world, before the first Advance).
//
// Response shape includes both the new structured snapshot and
// flat legacy fields (market_index, avg_health, …) so existing
// pages keep rendering during the transition.
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { getActiveWorld } from '../services/time.service';

const router = Router();

interface SnapshotPayload {
  year:               number;
  bi_annual_index:    number;
  population:         number;
  total_deaths:       number;
  recent_deaths_year: { year: number; total: number; by_cause: Record<string, number> };
  averages:           { health: number; happiness: number; money: number };
  markets: {
    stable:   { index: number; trend: number };
    standard: { index: number; trend: number };
    volatile: { index: number; trend: number };
  };
  religions:     unknown;
  factions:      unknown;
  active_events: unknown;
  updated_at:    string;
}

// Spread the structured snapshot into the legacy flat shape some
// pages still consume (avg_health/avg_money/market_index/…).
function withLegacyFlatFields(payload: SnapshotPayload) {
  return {
    ...payload,
    avg_health:             payload.averages.health,
    avg_happiness:          payload.averages.happiness,
    avg_money:              payload.averages.money,
    market_index:           payload.markets.standard.index,
    market_trend:           payload.markets.standard.trend,
    market_stable_index:    payload.markets.stable.index,
    market_stable_trend:    payload.markets.stable.trend,
    market_volatile_index:  payload.markets.volatile.index,
    market_volatile_trend:  payload.markets.volatile.trend,
  };
}

// ── GET /api/world ───────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const world = await getActiveWorld();

  const snapshot = await prisma.worldSnapshot.findUnique({
    where: { world_id: world.id },
  });

  if (snapshot) {
    const payload = snapshot.payload as unknown as SnapshotPayload;
    res.json({
      ...withLegacyFlatFields(payload),
      // World-level fields refresh on every read so the UI sees current_year
      // updates immediately (snapshot.payload.year is set at phase-write time).
      current_year: world.current_year,
      year_count:   world.year_count,
      snapshot_at:  snapshot.updated_at,
    });
    return;
  }

  // ── Bootstrap fallback (no snapshot yet) ────────────────────
  // Used on a freshly-created world before the first Advance.
  const fallback: SnapshotPayload = {
    year:               world.current_year,
    bi_annual_index:    world.bi_annual_index,
    population:         await prisma.person.count({ where: { world_id: world.id, current_health: { gt: 0 } } }),
    total_deaths:       world.total_deaths,
    recent_deaths_year: { year: world.current_year, total: 0, by_cause: {} },
    averages:           { health: 0, happiness: 0, money: 0 },
    markets: {
      stable:   { index: world.market_stable_index,   trend: world.market_stable_trend   },
      standard: { index: world.market_index,           trend: world.market_trend           },
      volatile: { index: world.market_volatile_index,  trend: world.market_volatile_trend  },
    },
    religions:     { top_by_count: [], top_by_balance: [], richest_leader: null },
    factions:      { top_by_count: [], top_by_balance: [], richest_leader: null },
    active_events: [],
    updated_at:    new Date().toISOString(),
  };

  res.json({
    ...withLegacyFlatFields(fallback),
    current_year: world.current_year,
    year_count:   world.year_count,
    snapshot_at:  null,
  });
});

export default router;
