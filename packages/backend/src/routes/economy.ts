// ============================================================
// /api/economy — Market controls + global trait multipliers
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { DEFAULT_GLOBAL_TRAIT_MULTIPLIERS, DEFAULT_GLOBAL_TRAITS, GLOBAL_TRAITS } from '@civ-sim/shared';
import { getActiveWorld } from '../services/time.service';

const router = Router();

// ── GET /api/economy ─────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const world = await getActiveWorld();
  const multipliers = Object.keys((world.global_trait_multipliers as object) ?? {}).length
    ? world.global_trait_multipliers as Record<string, number>
    : DEFAULT_GLOBAL_TRAIT_MULTIPLIERS;

  const globalTraits = Object.keys((world.global_traits as object) ?? {}).length
    ? world.global_traits as Record<string, number>
    : DEFAULT_GLOBAL_TRAITS;

  // Member counts per market bucket
  const bucketCounts = await prisma.$queryRaw<Array<{ market_bucket: string; cnt: bigint }>>`
    SELECT market_bucket, COUNT(*) AS cnt
    FROM persons
    WHERE world_id = ${world.id}::uuid AND health > 0
    GROUP BY market_bucket
  `;
  const memberCounts: Record<string, number> = {};
  for (const row of bucketCounts) memberCounts[row.market_bucket] = Number(row.cnt);

  res.json({
    // Standard market (index)
    market_index:             world.market_index,
    market_trend:             world.market_trend,
    market_volatility:        world.market_volatility,
    // Stable market
    market_stable_index:      world.market_stable_index,
    market_stable_trend:      world.market_stable_trend,
    market_stable_volatility: world.market_stable_volatility,
    // Volatile market
    market_volatile_index:     world.market_volatile_index,
    market_volatile_trend:     world.market_volatile_trend,
    market_volatile_volatility: world.market_volatile_volatility,
    // History + highlights
    market_history:            world.market_history,
    market_highlights:         world.market_highlights,
    // Live member counts per bucket
    market_member_counts: {
      stable:   memberCounts['stable']   ?? 0,
      standard: memberCounts['standard'] ?? 0,
      volatile: memberCounts['volatile'] ?? 0,
    },
    // World state
    tick_count:               world.tick_count,
    total_deaths:             world.total_deaths,
    current_year:             world.current_year,
    global_trait_multipliers: multipliers,
    global_traits:            globalTraits,
  });
});

// ── POST /api/economy/push ───────────────────────────────────
// Nudges the market trend up or down by 0.5% per push.
// Trend is clamped to [-10%, +20%].
router.post('/push', async (req: Request, res: Response) => {
  const { direction } = req.body as { direction: 'up' | 'down' };
  if (direction !== 'up' && direction !== 'down') {
    res.status(400).json({ error: 'direction must be "up" or "down"' });
    return;
  }

  const world    = await getActiveWorld();
  const delta    = direction === 'up' ? 0.005 : -0.005;
  const newTrend = Math.max(-0.10, Math.min(0.20, world.market_trend + delta));

  const updated = await prisma.world.update({
    where: { id: world.id },
    data:  { market_trend: newTrend },
  });

  res.json({
    market_index:      updated.market_index,
    market_trend:      updated.market_trend,
    market_volatility: updated.market_volatility,
  });
});

// ── PATCH /api/economy/volatility ───────────────────────────
// Sets market volatility directly. Clamped to [0%, 15%].
router.patch('/volatility', async (req: Request, res: Response) => {
  const { volatility } = req.body as { volatility: number };
  if (typeof volatility !== 'number' || volatility < 0 || volatility > 0.15) {
    res.status(400).json({ error: 'volatility must be a number between 0 and 0.15' });
    return;
  }

  const world   = await getActiveWorld();
  const updated = await prisma.world.update({
    where: { id: world.id },
    data:  { market_volatility: volatility },
  });

  res.json({ market_volatility: updated.market_volatility });
});

// ── PATCH /api/economy/multipliers ──────────────────────────
// Sets per-global-trait effect multipliers.
// Body: { multipliers: { war: 1.5, plague: 2.0, ... } }
router.patch('/multipliers', async (req: Request, res: Response) => {
  const { multipliers } = req.body as { multipliers: Record<string, number> };
  if (!multipliers || typeof multipliers !== 'object') {
    res.status(400).json({ error: 'multipliers must be an object' });
    return;
  }

  const VALID_KEYS = ['scarcity', 'war', 'faith', 'plague', 'tyranny', 'discovery'];
  const cleaned: Record<string, number> = {};
  for (const key of VALID_KEYS) {
    if (key in multipliers) {
      const v = multipliers[key];
      if (typeof v !== 'number' || v < 0 || v > 10) {
        res.status(400).json({ error: `${key} multiplier must be between 0 and 10` });
        return;
      }
      cleaned[key] = v;
    }
  }

  const world   = await getActiveWorld();
  const existing = Object.keys((world.global_trait_multipliers as object) ?? {}).length
    ? world.global_trait_multipliers as Record<string, number>
    : { ...DEFAULT_GLOBAL_TRAIT_MULTIPLIERS };

  const merged  = { ...existing, ...cleaned };
  const updated = await prisma.world.update({
    where: { id: world.id },
    data:  { global_trait_multipliers: merged },
  });

  res.json({ global_trait_multipliers: updated.global_trait_multipliers });
});

// ── PATCH /api/economy/global-traits ────────────────────────
// Updates world global trait child values mid-game.
// Body: { global_traits: { "war.morale": 50, ... } }
router.patch('/global-traits', async (req: Request, res: Response) => {
  const { global_traits } = req.body as { global_traits: Record<string, number> };
  if (!global_traits || typeof global_traits !== 'object') {
    res.status(400).json({ error: 'global_traits must be an object' });
    return;
  }

  // Build valid keys from GLOBAL_TRAITS definition
  const VALID_KEYS = new Set<string>();
  for (const [force, def] of Object.entries(GLOBAL_TRAITS)) {
    for (const child of Object.keys(def.children)) {
      VALID_KEYS.add(`${force}.${child}`);
    }
  }

  const cleaned: Record<string, number> = {};
  for (const [key, val] of Object.entries(global_traits)) {
    if (!VALID_KEYS.has(key)) {
      res.status(400).json({ error: `Unknown global trait key: ${key}` });
      return;
    }
    if (typeof val !== 'number') {
      res.status(400).json({ error: `Value for ${key} must be a number` });
      return;
    }
    // Clamp to child's valid range
    const [force, child] = key.split('.');
    const childDef = (GLOBAL_TRAITS as Record<string, { children: Record<string, { min: number; max: number }> }>)[force]?.children[child];
    if (childDef) {
      cleaned[key] = Math.max(childDef.min, Math.min(childDef.max, val));
    }
  }

  const world   = await getActiveWorld();
  const existing = Object.keys((world.global_traits as object) ?? {}).length
    ? world.global_traits as Record<string, number>
    : { ...DEFAULT_GLOBAL_TRAITS };

  const merged  = { ...existing, ...cleaned };
  const updated = await prisma.world.update({
    where: { id: world.id },
    data:  { global_traits: merged },
  });

  res.json({ global_traits: updated.global_traits });
});

export default router;
