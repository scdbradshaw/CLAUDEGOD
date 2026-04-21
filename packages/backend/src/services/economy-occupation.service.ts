// ============================================================
// ECONOMY × OCCUPATION SERVICE — Phase 7 Wave 4
// ------------------------------------------------------------
// Annual income per occupation + inheritance on death.
//
// Income model:
//   Every year-boundary tick, living persons receive a wealth
//   bump derived from their occupation's base salary × the
//   current market index (so booms pay more, crashes pay less).
//   Noise per person is a ±variance roll to avoid everyone with
//   the same occupation landing on identical wealth.
//
// Inheritance model:
//   On death, the deceased's liquid wealth is distributed among
//   their top 3 strongest kin / spouse / lover edges. Any edge
//   types outside that inner circle are ignored — inheritance is
//   family and intimacy, not friendship. If no heirs exist the
//   wealth is forfeit (modeling "to the crown" / evaporation).
// ============================================================

import { Prisma, Tone } from '@prisma/client';
import prisma from '../db/client';
import { writeMemoriesBatch, type MemoryWriteInput } from './memory.service';

// ── Occupation income table ─────────────────────────────────
// Base salary in coin per year. Variance is the ± noise added to
// each individual's roll. Kept conservative so the market stays
// the dominant wealth driver — occupation is the floor, not the
// ceiling.
interface OccupationBracket {
  base:     number;
  variance: number;
}

const OCCUPATION_INCOME: Record<string, OccupationBracket> = {
  noble:     { base: 4000, variance: 1500 },
  merchant:  { base: 2500, variance: 2000 }, // variance > base/2 → sometimes net-zero years
  artisan:   { base: 1200, variance:  400 },
  scholar:   { base:  900, variance:  300 },
  soldier:   { base:  700, variance:  200 },
  priest:    { base:  500, variance:  150 },
  farmer:    { base:  400, variance:  150 },
  elder:     { base:  300, variance:  100 },
  criminal:  { base:  800, variance: 1500 }, // high variance — big scores or losses
  wanderer:  { base:  150, variance:  100 },
  commoner:  { base:  300, variance:  100 },
};

/** Inheritance split percentages applied top-down to the selected heirs.
 *  Extra heirs beyond index 2 are ignored — a deceased with 10 children
 *  passes wealth to the three closest ones, not 10 thin slivers. */
const INHERITANCE_SPLITS = [0.55, 0.30, 0.15] as const;

/** Relation kinds that can inherit. Friendship alone doesn't qualify. */
const INHERITABLE_RELATIONS = ['spouse', 'lover', 'child', 'parent', 'sibling'] as const;

// ── Annual income pass ──────────────────────────────────────

/**
 * Bulk-applies one year's occupation income to every living person in the
 * world. Single UPDATE keyed off occupation, scaled by the current market
 * index (capped 0.5..1.5 to avoid pathological payouts when the market
 * overshoots). Per-person noise is introduced via `random()` in SQL so we
 * don't have to ship N individual deltas from Node.
 */
export async function applyOccupationIncome(
  worldId:     string,
  marketIndex: number,
): Promise<void> {
  // Clamp the market multiplier. At 1.0 (baseline index) income is the
  // raw base; 1.5 is a boom ceiling; 0.5 is a recession floor.
  const mult = Math.max(0.5, Math.min(1.5, marketIndex));

  // Build jsonb payload for the occupation table. We do this once on the
  // JS side, then UPDATE ... FROM jsonb_each in a single round-trip.
  const payload = Object.entries(OCCUPATION_INCOME).map(([occ, b]) => ({
    occ, base: b.base, variance: b.variance,
  }));

  // One UPDATE that joins persons against the bracket table. Unknown
  // occupations fall through (no row in `brackets`) — persons with weird
  // occupation strings simply don't earn income.
  await prisma.$executeRaw`
    UPDATE persons p SET
      wealth     = GREATEST(0, p.wealth + ROUND(
                     (b.base + (random() * 2 - 1) * b.variance)::numeric * ${mult}::numeric
                   )::int),
      updated_at = NOW()
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
      AS b(occ text, base int, variance int)
    WHERE p.world_id = ${worldId}::uuid
      AND p.health   > 0
      AND p.occupation = b.occ
  `;
}

