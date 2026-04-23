// ============================================================
// RELATIONSHIPS SERVICE — Phase 7 Wave 2
// Reuses the existing InnerCircleLink table as an emergent social
// graph. Interaction memories feed `applyRelationshipDeltas`; the
// yearly world tick calls `decayAndPruneForWorld`.
// ============================================================

import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import type { EmotionalImpact } from '../types/person';

export type InnerCircleRelation =
  | 'parent' | 'child' | 'sibling' | 'spouse' | 'lover'
  | 'close_friend' | 'rival' | 'enemy';

export interface RelationshipDelta {
  ownerId:       string;
  targetId:      string;
  kind:          InnerCircleRelation;
  /** Signed integer — +raises bond, -lowers bond. Applied from a 50 midpoint
   *  so new links start at 50 and move either way toward 0 / 100. */
  strengthDelta: number;
}

/**
 * Maps the EmotionalImpact of a memory to a relationship kind + strength
 * delta. Neutral memories don't touch the graph — they're noise in a social
 * sense. Euphoric/traumatic swing twice as hard as positive/negative.
 *
 * Returns null so callers can `.filter(Boolean)` away neutral events.
 */
export function classifyImpactForRelationship(
  impact: EmotionalImpact,
): { kind: InnerCircleRelation; delta: number } | null {
  switch (impact) {
    case 'euphoric':  return { kind: 'close_friend', delta:  10 };
    case 'positive':  return { kind: 'close_friend', delta:   4 };
    case 'negative':  return { kind: 'rival',        delta:   4 };
    case 'traumatic': return { kind: 'enemy',        delta:  10 };
    case 'neutral':   return null;
  }
}

/**
 * Batch-upserts a set of directed relationship deltas in one round-trip.
 * De-duplicates owner|target|kind before hitting the DB so a pair that
 * interacted twice in the same tick only writes once with summed delta.
 *
 * Uses the existing unique (owner_id, target_id, relation_type) constraint;
 * bond_strength is clamped 0..100 on both insert and update paths.
 */
export async function applyRelationshipDeltas(
  tx: Prisma.TransactionClient,
  deltas: RelationshipDelta[],
): Promise<void> {
  if (deltas.length === 0) return;

  const agg = new Map<string, RelationshipDelta>();
  for (const d of deltas) {
    // Skip self-links — sanity guard; shouldn't happen since interactions
    // always have two distinct people, but cheap to enforce here too.
    if (d.ownerId === d.targetId) continue;
    const k = `${d.ownerId}|${d.targetId}|${d.kind}`;
    const prev = agg.get(k);
    if (prev) prev.strengthDelta += d.strengthDelta;
    else agg.set(k, { ...d });
  }
  const rows = Array.from(agg.values());
  if (rows.length === 0) return;

  // Upsert with clamped strength. On insert: start at 50 + delta. On conflict:
  // add delta (encoded as EXCLUDED.bond_strength - 50) to the current value.
  await tx.$executeRaw`
    INSERT INTO inner_circle_links
      ("id", "owner_id", "target_id", "relation_type", "bond_strength", "created_at", "updated_at")
    SELECT
      gen_random_uuid(),
      (u->>'ownerId')::uuid,
      (u->>'targetId')::uuid,
      (u->>'kind')::"InnerCircleRelation",
      GREATEST(0, LEAST(100, 50 + (u->>'strengthDelta')::int)),
      NOW(), NOW()
    FROM jsonb_array_elements(${JSON.stringify(rows)}::jsonb) AS u
    ON CONFLICT ("owner_id", "target_id", "relation_type")
    DO UPDATE SET
      "bond_strength" = GREATEST(0, LEAST(100,
        "inner_circle_links"."bond_strength" + (EXCLUDED."bond_strength" - 50)
      )),
      "updated_at" = NOW()
  `;
}

/**
 * Yearly decay pass — pulls all bond_strengths toward the 50 midpoint by 1
 * point, then deletes rows that have drifted into neutral territory (48-52).
 * Keeps the graph from accumulating crust from people who interacted once in
 * year 1 and never again. Called from the year-boundary section of the tick.
 */
export async function decayAndPruneForWorld(worldId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "inner_circle_links"
    SET "bond_strength" = "bond_strength" + CASE
      WHEN "bond_strength" > 50 THEN -1
      WHEN "bond_strength" < 50 THEN  1
      ELSE 0
    END,
    "updated_at" = NOW()
    WHERE "owner_id" IN (SELECT "id" FROM "persons" WHERE "world_id" = ${worldId}::uuid)
  `;

  await prisma.$executeRaw`
    DELETE FROM "inner_circle_links"
    WHERE "bond_strength" BETWEEN 48 AND 52
      AND "owner_id" IN (SELECT "id" FROM "persons" WHERE "world_id" = ${worldId}::uuid)
  `;
}

// ── Read helpers ─────────────────────────────────────────────

export interface RelationshipRow {
  id:             string;
  owner_id:       string;
  target_id:      string;
  relation_type:  InnerCircleRelation;
  bond_strength:  number;
  target_name:    string;
  target_alive:   boolean;
  updated_at:     string;
}

/**
 * Returns the owner's outgoing relationship edges with counterpart name
 * joined in. Ordered by strength-from-neutral desc so the most significant
 * edges (whether warm or cold) float to the top. Default limit keeps the
 * per-character request cheap at 5k+ population.
 */
export async function listForPerson(personId: string, limit = 24): Promise<RelationshipRow[]> {
  const rows = await prisma.$queryRaw<Array<{
    id:            string;
    owner_id:      string;
    target_id:     string;
    relation_type: InnerCircleRelation;
    bond_strength: number;
    target_name:   string;
    target_health: number;
    updated_at:    Date;
  }>>`
    SELECT l."id", l."owner_id", l."target_id", l."relation_type",
           l."bond_strength", l."updated_at",
           p."name"           AS "target_name",
           p."current_health" AS "target_health"
    FROM   "inner_circle_links" l
    JOIN   "persons"             p ON p."id" = l."target_id"
    WHERE  l."owner_id" = ${personId}::uuid
    ORDER BY ABS(l."bond_strength" - 50) DESC, l."updated_at" DESC
    LIMIT  ${limit}
  `;

  return rows.map(r => ({
    id:            r.id,
    owner_id:      r.owner_id,
    target_id:     r.target_id,
    relation_type: r.relation_type,
    bond_strength: r.bond_strength,
    target_name:   r.target_name,
    target_alive:  r.target_health > 0,
    updated_at:    r.updated_at.toISOString(),
  }));
}
