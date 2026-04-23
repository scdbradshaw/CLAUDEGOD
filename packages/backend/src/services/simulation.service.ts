// ============================================================
// SIMULATION SERVICE
// All character mutations flow through here.
// ============================================================

import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import { getActiveWorldId } from './time.service';
import {
  toneForGodModeSingle,
  toneForGodModeBulk,
  type Tone,
} from './tone.service';
import type {
  PersonDelta,
  MutationResult,
  EmotionalImpact,
  CriminalRecord,
  FilterQuery,
  BulkActionRequest,
  BulkActionResult,
} from '../types/person';

// --------------- Simulation Rules ---------------
// These run when force === false.
// Add your world-logic here — e.g. health can't rise above 100,
// lifespan caps, wealth floors, etc.

function applySimulationRules(
  current: Record<string, unknown>,
  delta: PersonDelta,
): PersonDelta {
  const result = { ...delta };

  // Clamp 0-100 stats
  const clampedStats = ['current_health', 'max_health', 'attack', 'defense', 'speed'] as const;

  for (const stat of clampedStats) {
    if ((result as Record<string, unknown>)[stat] !== undefined) {
      (result as Record<string, unknown>)[stat] = Math.max(0, Math.min(100, (result as Record<string, unknown>)[stat] as number));
    }
  }

  // Age can only increase via simulation (not force)
  if (result.age !== undefined && (current.age as number) > (result.age as number)) {
    result.age = current.age as number;
  }

  // Money floor at 0 for normal simulation
  if ((result as Record<string, unknown>).money !== undefined) {
    (result as Record<string, unknown>).money = Math.max(0, (result as Record<string, unknown>).money as number);
  }

  return result;
}

// --------------- Service Methods ---------------

export interface ApplyDeltaOptions {
  personId:        string;
  delta:           PersonDelta;
  event_summary:   string;
  emotional_impact: EmotionalImpact;
  /** If true, skip simulation rules (God Mode) */
  force?:          boolean;
  /**
   * Narrative voice for the resulting memory. Caller-specified tones win;
   * unspecified God Mode writes default to the tabloid single-target voice,
   * non-God-Mode callers (interaction outcomes, simulation events) pass their
   * own tone derived from the outcome band.
   */
  tone?:           Tone;
  /** Optional JSONB trait overrides merged into the traits object */
  trait_overrides?: Record<string, number>;
}

/**
 * Apply a PersonDelta to a character and log the change to their Memory Bank.
 * Returns the updated person and the new memory entry.
 */
export async function applyDelta(opts: ApplyDeltaOptions): Promise<MutationResult> {
  const { personId, delta, event_summary, emotional_impact, force = false, tone } = opts;

  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  // Apply world rules unless this is a God Mode override
  const sanitizedDelta = force
    ? delta
    : applySimulationRules(person as unknown as Record<string, unknown>, delta);

  // Build the Prisma update payload (only defined keys)
  const updateData = buildUpdatePayload(sanitizedDelta);

  // Merge trait overrides into the traits JSONB if provided
  if (opts.trait_overrides && Object.keys(opts.trait_overrides).length > 0) {
    const currentTraits = (person.traits as Record<string, number>) ?? {};
    (updateData as Record<string, unknown>).traits = {
      ...currentTraits,
      ...opts.trait_overrides,
    };
  }

  // Resolve tone: caller-specified wins; otherwise God Mode gets the
  // single-target voice, simulation writes get the neutral log voice.
  const resolvedTone: Tone = tone ?? (force ? toneForGodModeSingle() : 'neutral');

  // Atomically update person + create memory entry
  const [updatedPerson, memoryEntry] = await prisma.$transaction([
    prisma.person.update({
      where: { id: personId },
      data: updateData,
    }),
    prisma.memoryBank.create({
      data: {
        person_id:       personId,
        event_summary,
        emotional_impact,
        delta_applied:   sanitizedDelta as Prisma.InputJsonValue,
        tone:            resolvedTone,
        timestamp:       new Date(),
      },
    }),
  ]);

  return {
    person:       mapPerson(updatedPerson),
    memory_entry: mapMemory(memoryEntry),
  };
}

/**
 * Append a criminal record entry and log it.
 */
