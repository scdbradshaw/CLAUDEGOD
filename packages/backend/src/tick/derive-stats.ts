// ============================================================
// TICK PHASE — Derive hard combat stats from BODY + MIND
// ============================================================
// After trait deltas are flushed each tick, this phase reads
// each living person's BODY traits + MIND amplifier and pushes
// the hard combat stat columns toward their trait-implied targets.
//
// BODY mapping:
//   strength   → attack
//   endurance  → max_health, defense
//   agility    → speed
//   resilience → current_health recovery toward max_health
//
// MIND amplifier (intelligence 0–100 → factor 0.5–1.5):
//   Low intelligence = slow drift; high intelligence = fast drift.
// ============================================================

import type { PrismaClient } from '@prisma/client';

// ── Tunables ──────────────────────────────────────────────────

/** Fraction of the gap between current stat and trait target closed per tick. */
const BASE_PUSH_RATE = 0.10;  // 10 % of gap per tick at intelligence = 50

/** Push rate multiplier range keyed to intelligence (0 = MIND_AMP_MIN, 100 = MIND_AMP_MAX). */
const MIND_AMP_MIN = 0.5;
const MIND_AMP_MAX = 1.5;

/**
 * Fraction of BASE_PUSH_RATE applied to current_health recovery.
 * Keeps HP recovery noticeably slower than stat convergence so injuries
 * matter across multiple ticks.
 */
const RECOVERY_RATE_SCALE = 0.6;

// ── Types ─────────────────────────────────────────────────────

export interface DeriveStatsInput {
  id:             string;
  /** Post-interaction current HP (use finalHealth[id], not p.current_health). */
  current_health: number;
  max_health:     number;
  attack:         number;
  defense:        number;
  speed:          number;
  /** Post-tick traits (merged from bulkUpdates, or pre-tick if unchanged). */
  traits:         Record<string, number>;
}

interface DeriveStatsRow {
  id:             string;
  current_health: number;
  max_health:     number;
  attack:         number;
  defense:        number;
  speed:          number;
}

// ── Pure derivation ───────────────────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function deriveOne(p: DeriveStatsInput): DeriveStatsRow {
  const t = p.traits;

  const intelligence = t.intelligence ?? 50;
  const strength     = t.strength     ?? 50;
  const endurance    = t.endurance    ?? 50;
  const agility      = t.agility      ?? 50;
  const resilience   = t.resilience   ?? 50;

  // MIND factor: intelligence = 50 → 1.0× push; 0 → 0.5×; 100 → 1.5×.
  const mindFactor = MIND_AMP_MIN + (intelligence / 100) * (MIND_AMP_MAX - MIND_AMP_MIN);

  const rate = BASE_PUSH_RATE * mindFactor;

  const newAttack    = clamp(Math.round(p.attack    + (strength  - p.attack)    * rate));
  const newDefense   = clamp(Math.round(p.defense   + (endurance - p.defense)   * rate));
  const newMaxHealth = clamp(Math.round(p.max_health + (endurance - p.max_health) * rate));
  const newSpeed     = clamp(Math.round(p.speed     + (agility   - p.speed)     * rate));

  // Resilience drives HP recovery toward max_health. Recovery is slower than
  // stat convergence and scales 0–100 with the resilience trait value.
  // If max_health dropped below current_health, current is clamped down.
  let newCurrentHealth: number;
  if (p.current_health > newMaxHealth) {
    // Max health shrank — clamp current down.
    newCurrentHealth = newMaxHealth;
  } else if (p.current_health < newMaxHealth) {
    const recoveryRate = RECOVERY_RATE_SCALE * (resilience / 100) * rate;
    newCurrentHealth   = clamp(Math.round(
      p.current_health + (newMaxHealth - p.current_health) * recoveryRate,
    ));
    // Never recover past max.
    newCurrentHealth = Math.min(newCurrentHealth, newMaxHealth);
  } else {
    newCurrentHealth = p.current_health;
  }

  return { id: p.id, current_health: newCurrentHealth, max_health: newMaxHealth, attack: newAttack, defense: newDefense, speed: newSpeed };
}

// ── DB write ──────────────────────────────────────────────────

/**
 * Derive hard combat stats from BODY traits + MIND amplifier for every person
 * in `persons` and bulk-update the five combat stat columns.
 *
 * Only rows where at least one stat changed are sent to the DB.
 * Returns the number of rows actually updated.
 */
export async function deriveHardStats(
  prisma:  PrismaClient,
  persons: DeriveStatsInput[],
): Promise<number> {
  if (persons.length === 0) return 0;

  const changed: DeriveStatsRow[] = [];

  for (const p of persons) {
    const next = deriveOne(p);
    if (
      next.current_health !== p.current_health ||
      next.max_health     !== p.max_health     ||
      next.attack         !== p.attack         ||
      next.defense        !== p.defense        ||
      next.speed          !== p.speed
    ) {
      changed.push(next);
    }
  }

  if (changed.length === 0) return 0;

  await prisma.$executeRaw`
    UPDATE persons p SET
      current_health = (u.row->>'current_health')::int,
      max_health     = (u.row->>'max_health')::int,
      attack         = (u.row->>'attack')::int,
      defense        = (u.row->>'defense')::int,
      speed          = (u.row->>'speed')::int,
      updated_at     = NOW()
    FROM jsonb_array_elements(${JSON.stringify(changed)}::jsonb) AS u(row)
    WHERE p.id = (u.row->>'id')::uuid
  `;

  return changed.length;
}