// ── Inheritance ─────────────────────────────────────────────

export interface InheritanceHeir {
  heir_id:       string;
  heir_name:     string;
  relation:      string;
  share:         number;  // absolute wealth transferred
  bond_strength: number;
}

export interface InheritanceResult {
  deceased_id:   string;
  deceased_name: string;
  estate:        number;
  heirs:         InheritanceHeir[];
}

/**
 * Transfers `estate` wealth from a dying person to their top-3 strongest
 * kin/spouse/lover edges. Must be called BEFORE the Person row is deleted
 * — once the row is gone the inner_circle_links rows cascade away with it.
 *
 * Writes an inheritance memory on each heir so the event shows up in
 * their Chronicle. Returns a result the tick handler can surface in the
 * response payload for visibility.
 */
export async function distributeInheritance(
  tx:         Prisma.TransactionClient,
  deceasedId: string,
  deceasedName: string,
  estate:     number,
  worldYear:  number,
): Promise<InheritanceResult> {
  const empty: InheritanceResult = {
    deceased_id: deceasedId, deceased_name: deceasedName, estate, heirs: [],
  };
  if (estate <= 0) return empty;

  // Pull candidate heirs — only inner-circle kin/spouse/lover edges that
  // still point at a living person. Ordered strongest-first.
  const rows = await tx.$queryRaw<Array<{
    target_id:     string;
    target_name:   string;
    relation_type: string;
    bond_strength: number;
  }>>`
    SELECT l.target_id, l.relation_type, l.bond_strength, p.name AS target_name
    FROM   "inner_circle_links" l
    JOIN   "persons"             p ON p.id = l.target_id
    WHERE  l.owner_id = ${deceasedId}::uuid
      AND  p.health   > 0
      AND  l.relation_type::text = ANY(${INHERITABLE_RELATIONS as readonly string[]}::text[])
    ORDER BY l.bond_strength DESC
    LIMIT 3
  `;
  if (rows.length === 0) return empty;

  // Compute shares. If fewer than 3 heirs, remaining splits roll up into
  // the primary heir so the estate doesn't leak.
  const shares = INHERITANCE_SPLITS.slice(0, rows.length);
  const totalPct = shares.reduce((s, v) => s + v, 0);
  const heirs: InheritanceHeir[] = rows.map((r, i) => ({
    heir_id:       r.target_id,
    heir_name:     r.target_name,
    relation:      r.relation_type,
    share:         Math.floor((shares[i] / totalPct) * estate),
    bond_strength: r.bond_strength,
  }));

  // Bulk-update heir wealth in one round-trip.
  const rowsPayload = heirs.map(h => ({ id: h.heir_id, share: h.share }));
  await tx.$executeRaw`
    UPDATE persons p SET
      wealth     = p.wealth + (u.share)::int,
      updated_at = NOW()
    FROM jsonb_to_recordset(${JSON.stringify(rowsPayload)}::jsonb)
      AS u(id uuid, share int)
    WHERE p.id = u.id
  `;

  // Inheritance memories. Weight is floored high (via eventKind='death')
  // so these persist through the annual decay sweep.
  const memories: MemoryWriteInput[] = heirs.map(h => ({
    personId:        h.heir_id,
    eventSummary:    `Inherited ${h.share} coin from ${deceasedName} (${h.relation}).`,
    emotionalImpact: h.bond_strength >= 70 ? 'negative' : 'neutral',
    deltaApplied:    { inheritance: h.share, from: deceasedName },
    magnitude:       0.6,
    counterpartyId:  deceasedId,
    worldYear,
    tone:            Tone.literary,
    eventKind:       'death',
  }));
  await writeMemoriesBatch(tx, memories);

  return { deceased_id: deceasedId, deceased_name: deceasedName, estate, heirs };
}