export async function addCriminalRecord(
  personId:      string,
  record:        CriminalRecord,
  event_summary: string,
  tone?:         Tone,
): Promise<MutationResult> {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const existing = person.criminal_record as unknown as CriminalRecord[];

  const updated = [...existing, record];

  // Crimes default to the tabloid single-target voice.
  const resolvedTone: Tone = tone ?? toneForGodModeSingle();

  const [updatedPerson, memoryEntry] = await prisma.$transaction([
    prisma.person.update({
      where: { id: personId },
      data: { criminal_record: updated as unknown as Prisma.InputJsonValue },
    }),
    prisma.memoryBank.create({
      data: {
        person_id:       personId,
        event_summary,
        emotional_impact: 'negative',
        delta_applied:   { criminal_record: [record] } as unknown as Prisma.InputJsonValue,
        tone:            resolvedTone,
        timestamp:       new Date(),
      },
    }),
  ]);

  return {
    person:       mapPerson(updatedPerson),
    memory_entry: mapMemory(memoryEntry),
  };
}

// --------------- Bulk Filter Action ───────────────────────────────────────

/**
 * Apply a delta to every living person matching the filter query.
 * Each matched person gets one MemoryBank entry.
 *
 * JSONB trait nudges use raw SQL:
 *   traits = jsonb_set(traits, '{key}', to_jsonb(CLAMP(CURRENT + delta, 0, 100)))
 */
export async function applyBulkFilter(
  req: BulkActionRequest,
): Promise<BulkActionResult> {
  const { filters, delta, event_summary, emotional_impact, tone } = req;
  const worldId = await getActiveWorldId();

  // Bulk actions read as dispatches by default — the reportage voice.
  const resolvedTone: Tone = tone ?? toneForGodModeBulk();

  // ── 1. Build the WHERE clause ─────────────────────────────────────────────
  // Always scope to the active world
  const conditions: Prisma.Sql[] = [
    Prisma.sql`world_id = ${worldId}::uuid`,
  ];

  for (const clause of filters) {
    const { field, op } = clause;

    if (field.startsWith('trait.')) {
      const key = field.slice('trait.'.length);
      const safeKey = key.replace(/'/g, "''");
      const jsonField = Prisma.sql`(traits->>${Prisma.raw(`'${safeKey}'`)})::numeric`;

      if (op === 'between') {
        const c = clause as { op: 'between'; min: number; max: number; field: string };
        conditions.push(Prisma.sql`${jsonField} BETWEEN ${c.min} AND ${c.max}`);
      } else {
        const c = clause as { op: string; value: number; field: string };
        conditions.push(Prisma.sql`${jsonField} ${Prisma.raw(opToSql(op))} ${c.value}`);
      }
    } else if (field.startsWith('global_score.')) {
      const key = field.slice('global_score.'.length);
      const safeKey = key.replace(/'/g, "''");
      const jsonField = Prisma.sql`(global_scores->>${Prisma.raw(`'${safeKey}'`)})::numeric`;

      if (op === 'between') {
        const c = clause as { op: 'between'; min: number; max: number; field: string };
        conditions.push(Prisma.sql`${jsonField} BETWEEN ${c.min} AND ${c.max}`);
      } else {
        const c = clause as { op: string; value: number; field: string };
        conditions.push(Prisma.sql`${jsonField} ${Prisma.raw(opToSql(op))} ${c.value}`);
      }
    } else if (op === 'eq') {
      const c = clause as { op: 'eq'; value: string; field: string };
      conditions.push(Prisma.sql`${Prisma.raw(pgIdent(field))} = ${c.value}`);
    } else if (op === 'in') {
      const c = clause as { op: 'in'; values: string[]; field: string };
      conditions.push(Prisma.sql`${Prisma.raw(pgIdent(field))} = ANY(${c.values})`);
    } else if (op === 'between') {
      const c = clause as { op: 'between'; min: number; max: number; field: string };
      conditions.push(Prisma.sql`${Prisma.raw(pgIdent(field))} BETWEEN ${c.min} AND ${c.max}`);
    } else {
      const c = clause as { op: string; value: number; field: string };
      conditions.push(Prisma.sql`${Prisma.raw(pgIdent(field))} ${Prisma.raw(opToSql(op))} ${c.value}`);
    }
  }

  const whereClause =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.sql``;

  // ── 2. Fetch matching IDs ─────────────────────────────────────────────────
  const matched: { id: string }[] = await prisma.$queryRaw`
    SELECT id FROM persons ${whereClause}
  `;

  if (matched.length === 0) return { matched: 0, affected: 0, memory_entries_created: 0 };

  const ids = matched.map((r) => r.id);

  // ── 3. Separate scalar deltas from JSONB trait deltas ────────────────────
  const CLAMP_STATS = new Set(['current_health', 'max_health', 'attack', 'defense', 'speed']);
  const scalarSets: Record<string, number>   = {};
  const scalarNudges: Record<string, number> = {};
  const traitSets: Record<string, number>    = {};
  const traitNudges: Record<string, number>  = {};

  for (const [key, { mode, value }] of Object.entries(delta)) {
    if (key.startsWith('trait.')) {
      const attr = key.slice('trait.'.length);
      mode === 'set' ? (traitSets[attr] = value) : (traitNudges[attr] = value);
    } else {
      mode === 'set' ? (scalarSets[key] = value) : (scalarNudges[key] = value);
    }
  }

  // ── 4. Apply in batches of 200 ───────────────────────────────────────────
  const BATCH = 200;
  let affected = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batchIds = ids.slice(i, i + BATCH);

    const persons = await prisma.person.findMany({
      where:  { id: { in: batchIds } },
      select: buildSelectForNudge(scalarNudges, traitNudges),
    });

    const ops: Prisma.PrismaPromise<unknown>[] = [];

    for (const person of persons) {
      const p = person as Record<string, unknown> & { id: string };
      const updateData: Record<string, unknown> = { ...scalarSets };

      // Scalar nudges with clamping
      for (const [key, nudge] of Object.entries(scalarNudges)) {
        const current = (p[key] as number) ?? 0;
        const next    = current + nudge;
        updateData[key] = CLAMP_STATS.has(key) ? Math.max(0, Math.min(100, next)) : Math.max(0, next);
      }

      // Trait JSONB merges
      const currentTraits = (p.traits as Record<string, number>) ?? {};
      const newTraits: Record<string, number> = {};

      for (const [attr, val] of Object.entries(traitSets)) {
        newTraits[attr] = Math.max(0, Math.min(100, val));
      }
      for (const [attr, nudge] of Object.entries(traitNudges)) {
        newTraits[attr] = Math.max(0, Math.min(100, (currentTraits[attr] ?? 50) + nudge));
      }

      if (Object.keys(newTraits).length > 0) {
        updateData.traits = { ...currentTraits, ...newTraits };
      }

      // Record what was actually applied
      const appliedDelta: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(updateData)) {
        if (key !== 'traits') appliedDelta[key] = val;
      }
      if (Object.keys(newTraits).length > 0) appliedDelta.traits = newTraits;

      ops.push(
        prisma.person.update({
          where: { id: p.id },
          data:  updateData as Prisma.PersonUpdateInput,
        }),
        prisma.memoryBank.create({
          data: {
            person_id:       p.id,
            event_summary,
            emotional_impact: emotional_impact as import('@prisma/client').EmotionalImpact,
            delta_applied:   appliedDelta as Prisma.InputJsonValue,
            tone:            resolvedTone,
            timestamp:       new Date(),
          },
        }),
      );
    }

    await prisma.$transaction(ops);
    affected += persons.length;
  }

  return {
    matched:                ids.length,
    affected,
    memory_entries_created: affected,
  };
}

