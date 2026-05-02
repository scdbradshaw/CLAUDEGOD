// Phase 13a — Always-on invariants suite (§20.1).
//
// Runs at the very end of a YearRun transaction. On any violation: throw
// `InvariantViolationError` → outer tx rolls back → SSE emits `failed`.
//
// Five rules:
//   1. No negatives — count, wealth, current_health, market_index,
//      treasury, army_size all ≥ 0
//   2. Real-person cap — alive real persons ≤ REAL_PERSON_CAP
//   3. world_id containment — no FK crosses worlds
//   4. Bucket-count integrity — covered today by per-phase bucket-dynamics
//      invariant; year-end check confirms no negative counts (rule 1) and
//      no orphaned buckets (no city → no buckets).
//   5. Wealth conservation — bucket + person + group + city totals don't
//      drift more than tolerance (Math.round per-capita drift × N + event mods)
//
// Wealth conservation is checked relative to a baseline captured at year start.
// The runner must record `wealth_at_start` and pass it in.

import type { Prisma, PrismaClient } from '@prisma/client';
import { REAL_PERSON_CAP } from '@claude-god/shared';

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface InvariantViolation {
  rule:
    | 'no_negatives'
    | 'real_person_cap'
    | 'world_id_containment'
    | 'bucket_orphan'
    | 'wealth_conservation';
  message: string;
}

export class InvariantViolationError extends Error {
  violations: InvariantViolation[];
  constructor(violations: InvariantViolation[]) {
    super(
      `Invariant violations: ${violations.map((v) => `[${v.rule}] ${v.message}`).join('; ')}`,
    );
    this.name = 'InvariantViolationError';
    this.violations = violations;
  }
}

export interface InvariantContext {
  world_id: string;
  /** Sum of bucket avg_wealth × count + person.wealth + group.treasury + city.treasury, captured at year start (post-event-mods, before bucket dynamics). */
  wealth_at_start: number;
  /** Tolerance for wealth drift — see DESIGN.md §20.1. Per-capita Int rounding produces ~2*total_count + event_mods drift. */
  wealth_tolerance: number;
}

