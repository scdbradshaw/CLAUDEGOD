// ============================================================
// MEMORY SERVICE
// Single source of truth for every memory-system interaction:
//   - writeMemory / writeMemoriesBatch  → person-scoped events
//   - writeGroupMemory / writeWorldMemory → higher-scope events
//   - getMemoryContext                   → unified read helper
//   - compressLifeDecade                 → birthday-triggered compaction
//
// NO raw prisma.memoryBank.findMany / createMany outside this file.
// The three memory scopes (person / group / world) each have their own
// table and decay policy:
//   person : kept for current life-decade only, compressed on birthdays
//            where age % 10 === 0. Summary carries top-N memories forward.
//   group  : write-once, keep-forever (religion/faction lifecycle only)
//   world  : write-once, keep-forever (plagues, wars, founding events)
// ============================================================

import { Prisma, PrismaClient, Tone, EmotionalImpact, PopulationTier } from '@prisma/client';
import prisma from '../db/client';
import {
  TRAUMA_IMPACT_MULTIPLIER,
  TRAUMA_RESILIENCE_RELIEF,
  TRAUMA_SCORE_MAX,
} from '@civ-sim/shared';

// A Prisma transaction client OR the default prisma instance. Every write
// accepts either so callers can batch inside an existing $transaction.
type Tx = PrismaClient | Prisma.TransactionClient;

// ── Tier → decade summary size ──────────────────────────────
// When a life-decade is compressed, we keep the top-N raw memories by
// weight. Larger worlds → smaller N so the table stays bounded.
export const DECADE_TOP_N_BY_TIER: Record<PopulationTier, number> = {
  intimate:     10,
  town:         5,
  civilization: 3,
};

// ── Event kinds that get a weight floor ─────────────────────
// Life-defining events always survive compression regardless of stat delta.
const FLOOR_EVENT_KINDS = new Set<MemoryEventKind>([
  'death', 'birth', 'marriage', 'group_founded', 'group_joined', 'group_left',
]);

export type MemoryEventKind =
  | 'interaction'
  | 'crime'
  | 'god_mode'
  | 'death'
  | 'birth'
  | 'marriage'
  | 'group_founded'
  | 'group_joined'
  | 'group_left'
  | 'group_leader_death';

// ── Weight formula ──────────────────────────────────────────
// Returns an integer 0-100. Deterministic, no Claude call. Designed to be
// cheap enough to compute inside the tick hot loop.
//
//   base (10)
//   + magnitude × 40        — outcome-band extremity (0-40)
//   + min(30, |Σ stat Δ|)   — how much the event moved the person (0-30)
//   + 20 if group-lifecycle — join/leave/found always matters long-term
//   + 15 if counterparty high-profile (caller hint, optional)
//   + 20 floor for death / birth / marriage / group_founded etc.
//
// Clamped to [0, 100].
export interface ComputeWeightInput {
  magnitude:               number; // 0-1
  statDeltaSumAbs?:        number; // sum of absolute stat deltas (clamped)
  eventKind?:              MemoryEventKind;
  counterpartyHighProfile?: boolean;
}

export function computeWeight(input: ComputeWeightInput): number {
  const magnitude = Math.max(0, Math.min(1, input.magnitude));
  const statAbs   = Math.max(0, input.statDeltaSumAbs ?? 0);

  let weight = 10;
  weight += Math.round(magnitude * 40);
  weight += Math.min(30, Math.round(statAbs));
  if (input.eventKind && ['group_founded', 'group_joined', 'group_left', 'group_leader_death'].includes(input.eventKind)) {
    weight += 20;
  }
  if (input.counterpartyHighProfile) {
    weight += 15;
  }
  if (input.eventKind && FLOOR_EVENT_KINDS.has(input.eventKind)) {
    weight = Math.max(weight, 60);
  }

  return Math.max(0, Math.min(100, weight));
}

// Helper: sum the absolute value of numeric fields in a PersonDelta-style
// object. Non-numeric fields are skipped. Used by callers that already have
// a `delta_applied` payload handy.
export function statDeltaSumAbs(delta: Record<string, unknown>): number {
  let s = 0;
  for (const v of Object.values(delta)) {
    if (typeof v === 'number') s += Math.abs(v);
  }
  return s;
}

