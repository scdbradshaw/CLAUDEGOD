// Memory service (Phase 6).
//
// Thin DB wrapper around `engine/memory.ts` + `engine/decade-compression.ts`.
// Keeps the year-pipeline call sites short.

import { Prisma, type PrismaClient } from '@prisma/client';
import type { Memory } from '@claude-god/shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { addMemory } from '../engine/memory';
import { compressDecade } from '../engine/decade-compression';

/**
 * Append `entry` to a person's recent_memories with weight-FIFO eviction.
 * Use the Tx variant inside `runYearPhase`.
 */
export async function appendMemory(
  personId: string,
  entry: Memory,
  prisma: PrismaClient = defaultPrisma,
): Promise<void> {
  return appendMemoryTx(personId, entry, prisma);
}

export async function appendMemoryTx(
  personId: string,
  entry: Memory,
  tx: PrismaClient | Prisma.TransactionClient,
): Promise<void> {
  const p = await tx.person.findUnique({
    where: { id: personId },
    select: { recent_memories: true },
  });
  if (!p) return;
  const buf = (Array.isArray(p.recent_memories) ? p.recent_memories : []) as unknown as Memory[];
  const next = addMemory(buf, entry);
  await tx.person.update({
    where: { id: personId },
    data: { recent_memories: next as unknown as Prisma.InputJsonValue },
  });
}

/**
 * Run decade compression for every alive person whose post-aging age is a
 * multiple of 10. Inserts a LifeDecadeSummary row per person and trims their
 * buffer.
 */
export async function runDecadeCompressionTx(
  worldId: string,
  year: number,
  tx: PrismaClient | Prisma.TransactionClient,
): Promise<{ summaries_written: number }> {
  // Filter eligibility (age > 0 && age % 10 == 0) at the DB to keep payload small.
  // Postgres doesn't support `age % 10` via Prisma's where, so do it in memory
  // but only after a slim findMany of {id, age} would still scan all alive.
  // Cheaper: select only the fields we need.
  const candidates = await tx.person.findMany({
    where: { world_id: worldId, is_alive: true },
    select: { id: true, age: true, recent_memories: true },
  });

  const eligible = candidates.filter((p) => p.age > 0 && p.age % 10 === 0);
  if (eligible.length === 0) return { summaries_written: 0 };

  // Bulk-fetch the most recent prior summary per eligible person in one query.
  // ORDER BY person_id, decade_start_year DESC then take the first per group
  // in JS — Prisma lacks DISTINCT ON support cleanly.
  const eligibleIds = eligible.map((p) => p.id);
  const priorRows = await tx.lifeDecadeSummary.findMany({
    where: { person_id: { in: eligibleIds } },
    select: { id: true, person_id: true, decade_start_year: true },
    orderBy: [{ person_id: 'asc' }, { decade_start_year: 'desc' }],
  });
  const priorByPerson = new Map<string, string>();
  for (const r of priorRows) {
    if (!priorByPerson.has(r.person_id)) priorByPerson.set(r.person_id, r.id);
  }

  // Run pure compression in JS, accumulate inserts + buffer updates.
  const summaryInserts: Prisma.LifeDecadeSummaryCreateManyInput[] = [];
  const bufferUpdates: { id: string; bufJson: string }[] = [];
  for (const p of eligible) {
    const memories = (Array.isArray(p.recent_memories) ? p.recent_memories : []) as unknown as Memory[];
    const result = compressDecade({
      memories,
      age: p.age,
      year,
      prior_summary_id: priorByPerson.get(p.id) ?? null,
    });
    if (!result.triggered || !result.summary) continue;
    summaryInserts.push({
      person_id: p.id,
      decade_start_year: result.summary.decade_start_year,
      ranked_memories: result.summary.ranked_memories as unknown as Prisma.InputJsonValue,
      prior_summary_id: result.summary.prior_summary_id,
    });
    bufferUpdates.push({ id: p.id, bufJson: JSON.stringify(result.buffer) });
  }

  if (summaryInserts.length === 0) return { summaries_written: 0 };

  // One bulk INSERT for all new summaries, one bulk UPDATE FROM VALUES for
  // each affected person's recent_memories.
  await tx.lifeDecadeSummary.createMany({ data: summaryInserts });
  const rows = bufferUpdates.map(
    (u) => Prisma.sql`(${u.id}::text, ${u.bufJson}::jsonb)`,
  );
  await tx.$executeRaw`
    UPDATE "Person" AS p
    SET recent_memories = v.mem
    FROM (VALUES ${Prisma.join(rows)}) AS v(id, mem)
    WHERE p.id = v.id
  `;
  return { summaries_written: summaryInserts.length };
}
