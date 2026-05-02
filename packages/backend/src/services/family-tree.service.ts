// Phase 13a — Family tree (3 up, 3 down).
//
// BFS over both alive Person rows AND BiographyArchive entries (the dead).
// Returns up to FAMILY_MAX_GEN levels in each direction. Dead members carry
// a `died_year` so the UI renders a non-clickable label with the lifespan.

import type { PrismaClient } from '@prisma/client';
import { prisma as defaultPrisma } from '../lib/prisma';

const FAMILY_MAX_GEN = 3;

export interface FamilyMember {
  id: string;
  name: string;
  is_alive: boolean;
  /** Living: current age (we don't expose birth_year directly elsewhere).
   *  Dead: undefined (use died_year + age_at_demote). */
  age?: number;
  /** Set for dead members; year of removal from active sim. */
  died_year?: number;
  /** Age at death — captured in BiographyArchive.age_at_demote. */
  age_at_demote?: number;
}

export interface FamilyLevel {
  generation: number; // negative=ancestors, positive=descendants
  members: FamilyMember[];
}

export interface FamilyTree {
  ancestors: FamilyLevel[]; // generation -1, -2, -3
  descendants: FamilyLevel[]; // generation +1, +2, +3
}

interface ParentLookup {
  id: string;
  mother_id: string | null;
  father_id: string | null;
}

/** Public entry point. */
export async function getFamilyTree(
  personId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<FamilyTree | null> {
  const seed = await loadById(personId, prisma);
  if (!seed) return null;

  const ancestors = await walkAncestors(personId, prisma);
  const descendants = await walkDescendants(personId, seed.world_id, prisma);
  return { ancestors, descendants };
}

interface AnyPersonRow {
  id: string;
  name: string;
  is_alive: boolean;
  age?: number;
  died_year?: number;
  age_at_demote?: number;
  mother_id: string | null;
  father_id: string | null;
  world_id: string;
}

async function loadById(
  id: string,
  prisma: PrismaClient,
): Promise<AnyPersonRow | null> {
  const p = await prisma.person.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      age: true,
      mother_id: true,
      father_id: true,
      world_id: true,
    },
  });
  if (p) {
    return {
      id: p.id,
      name: p.name,
      is_alive: true,
      age: p.age,
      mother_id: p.mother_id,
      father_id: p.father_id,
      world_id: p.world_id,
    };
  }
  const arch = await prisma.biographyArchive.findUnique({
    where: { person_id: id },
    select: {
      person_id: true,
      name: true,
      age_at_demote: true,
      demote_year: true,
      mother_id: true,
      father_id: true,
      world_id: true,
    },
  });
  if (arch) {
    return {
      id: arch.person_id,
      name: arch.name,
      is_alive: false,
      died_year: arch.demote_year,
      age_at_demote: arch.age_at_demote,
      mother_id: arch.mother_id,
      father_id: arch.father_id,
      world_id: arch.world_id,
    };
  }
  return null;
}

async function loadManyById(
  ids: string[],
  prisma: PrismaClient,
): Promise<AnyPersonRow[]> {
  if (ids.length === 0) return [];
  const [alive, dead] = await Promise.all([
    prisma.person.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        age: true,
        mother_id: true,
        father_id: true,
        world_id: true,
      },
    }),
    prisma.biographyArchive.findMany({
      where: { person_id: { in: ids } },
      select: {
        person_id: true,
        name: true,
        age_at_demote: true,
        demote_year: true,
        mother_id: true,
        father_id: true,
        world_id: true,
      },
    }),
  ]);
  const out: AnyPersonRow[] = [];
  for (const p of alive) {
    out.push({
      id: p.id,
      name: p.name,
      is_alive: true,
      age: p.age,
      mother_id: p.mother_id,
      father_id: p.father_id,
      world_id: p.world_id,
    });
  }
  const aliveSet = new Set(alive.map((p) => p.id));
  for (const a of dead) {
    if (aliveSet.has(a.person_id)) continue; // person somehow both alive + archived — prefer alive
    out.push({
      id: a.person_id,
      name: a.name,
      is_alive: false,
      died_year: a.demote_year,
      age_at_demote: a.age_at_demote,
      mother_id: a.mother_id,
      father_id: a.father_id,
      world_id: a.world_id,
    });
  }
  return out;
}