// ── writeMemory ─────────────────────────────────────────────
export interface MemoryWriteInput {
  personId:        string;
  eventSummary:    string;
  emotionalImpact: EmotionalImpact;
  deltaApplied:    Record<string, unknown>;
  magnitude:       number;                   // 0-1
  tone:            Tone;
  worldYear:       number;
  counterpartyId?: string | null;
  eventKind?:      MemoryEventKind;
  /// Age of the subject at the moment of the event. Used to index
  /// decade_of_life. If omitted, decade_of_life will be NULL and the
  /// row is still searchable by (person, world_year).
  ageAtEvent?:     number;
  /// Optional precomputed weight. Overrides computeWeight() if provided.
  weight?:         number;
  /// Optional caller hint for weight computation.
  counterpartyHighProfile?: boolean;
}

export async function writeMemory(tx: Tx, input: MemoryWriteInput): Promise<void> {
  const weight = input.weight ?? computeWeight({
    magnitude:               input.magnitude,
    statDeltaSumAbs:         statDeltaSumAbs(input.deltaApplied),
    eventKind:               input.eventKind,
    counterpartyHighProfile: input.counterpartyHighProfile,
  });

  const decadeOfLife =
    input.ageAtEvent !== undefined ? Math.floor(input.ageAtEvent / 10) : null;

  await tx.memoryBank.create({
    data: {
      person_id:        input.personId,
      event_summary:    input.eventSummary,
      emotional_impact: input.emotionalImpact,
      delta_applied:    input.deltaApplied as Prisma.InputJsonValue,
      magnitude:        input.magnitude,
      counterparty_id:  input.counterpartyId ?? undefined,
      tone:             input.tone,
      world_year:       input.worldYear,
      weight,
      decade_of_life:   decadeOfLife,
    },
  });

  // Round 3 — Trauma accumulation (same path as the batch writer).
  await applyTraumaFromMemories(tx, [input]);
}

export async function writeMemoriesBatch(tx: Tx, inputs: MemoryWriteInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await tx.memoryBank.createMany({
    data: inputs.map((m) => ({
      person_id:        m.personId,
      event_summary:    m.eventSummary,
      emotional_impact: m.emotionalImpact,
      delta_applied:    m.deltaApplied as Prisma.InputJsonValue,
      magnitude:        m.magnitude,
      counterparty_id:  m.counterpartyId ?? undefined,
      tone:             m.tone,
      world_year:       m.worldYear,
      weight: m.weight ?? computeWeight({
        magnitude:               m.magnitude,
        statDeltaSumAbs:         statDeltaSumAbs(m.deltaApplied),
        eventKind:               m.eventKind,
        counterpartyHighProfile: m.counterpartyHighProfile,
      }),
      decade_of_life:
        m.ageAtEvent !== undefined ? Math.floor(m.ageAtEvent / 10) : null,
    })),
  });

  // Round 3 — Trauma accumulation. Every memory's (impact, magnitude) pair
  // produces a trauma delta; resilience dampens the inbound hit (but not
  // the healing from euphoric/positive events). We aggregate per person
  // into a single UPDATE so the tick hot loop stays cheap.
  await applyTraumaFromMemories(tx, inputs);
}

/**
 * Compute the raw trauma delta for a single memory *before* resilience
 * relief is applied. Callers that want to preview the scar-tissue impact
 * of a hypothetical memory can use this directly; the batch writer wraps
 * it with per-person resilience lookup and clamping.
 */
export function rawTraumaDeltaForMemory(impact: EmotionalImpact, magnitude: number): number {
  const mult = TRAUMA_IMPACT_MULTIPLIER[impact] ?? 0;
  return mult * Math.max(0, Math.min(1, magnitude));
}

/**
 * Aggregate trauma deltas by person and persist. Looks up each affected
 * person's current resilience + trauma_score once, applies resilience
 * relief to *incoming* (positive) deltas only, clamps to [0, TRAUMA_SCORE_MAX],
 * and writes back in one UPDATE per person via unnest() bulk SQL.
 *
 * Split out from writeMemoriesBatch so the births service and any future
 * direct writer can reach the same trauma-update path.
 */
