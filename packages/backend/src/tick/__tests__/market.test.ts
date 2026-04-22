// ============================================================
// Unit tests — tick/market.ts
// ------------------------------------------------------------
// Covers detectMarketEvent's priority rules (crash/boom beat
// bubble/depression) and its numeric rounding. The updateMarketPhase
// helper depends on Prisma + Math.random; we don't re-test the math
// here but do verify that the wealth-drift SQL skip gate fires when
// the return is near zero.
// ============================================================

import { describe, it, expect, vi } from 'vitest';
import {
  detectMarketEvent,
  updateMarketPhase,
  MARKET_BOOM_RETURN,
  MARKET_BUBBLE_INDEX,
  MARKET_CEILING,
  MARKET_CRASH_RETURN,
  MARKET_DEPRESSION_INDEX,
  MARKET_FLOOR,
  MARKET_MEAN_REVERSION,
} from '../market';

describe('detectMarketEvent', () => {
  it('fires a crash exactly at MARKET_CRASH_RETURN', () => {
    const ev = detectMarketEvent(MARKET_CRASH_RETURN, 0.9);
    expect(ev?.kind).toBe('crash');
    expect(ev?.description).toMatch(/crash/i);
  });

  it('fires a crash for anything worse than the threshold', () => {
    const ev = detectMarketEvent(-0.2, 0.9);
    expect(ev?.kind).toBe('crash');
    // return_pct is rounded to 0.1 and absolute-valued in description
    expect(ev?.description).toContain('20.0%');
  });

  it('fires a boom exactly at MARKET_BOOM_RETURN', () => {
    const ev = detectMarketEvent(MARKET_BOOM_RETURN, 1.1);
    expect(ev?.kind).toBe('boom');
    expect(ev?.description).toMatch(/surged/i);
  });

  it('fires a bubble when level >= MARKET_BUBBLE_INDEX with calm return', () => {
    const ev = detectMarketEvent(0.01, MARKET_BUBBLE_INDEX);
    expect(ev?.kind).toBe('bubble');
  });

  it('fires a depression when level <= MARKET_DEPRESSION_INDEX with calm return', () => {
    const ev = detectMarketEvent(-0.01, MARKET_DEPRESSION_INDEX);
    expect(ev?.kind).toBe('depression');
  });

  it('prioritises crash over depression on a plunging market', () => {
    // index already at depression floor, tick drops -10%
    const ev = detectMarketEvent(-0.1, 0.4);
    expect(ev?.kind).toBe('crash');
  });

  it('prioritises boom over bubble on a blow-off top', () => {
    const ev = detectMarketEvent(0.12, 1.8);
    expect(ev?.kind).toBe('boom');
  });

  it('returns null for garden-variety ticks', () => {
    expect(detectMarketEvent(0.01, 1.0)).toBeNull();
    expect(detectMarketEvent(-0.02, 0.9)).toBeNull();
    expect(detectMarketEvent(0.05, 1.2)).toBeNull();
  });

  it('rounds return_pct to a single decimal', () => {
    const ev = detectMarketEvent(-0.08765, 0.9);
    expect(ev?.return_pct).toBe(-8.8);
  });

  it('rounds market_idx to two decimals', () => {
    const ev = detectMarketEvent(0.2, 1.6789);
    expect(ev?.market_idx).toBe(1.68);
  });
});

// ── tunable sanity ──────────────────────────────────────────
describe('market tunables', () => {
  it('CEILING is above FLOOR', () => {
    expect(MARKET_CEILING).toBeGreaterThan(MARKET_FLOOR);
  });

  it('crash threshold is negative, boom is positive, symmetric', () => {
    expect(MARKET_CRASH_RETURN).toBeLessThan(0);
    expect(MARKET_BOOM_RETURN).toBeGreaterThan(0);
    expect(Math.abs(MARKET_CRASH_RETURN)).toBeCloseTo(MARKET_BOOM_RETURN, 10);
  });

  it('mean reversion is a small non-zero fraction', () => {
    expect(MARKET_MEAN_REVERSION).toBeGreaterThan(0);
    expect(MARKET_MEAN_REVERSION).toBeLessThan(0.1);
  });

  it('depression floor is below bubble ceiling', () => {
    expect(MARKET_DEPRESSION_INDEX).toBeLessThan(MARKET_BUBBLE_INDEX);
  });
});

// ── updateMarketPhase integration-ish ───────────────────────
describe('updateMarketPhase', () => {
  const makePrisma = () =>
    ({
      $executeRaw: vi.fn().mockResolvedValue(1),
    }) as unknown as import('@prisma/client').PrismaClient;

  it('skips the wealth-drift SQL when the return is negligible', async () => {
    // Force randFloat to 0 and volatility 0 so return ≈ meanReversionPull ≈ 0.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const prisma = makePrisma();
    await updateMarketPhase({
      prisma,
      worldId: 'w1',
      marketIndex: 1.0,    // pull = 0
      marketTrend: 0,
      marketVolatility: 0, // noise = 0
    });
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('runs the wealth-drift SQL when the tick return is material', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5); // noise = 0 given vol
    const prisma = makePrisma();
    await updateMarketPhase({
      prisma,
      worldId: 'w1',
      marketIndex: 1.0,
      marketTrend: 0.02, // above the 0.0005 gate
      marketVolatility: 0,
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });

  it('clamps to MARKET_CEILING and MARKET_FLOOR', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const prisma = makePrisma();

    // Huge positive return should clamp to ceiling.
    const up = await updateMarketPhase({
      prisma,
      worldId: 'w1',
      marketIndex: 9.5,
      marketTrend: 1.0,
      marketVolatility: 0,
    });
    expect(up.newMarketIdx).toBe(MARKET_CEILING);

    // Huge negative return should clamp to floor.
    const down = await updateMarketPhase({
      prisma,
      worldId: 'w1',
      marketIndex: 0.2,
      marketTrend: -1.0,
      marketVolatility: 0,
    });
    expect(down.newMarketIdx).toBe(MARKET_FLOOR);

    vi.restoreAllMocks();
  });

  it('detects a crash event on a large drop', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const prisma = makePrisma();
    const out = await updateMarketPhase({
      prisma,
      worldId: 'w1',
      marketIndex: 1.0,
      marketTrend: -0.12,
      marketVolatility: 0,
    });
    expect(out.marketEvent?.kind).toBe('crash');
    vi.restoreAllMocks();
  });
});
