// Relationship service (Phase 6 — DESIGN.md §5.5).
//
// Apply a bond plan against the database: insert/update the new bond,
// delete the evicted bond (if any), and write a "drifted apart" memory
// entry on the owner side.

import type { Prisma, PrismaClient, Relationship } from '@prisma/client';
import type { Memory, RelationshipKind } from '@claude-god/shared';
import { prisma as defaultPrisma } from '../lib/prisma';
import { planAddBond, type BondRow } from '../engine/relationships';
import { appendMemoryTx } from './memory.service';

export interface SetBondInput {
  owner_id: string;
  target_id: string;
  kind: RelationshipKind;
  strength: number; // 0–100
  year: number;
}

export type SetBondResult =
  | { status: 'added'; bond: Relationship; evicted: Relationship | null }
  | { status: 'updated'; bond: Relationship }
  | { status: 'rejected'; reason: 'weaker_than_existing_cap' };

export async function setBond(
  input: SetBondInput,
  prisma: PrismaClient = defaultPrisma,
): Promise<SetBondResult> {
  return prisma.$transaction((tx) => setBondTx(input, tx));
}

export async function setBondTx(
  input: SetBondInput,
  tx: PrismaClient | Prisma.TransactionClient,
): Promise<SetBondResult> {
  if (input.owner_id === input.target_id) {
    throw new Error('self_bond_forbidden');
  }
  const existing = await tx.relationship.findMany({
    where: { owner_id: input.owner_id },
  });
  const candidate: BondRow = {
    target_id: input.target_id,
    kind: input.kind,
    strength: input.strength,
    set_year: input.year,
  };
  const plan = planAddBond(
    existing.map(
      (r): BondRow => ({
        id: r.id,
        target_id: r.target_id,
        kind: r.kind as RelationshipKind,
        strength: r.strength,
        set_year: r.set_year,
      }),
    ),
    candidate,
  );

  if (!plan.added) {
    return { status: 'rejected', reason: 'weaker_than_existing_cap' };
  }

  // Update vs. insert.
  const dup = existing.find(
    (r) => r.target_id === input.target_id && r.kind === input.kind,
  );
  if (dup) {
    const updated = await tx.relationship.update({
      where: { id: dup.id },
      data: { strength: input.strength, set_year: input.year },
    });
    return { status: 'updated', bond: updated };
  }

  // If overflow, delete the evicted row + emit a "drifted apart" memory.
  let evictedRow: Relationship | null = null;
  if (plan.evicted?.id) {
    evictedRow = await tx.relationship.delete({ where: { id: plan.evicted.id } });
    const drifted: Memory = {
      year: input.year,
      kind: 'drifted-apart',
      summary: `drifted apart from a former ${plan.evicted.kind}`,
      magnitude: 0.15,
      counterparty_id: plan.evicted.target_id,
      tone: 'neutral',
    };
    await appendMemoryTx(input.owner_id, drifted, tx);
  }

  const created = await tx.relationship.create({
    data: {
      owner_id: input.owner_id,
      target_id: input.target_id,
      kind: input.kind,
      strength: input.strength,
      set_year: input.year,
    },
  });
  return { status: 'added', bond: created, evicted: evictedRow };
}

export async function listBondsForPerson(
  personId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<Relationship[]> {
  return prisma.relationship.findMany({
    where: { owner_id: personId },
    orderBy: { strength: 'desc' },
  });
}