function opToSql(op: string): string {
  switch (op) {
    case 'lt':  return '<';
    case 'lte': return '<=';
    case 'gt':  return '>';
    case 'gte': return '>=';
    default: throw new Error(`Unknown op: ${op}`);
  }
}

function pgIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function buildSelectForNudge(
  scalarNudges: Record<string, number>,
  traitNudges:  Record<string, number>,
): Record<string, boolean> {
  const select: Record<string, boolean> = { id: true };
  for (const key of Object.keys(scalarNudges)) select[key] = true;
  if (Object.keys(traitNudges).length > 0) select.traits = true;
  return select;
}

// --------------- Helpers ---------------

/** Strip undefined keys so Prisma doesn't overwrite fields with null */
function buildUpdatePayload(delta: PersonDelta): Prisma.PersonUpdateInput {
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(delta)) {
    if (value !== undefined) payload[key] = value;
  }
  return payload as Prisma.PersonUpdateInput;
}

function mapPerson(p: Awaited<ReturnType<typeof prisma.person.findUniqueOrThrow>>) {
  return {
    ...p,
    criminal_record: p.criminal_record as unknown as CriminalRecord[],
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  } as unknown as import('../types/person').Person;
}

function mapMemory(m: Awaited<ReturnType<typeof prisma.memoryBank.create>>) {
  return {
    ...m,
    delta_applied: m.delta_applied as PersonDelta,
    timestamp: m.timestamp.toISOString(),
  };
}
