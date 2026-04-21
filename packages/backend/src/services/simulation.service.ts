// ============================================================
// SIMULATION SERVICE
// All character mutations flow through here.
// ============================================================

import { Prisma } from '@prisma/client';
import prisma from '../db/client';
import type {
  PersonDelta,
  MutationResult,
  EmotionalImpact,
  CriminalRecord,
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
  const clampedStats = [
    'health', 'morality', 'happiness', 'reputation', 'influence', 'intelligence',
  ] as const;

  for (const stat of clampedStats) {
    if (result[stat] !== undefined) {
      const base = (current[stat] as number) ?? 50;
      // Delta values are absolute when they come from God Mode,
      // but relative when they come from simulation events.
      // Here we treat incoming values as the new absolute value.
      result[stat] = Math.max(0, Math.min(100, result[stat] as number));
    }
  }

  // Age can only increase via simulation (not force)
  if (result.age !== undefined && (current.age as number) > (result.age as number)) {
    result.age = current.age as number;
  }

  // Wealth floor at 0 for normal simulation
  if (result.wealth !== undefined) {
    result.wealth = Math.max(0, result.wealth as number);
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
}

/**
 * Apply a PersonDelta to a character and log the change to their Memory Bank.
 * Returns the updated person and the new memory entry.
 */
export async function applyDelta(opts: ApplyDeltaOptions): Promise<MutationResult> {
  const { personId, delta, event_summary, emotional_impact, force = false } = opts;

  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });

  // Apply world rules unless this is a God Mode override
  const sanitizedDelta = force
    ? delta
    : applySimulationRules(person as unknown as Record<string, unknown>, delta);

  // Build the Prisma update payload (only defined keys)
  const updateData = buildUpdatePayload(sanitizedDelta);

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
): Promise<MutationResult> {
  const person = await prisma.person.findUniqueOrThrow({ where: { id: personId } });
  const existing = person.criminal_record as CriminalRecord[];

  const updated = [...existing, record];

  const [updatedPerson, memoryEntry] = await prisma.$transaction([
    prisma.person.update({
      where: { id: personId },
      data: { criminal_record: updated as Prisma.InputJsonValue },
    }),
    prisma.memoryBank.create({
      data: {
        person_id:       personId,
        event_summary,
        emotional_impact: 'negative',
        delta_applied:   { criminal_record: [record] } as Prisma.InputJsonValue,
        timestamp:       new Date(),
      },
    }),
  ]);

  return {
    person:       mapPerson(updatedPerson),
    memory_entry: mapMemory(memoryEntry),
  };
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
    criminal_record: p.criminal_record as CriminalRecord[],
    created_at: p.created_at.toISOString(),
    updated_at: p.updated_at.toISOString(),
  };
}

function mapMemory(m: Awaited<ReturnType<typeof prisma.memoryBank.create>>) {
  return {
    ...m,
    delta_applied: m.delta_applied as PersonDelta,
    timestamp: m.timestamp.toISOString(),
  };
}