function toMember(row: AnyPersonRow): FamilyMember {
  return {
    id: row.id,
    name: row.name,
    is_alive: row.is_alive,
    age: row.age,
    died_year: row.died_year,
    age_at_demote: row.age_at_demote,
  };
}

async function walkAncestors(
  rootId: string,
  prisma: PrismaClient,
): Promise<FamilyLevel[]> {
  const levels: FamilyLevel[] = [];
  let frontier: ParentLookup[] = [];
  const root = await loadById(rootId, prisma);
  if (root) frontier = [{ id: root.id, mother_id: root.mother_id, father_id: root.father_id }];

  for (let g = 1; g <= FAMILY_MAX_GEN; g++) {
    const parentIds = new Set<string>();
    for (const f of frontier) {
      if (f.mother_id) parentIds.add(f.mother_id);
      if (f.father_id) parentIds.add(f.father_id);
    }
    if (parentIds.size === 0) break;
    const parents = await loadManyById([...parentIds], prisma);
    if (parents.length === 0) break;
    levels.push({ generation: -g, members: parents.map(toMember) });
    frontier = parents.map((p) => ({
      id: p.id,
      mother_id: p.mother_id,
      father_id: p.father_id,
    }));
  }
  return levels;
}

async function walkDescendants(
  rootId: string,
  worldId: string,
  prisma: PrismaClient,
): Promise<FamilyLevel[]> {
  const levels: FamilyLevel[] = [];
  let frontierIds: string[] = [rootId];
  const visited = new Set<string>([rootId]);

  for (let g = 1; g <= FAMILY_MAX_GEN; g++) {
    if (frontierIds.length === 0) break;
    const idx = await childrenOf(frontierIds, worldId, prisma);
    if (idx.length === 0) break;
    const fresh = idx.filter((c) => !visited.has(c.id));
    if (fresh.length === 0) break;
    for (const c of fresh) visited.add(c.id);
    levels.push({ generation: g, members: fresh.map(toMember) });
    frontierIds = fresh.map((c) => c.id);
  }
  return levels;
}

async function childrenOf(
  parentIds: string[],
  worldId: string,
  prisma: PrismaClient,
): Promise<AnyPersonRow[]> {
  const [alive, dead] = await Promise.all([
    prisma.person.findMany({
      where: {
        world_id: worldId,
        OR: [
          { mother_id: { in: parentIds } },
          { father_id: { in: parentIds } },
        ],
      },
      select: {
        id: true,
        name: true,
        age: true,
        mother_id: true,
        father_id: true,
        world_id: true,
      },
    }),
    prisma.biographyArchive.findMany({
      where: {
        world_id: worldId,
        OR: [
          { mother_id: { in: parentIds } },
          { father_id: { in: parentIds } },
        ],
      },
      select: {
        person_id: true,
        name: true,
        age_at_demote: true,
        demote_year: true,
        mother_id: true,
        father_id: true,
        world_id: true,
      },
    }),
  ]);
  const out: AnyPersonRow[] = alive.map((p) => ({
    id: p.id,
    name: p.name,
    is_alive: true,
    age: p.age,
    mother_id: p.mother_id,
    father_id: p.father_id,
    world_id: p.world_id,
  }));
  const aliveSet = new Set(alive.map((p) => p.id));
  for (const a of dead) {
    if (aliveSet.has(a.person_id)) continue;
    out.push({
      id: a.person_id,
      name: a.name,
      is_alive: false,
      died_year: a.demote_year,
      age_at_demote: a.age_at_demote,
      mother_id: a.mother_id,
      father_id: a.father_id,
      world_id: a.world_id,
    });
  }
  return out;
}