async function applyTraumaFromMemories(tx: Tx, inputs: MemoryWriteInput[]): Promise<void> {
  // Aggregate raw deltas by person
  const rawByPerson = new Map<string, number>();
  for (const m of inputs) {
    const d = rawTraumaDeltaForMemory(m.emotionalImpact, m.magnitude);
    if (d === 0) continue;
    rawByPerson.set(m.personId, (rawByPerson.get(m.personId) ?? 0) + d);
  }
  if (rawByPerson.size === 0) return;

  const personIds = [...rawByPerson.keys()];
  const rows = await tx.person.findMany({
    where:  { id: { in: personIds } },
    select: { id: true, trauma_score: true, traits: true },
  });

  const updates: { id: string; next: number }[] = [];
  for (const row of rows) {
    const traits = (row.traits ?? {}) as Record<string, number>;
    const resilience = typeof traits.resilience === 'number' ? traits.resilience : 50;
    const raw = rawByPerson.get(row.id) ?? 0;
    // Resilience dampens accumulation only — joy heals fully regardless.
    const relief = raw > 0 ? 1 - resilience * TRAUMA_RESILIENCE_RELIEF : 1;
    const effective = raw * Math.max(0, relief);
    const next = Math.max(0, Math.min(TRAUMA_SCORE_MAX, row.trauma_score + effective));
    if (next !== row.trauma_score) updates.push({ id: row.id, next });
  }
  if (updates.length === 0) return;

  // One round-trip regardless of N.
  await tx.$executeRaw`
    UPDATE persons p SET
      trauma_score = (u.updates->>'next')::float,
      updated_at   = NOW()
    FROM jsonb_array_elements(${JSON.stringify(updates)}::jsonb) AS u(updates)
    WHERE p.id = (u.updates->>'id')::uuid
  `;
}

// ── writeGroupMemory ────────────────────────────────────────
// Religion & faction lifecycle events. Tiny volume, never decays.
export interface GroupMemoryInput {
  groupType:       'religion' | 'faction';
  groupId:         string;
  worldId:         string;
  eventKind:       string;      // 'founded' | 'first_member' | 'schism' | ...
  eventSummary:    string;
  worldYear:       number;
  tone?:           Tone;        // default 'epic'
  weight?:         number;      // default 70
  counterpartyId?: string;
  payload?:        Record<string, unknown>;
}

