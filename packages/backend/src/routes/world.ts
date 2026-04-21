// ============================================================
// /api/world — Aggregated world state snapshot
// ============================================================

import { Router, Request, Response } from 'express';
import prisma from '../db/client';
import { GLOBAL_TRAITS, DEFAULT_GLOBAL_TRAITS, DEFAULT_GLOBAL_TRAIT_MULTIPLIERS } from '@civ-sim/shared';
import { getActiveWorld } from '../services/time.service';

const router = Router();

function forceCompositeScore(force: string, traits: Record<string, number>): number {
  const def = GLOBAL_TRAITS[force as keyof typeof GLOBAL_TRAITS];
  const children = Object.entries(def.children);
  const total = children.reduce((sum, [child, childDef]) => {
    const val = traits[`${force}.${child}`] ?? 0;
    const norm = (val - childDef.min) / (childDef.max - childDef.min) * 100;
    return sum + norm;
  }, 0);
  return Math.round(total / children.length);
}

// ── GET /api/world ───────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const world = await getActiveWorld();
  const agg   = await prisma.person.aggregate({
    where:  { world_id: world.id },
    _count: { id: true },
    _avg:   { health: true, happiness: true, morality: true, wealth: true },
  });

  const globalTraits = Object.keys((world.global_traits as object) ?? {}).length
    ? world.global_traits as Record<string, number>
    : DEFAULT_GLOBAL_TRAITS;

  const multipliers = Object.keys((world.global_trait_multipliers as object) ?? {}).length
    ? world.global_trait_multipliers as Record<string, number>
    : DEFAULT_GLOBAL_TRAIT_MULTIPLIERS;

  const force_scores: Record<string, number> = {};
  for (const force of Object.keys(GLOBAL_TRAITS)) {
    force_scores[force] = forceCompositeScore(force, globalTraits);
  }

  res.json({
    current_year:             world.current_year,
    tick_count:               world.tick_count,
    total_deaths:             world.total_deaths,
    market_index:             world.market_index,
    market_trend:             world.market_trend,
    market_volatility:        world.market_volatility,
    population:               agg._count.id,
    avg_health:               Math.round(agg._avg.health    ?? 0),
    avg_happiness:            Math.round(agg._avg.happiness ?? 0),
    avg_morality:             Math.round(agg._avg.morality  ?? 0),
    avg_wealth:               Math.round(agg._avg.wealth    ?? 0),
    force_scores,
    global_traits:            globalTraits,
    global_trait_multipliers: multipliers,
  });
});

export default router;
