// Phase 13a — Inheritance service (§7.4).
//
// Looks up heir candidates for a dying real person, applies the planner from
// `engine/inheritance.ts`, and writes the transfers + heir memories. Called
// from `archiveAndDeleteTx` BEFORE the Person row is deleted (so spouse/parent
// FKs are still resolvable).

import type { Prisma, PrismaClient } from '@prisma/client';
import {
  planInheritance,
  type InheritanceTarget,
  type DecedentInfo,
} from '../engine/inheritance';
import { appendMemoryTx } from './memory.service';

/**
 * Resolve heir candidates and execute the inheritance plan for the dying
 * real person. Returns the transfer list (mostly for tests/diagnostics).
 *
 * Caller MUST invoke before `tx.person.delete`. No-op if wealth <= 0.
 */
export async function executeInheritanceTx(
  decedent_id: string,
  year: number,
  tx: Prisma.TransactionClient | PrismaClient,
): Promise<InheritanceTarget[]> {
  const decedent = await tx.person.findUnique({
    where: { id: decedent_id },
    select: {
      id: true,
      name: true,
      wealth: true,
      spouse_id: true,
      faction_id: true,
      religion_id: true,
      city_id: true,
    },
  });
  if (!decedent || decedent.wealth <= 0) return [];

  // 1. Living spouse?
  let spouse: { id: string } | null = null;
  if (decedent.spouse_id) {
    spouse = await tx.person.findFirst({
      where: { id: decedent.spouse_id, is_alive: true },
      select: { id: true },
    });
  }

  // 2. Eldest living child? (only checked if no spouse — micro-optimization)
  // Schema has `age` not `birth_year`; eldest = highest age.
  let eldestChild: { id: string } | null = null;
  if (!spouse) {
    eldestChild = await tx.person.findFirst({
      where: {
        is_alive: true,
        OR: [{ mother_id: decedent.id }, { father_id: decedent.id }],
      },
      orderBy: { age: 'desc' },
      select: { id: true },
    });
  }

  // 3/4/5. Active faction/religion (only checked if no person heir)
  let factionActive = false;
  let religionActive = false;
  if (!spouse && !eldestChild) {
    if (decedent.faction_id) {
      const f = await tx.group.findFirst({
        where: { id: decedent.faction_id, is_active: true },
        select: { id: true },
      });
      factionActive = !!f;
    }
    if (decedent.religion_id) {
      const r = await tx.group.findFirst({
        where: { id: decedent.religion_id, is_active: true },
        select: { id: true },
      });
      religionActive = !!r;
    }
  }

  const info: DecedentInfo = {
    id: decedent.id,
    wealth: decedent.wealth,
    faction_id: decedent.faction_id,
    religion_id: decedent.religion_id,
    city_id: decedent.city_id,
  };
  const plan = planInheritance(info, {
    spouse,
    eldest_child: eldestChild,
    faction_active: factionActive,
    religion_active: religionActive,
  });
  if (plan.length === 0) return [];

  // Execute transfers + heir memories.
  for (const target of plan) {
    if (target.kind === 'spouse' || target.kind === 'child') {
      await tx.person.update({
        where: { id: target.person_id },
        data: { wealth: { increment: target.amount } },
      });
      await appendMemoryTx(
        target.person_id,
        {
          year,
          kind: 'inheritance',
          summary: `inherited ${target.amount} from ${decedent.name}`,
          magnitude: 0.6,
          counterparty_id: decedent.id,
          tone: 'literary',
        },
        tx,
      );
    } else if (target.kind === 'faction' || target.kind === 'religion') {
      await tx.group.update({
        where: { id: target.group_id },
        data: { treasury: { increment: target.amount } },
      });
    } else {
      await tx.city.update({
        where: { id: target.city_id },
        data: { treasury: { increment: target.amount } },
      });
    }
  }

  // Zero out the decedent's wealth so the archive snapshot reflects the
  // post-transfer state and any later wealth-conservation invariant nets out.
  await tx.person.update({
    where: { id: decedent.id },
    data: { wealth: 0 },
  });

  return plan;
}