export async function writeGroupMemory(tx: Tx, input: GroupMemoryInput): Promise<void> {
  await tx.groupMemory.create({
    data: {
      group_type:      input.groupType,
      group_id:        input.groupId,
      world_id:        input.worldId,
      event_kind:      input.eventKind,
      event_summary:   input.eventSummary,
      world_year:      input.worldYear,
      tone:            input.tone   ?? 'epic',
      weight:          input.weight ?? 70,
      counterparty_id: input.counterpartyId,
      payload:         (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

// ── writeWorldMemory ────────────────────────────────────────
// World-scale canonical events. 0–5 per year. Never decays.
export interface WorldMemoryInput {
  worldId:      string;
  eventKind:    string;
  eventSummary: string;
  worldYear:    number;
  tone?:        Tone;
  weight?:      number;
  payload?:     Record<string, unknown>;
}

export async function writeWorldMemory(tx: Tx, input: WorldMemoryInput): Promise<void> {
  await tx.worldMemory.create({
    data: {
      world_id:      input.worldId,
      event_kind:    input.eventKind,
      event_summary: input.eventSummary,
      world_year:    input.worldYear,
      tone:          input.tone   ?? 'epic',
      weight:        input.weight ?? 80,
      payload:       (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}

// ── getMemoryContext ────────────────────────────────────────
// Unified read helper. Every future code site that needs memory context
// calls this instead of prisma.memoryBank.findMany / worldMemory.findMany.
//
//   scope='person' → returns LifeDecadeSummary rows + top-N raw current-
//                    decade entries, optionally filtered to a specific
//                    `about` counterparty.
//   scope='group'  → returns top-N group memories for the group.
//   scope='world'  → returns top-N world memories for the world.
//
// All shapes are plain JSON-safe objects. Callers use the `tone` field on
// the raw rows to decide narrative voice downstream.

export interface PersonMemoryContext {
  scope: 'person';
  decade_summaries: Array<{
    decade_end_age:   number;
    world_year_start: number;
    world_year_end:   number;
    top_memories:     unknown;
    aggregates:       unknown;
  }>;
  current_decade: Array<{
    event_summary:    string;
    emotional_impact: EmotionalImpact;
    tone:             Tone | null;
    magnitude:        number;
    weight:           number;
    world_year:       number | null;
    counterparty_id:  string | null;
    delta_applied:    unknown;
  }>;
}

export interface GroupMemoryContext {
  scope: 'group';
  entries: Array<{
    event_kind:    string;
    event_summary: string;
    tone:          Tone;
    world_year:    number;
    weight:        number;
    payload:       unknown;
  }>;
}

export interface WorldMemoryContext {
  scope: 'world';
  entries: Array<{
    event_kind:    string;
    event_summary: string;
    tone:          Tone;
    world_year:    number;
    weight:        number;
    payload:       unknown;
  }>;
}

export type MemoryContext = PersonMemoryContext | GroupMemoryContext | WorldMemoryContext;

export interface GetMemoryContextOpts {
  scope:      'person' | 'group' | 'world';
  id:         string;                         // personId / groupId / worldId
  limit?:     number;                         // default 10 for group/world, 20 for person
  about?:     string;                         // person scope: counterparty filter
  groupType?: 'religion' | 'faction';         // group scope: which table side
  yearRange?: { start: number; end: number }; // world/group scope: optional window
}

export async function getMemoryContext(opts: GetMemoryContextOpts): Promise<MemoryContext> {
  if (opts.scope === 'person') {
    const limit = opts.limit ?? 20;

    const [decadeRows, rawRows] = await Promise.all([
      prisma.lifeDecadeSummary.findMany({
        where:   { person_id: opts.id },
        orderBy: { decade_of_life: 'asc' },
      }),
      prisma.memoryBank.findMany({
        where: {
          person_id: opts.id,
          ...(opts.about ? { counterparty_id: opts.about } : {}),
        },
        orderBy: [{ weight: 'desc' }, { timestamp: 'desc' }],
        take:    limit,
      }),
    ]);

    return {
      scope: 'person',
      decade_summaries: decadeRows.map((r) => ({
        decade_end_age:   r.decade_end_age,
        world_year_start: r.world_year_start,
        world_year_end:   r.world_year_end,
        top_memories:     r.top_memories,
        aggregates:       r.aggregates,
      })),
      current_decade: rawRows.map((m) => ({
        event_summary:    m.event_summary,
        emotional_impact: m.emotional_impact,
        tone:             m.tone,
        magnitude:        m.magnitude,
        weight:           m.weight,
        world_year:       m.world_year,
        counterparty_id:  m.counterparty_id,
        delta_applied:    m.delta_applied,
      })),
    };
  }

  if (opts.scope === 'group') {
    const limit = opts.limit ?? 10;
    const rows = await prisma.groupMemory.findMany({
      where: {
        group_id:   opts.id,
        ...(opts.groupType ? { group_type: opts.groupType } : {}),
        ...(opts.yearRange ? {
          world_year: { gte: opts.yearRange.start, lte: opts.yearRange.end },
        } : {}),
      },
      orderBy: [{ weight: 'desc' }, { world_year: 'desc' }],
      take:    limit,
    });
    return {
      scope: 'group',
      entries: rows.map((r) => ({
        event_kind:    r.event_kind,
        event_summary: r.event_summary,
        tone:          r.tone,
        world_year:    r.world_year,
        weight:        r.weight,
        payload:       r.payload,
      })),
    };
  }

  // world
  const limit = opts.limit ?? 10;
  const rows = await prisma.worldMemory.findMany({
    where: {
      world_id: opts.id,
      ...(opts.yearRange ? {
        world_year: { gte: opts.yearRange.start, lte: opts.yearRange.end },
      } : {}),
    },
    orderBy: [{ weight: 'desc' }, { world_year: 'desc' }],
    take:    limit,
  });
  return {
    scope: 'world',
    entries: rows.map((r) => ({
      event_kind:    r.event_kind,
      event_summary: r.event_summary,
      tone:          r.tone,
      world_year:    r.world_year,
      weight:        r.weight,
      payload:       r.payload,
    })),
  };
}

// ── compressLifeDecade ──────────────────────────────────────
// Called at every birthday tick where age > 0 && age % 10 === 0.
// Takes the just-completed decade of raw memories, ranks by weight, keeps
// the top-N (tier-driven) as a JSON snapshot, computes aggregates, writes
// a LifeDecadeSummary row, and deletes the raw memories.
//
// Idempotent: if a summary for (person, decade_end_age) already exists,
// the function returns early. This means the tick can re-run safely.

export interface CompressLifeDecadeArgs {
  personId:     string;
  decadeEndAge: number;       // multiple of 10, > 0 (e.g. 30 = ended their 20s)
  worldYearEnd: number;       // world year at time of compression
  tier:         PopulationTier;
}

export interface CompressLifeDecadeResult {
  skipped:  boolean;           // true if summary already existed
  kept:     number;            // number of raw memories preserved
  deleted:  number;            // number of raw memories dropped
}

export async function compressLifeDecade(
  args: CompressLifeDecadeArgs,
): Promise<CompressLifeDecadeResult> {
  const { personId, decadeEndAge, worldYearEnd, tier } = args;

  if (decadeEndAge <= 0 || decadeEndAge % 10 !== 0) {
    throw new Error(`compressLifeDecade: decadeEndAge must be a positive multiple of 10 (got ${decadeEndAge})`);
  }
  const decadeOfLife = decadeEndAge / 10 - 1; // e.g. 30 → decade index 2 (their 20s)

  return prisma.$transaction(async (tx) => {
    // Idempotency guard
    const existing = await tx.lifeDecadeSummary.findUnique({
      where: { person_id_decade_end_age: { person_id: personId, decade_end_age: decadeEndAge } },
    });
    if (existing) return { skipped: true, kept: 0, deleted: 0 };

    // Find all raw memories from this decade. We prefer decade_of_life when
    // it's populated (post-Phase-6 writes); otherwise fall back to a
    // world_year window.
    const worldYearStart = Math.max(1, worldYearEnd - 10);

    const raw = await tx.memoryBank.findMany({
      where: {
        person_id: personId,
        OR: [
          { decade_of_life: decadeOfLife },
          {
            AND: [
              { decade_of_life: null },
              { world_year: { gte: worldYearStart, lte: worldYearEnd } },
            ],
          },
        ],
      },
      orderBy: [{ weight: 'desc' }, { magnitude: 'desc' }, { timestamp: 'desc' }],
    });

    const priorSummary = await tx.lifeDecadeSummary.findFirst({
      where:   { person_id: personId, decade_end_age: decadeEndAge - 10 },
      select:  { id: true },
    });

    const topN = DECADE_TOP_N_BY_TIER[tier];
    const kept = raw.slice(0, topN);
    const dropped = raw.slice(topN);

    // Aggregates — everything the raw rows could have answered in the future.
    const aggregates = {
      interaction_count: raw.length,
      avg_magnitude:     raw.length
        ? raw.reduce((s, m) => s + m.magnitude, 0) / raw.length
        : 0,
      avg_weight:        raw.length
        ? raw.reduce((s, m) => s + m.weight, 0) / raw.length
        : 0,
      peak_positive:     raw.find((m) => m.emotional_impact === 'euphoric')?.event_summary
                       ?? raw.find((m) => m.emotional_impact === 'positive')?.event_summary
                       ?? null,
      peak_negative:     raw.find((m) => m.emotional_impact === 'traumatic')?.event_summary
                       ?? raw.find((m) => m.emotional_impact === 'negative')?.event_summary
                       ?? null,
    };

    // Top-N snapshot — keep enough to narrate later without pulling raw rows.
    const topMemories = kept.map((m) => ({
      event_summary:    m.event_summary,
      emotional_impact: m.emotional_impact,
      tone:             m.tone,
      weight:           m.weight,
      magnitude:        m.magnitude,
      world_year:       m.world_year,
      counterparty_id:  m.counterparty_id,
      delta_applied:    m.delta_applied,
    }));

    await tx.lifeDecadeSummary.create({
      data: {
        person_id:        personId,
        decade_end_age:   decadeEndAge,
        decade_of_life:   decadeOfLife,
        world_year_start: worldYearStart,
        world_year_end:   worldYearEnd,
        top_memories:     topMemories as Prisma.InputJsonValue,
        aggregates:       aggregates   as Prisma.InputJsonValue,
        prior_summary_id: priorSummary?.id,
      },
    });

    // Delete everything in the just-compressed decade — both the kept and
    // dropped rows. The LifeDecadeSummary is now the canonical record.
    if (raw.length > 0) {
      await tx.memoryBank.deleteMany({
        where: { id: { in: raw.map((m) => m.id) } },
      });
    }

    return { skipped: false, kept: kept.length, deleted: dropped.length };
  });
}