/** Throws InvariantViolationError on any violation. Otherwise returns. */
export async function runYearEndInvariants(
  ctx: InvariantContext,
  tx: TxClient,
): Promise<void> {
  const violations: InvariantViolation[] = [];

  // ── 1. No negatives ─────────────────────────────────────────────────────
  const negBuckets = await tx.bucket.findFirst({
    where: {
      city: { world_id: ctx.world_id },
      OR: [{ count: { lt: 0 } }, { avg_wealth: { lt: 0 } }],
    },
    select: { city_id: true, type: true, count: true, avg_wealth: true },
  });
  if (negBuckets) {
    violations.push({
      rule: 'no_negatives',
      message: `bucket ${negBuckets.city_id}/${negBuckets.type} count=${negBuckets.count} wealth=${negBuckets.avg_wealth}`,
    });
  }
  const negPerson = await tx.person.findFirst({
    where: {
      world_id: ctx.world_id,
      OR: [{ wealth: { lt: 0 } }, { current_health: { lt: 0 } }],
    },
    select: { id: true, wealth: true, current_health: true },
  });
  if (negPerson) {
    violations.push({
      rule: 'no_negatives',
      message: `person ${negPerson.id} wealth=${negPerson.wealth} health=${negPerson.current_health}`,
    });
  }
  const negGroup = await tx.group.findFirst({
    where: {
      world_id: ctx.world_id,
      OR: [{ treasury: { lt: 0 } }, { army_size: { lt: 0 } }],
    },
    select: { id: true, treasury: true, army_size: true },
  });
  if (negGroup) {
    violations.push({
      rule: 'no_negatives',
      message: `group ${negGroup.id} treasury=${negGroup.treasury} army=${negGroup.army_size}`,
    });
  }
  const negCity = await tx.city.findFirst({
    where: { world_id: ctx.world_id, OR: [{ treasury: { lt: 0 } }] },
    select: { id: true, treasury: true },
  });
  if (negCity) {
    violations.push({
      rule: 'no_negatives',
      message: `city ${negCity.id} treasury=${negCity.treasury}`,
    });
  }
  const world = await tx.world.findUnique({
    where: { id: ctx.world_id },
    select: { market_index: true },
  });
  if (world && world.market_index < 0) {
    violations.push({
      rule: 'no_negatives',
      message: `world market_index=${world.market_index}`,
    });
  }

  // ── 2. Real-person cap ──────────────────────────────────────────────────
  const aliveCount = await tx.person.count({
    where: { world_id: ctx.world_id, is_alive: true },
  });
  if (aliveCount > REAL_PERSON_CAP) {
    violations.push({
      rule: 'real_person_cap',
      message: `${aliveCount} > ${REAL_PERSON_CAP}`,
    });
  }

  // ── 3. world_id containment ─────────────────────────────────────────────
  // Persons and groups carry world_id directly. Buckets live under cities,
  // so we sample a few cross-world-id checks. Since FKs cascade-delete on
  // World drop, the deepest check is whether any Person.city_id points to
  // a city in a different world.
  const wrongCityWorld = await tx.person.findFirst({
    where: {
      world_id: ctx.world_id,
      city: { world_id: { not: ctx.world_id } },
    },
    select: { id: true, city_id: true },
  });
  if (wrongCityWorld) {
    violations.push({
      rule: 'world_id_containment',
      message: `person ${wrongCityWorld.id} → city ${wrongCityWorld.city_id} (different world)`,
    });
  }

  // ── 4. Bucket orphan check ──────────────────────────────────────────────
  // Buckets must always live under a non-ruined city in the same world.
  const orphan = await tx.bucket.findFirst({
    where: { city: { world_id: ctx.world_id, is_ruined: true } },
    select: { city_id: true, type: true, count: true },
  });
  if (orphan && orphan.count > 0) {
    violations.push({
      rule: 'bucket_orphan',
      message: `ruined city ${orphan.city_id} still has bucket ${orphan.type}=${orphan.count}`,
    });
  }

  // ── 5. Wealth conservation ──────────────────────────────────────────────
  const total = await sumWorldWealth(ctx.world_id, tx);
  const drift = total - ctx.wealth_at_start;
  // Skip the conservation rule when wealth_at_start is 0 (typical for
  // seed-only worlds where bucket dynamics haven't run yet — drift is
  // dominated by income on the first year).
  if (ctx.wealth_at_start > 0 && Math.abs(drift) > ctx.wealth_tolerance) {
    violations.push({
      rule: 'wealth_conservation',
      message: `start=${ctx.wealth_at_start} end=${total} drift=${drift} tol=${ctx.wealth_tolerance}`,
    });
  }

  if (violations.length > 0) {
    throw new InvariantViolationError(violations);
  }
}

/** Aggregate world wealth across buckets, persons, groups, cities. */
export async function sumWorldWealth(
  worldId: string,
  tx: TxClient,
): Promise<number> {
  const buckets = await tx.bucket.findMany({
    where: { city: { world_id: worldId } },
    select: { count: true, avg_wealth: true },
  });
  const bucketSum = buckets.reduce((s, b) => s + b.count * b.avg_wealth, 0);

  const personSum = (
    await tx.person.aggregate({
      where: { world_id: worldId, is_alive: true },
      _sum: { wealth: true },
    })
  )._sum.wealth ?? 0;

  const groupSum = (
    await tx.group.aggregate({
      where: { world_id: worldId, is_active: true },
      _sum: { treasury: true },
    })
  )._sum.treasury ?? 0;

  const citySum = (
    await tx.city.aggregate({
      where: { world_id: worldId },
      _sum: { treasury: true },
    })
  )._sum.treasury ?? 0;

  return bucketSum + personSum + groupSum + citySum;
}
