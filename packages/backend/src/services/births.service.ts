// ============================================================
// BIRTHS SERVICE — Round 2
// ------------------------------------------------------------
// Resolves Pregnancy rows whose due_tick has arrived. Each resolution:
//   1. Loads both parents (skip if either has died since conception).
//   2. Rolls a child via generateChildCharacter (50/50 trait inheritance
//      with ±BIRTH_TRAIT_VARIANCE, Mixed race when parents differ).
//   3. Picks the child's inherited religion via pickChildReligion —
//      scores each parent's religion virus_profile against the child's
//      fresh traits and takes the better fit.
//   4. Persists the child Person, writes literary-tone birth memories on
//      both parents, creates FAMILY inner-circle links both directions.
//   5. Marks the pregnancy resolved with child_id set.
//
// Called on the year-boundary by the tick route, in its own transaction
// per birth so a single failure doesn't abort the whole year.
// ============================================================

import { Prisma, Tone } from '@prisma/client';
import prisma from '../db/client';
import {
  generateChildCharacter,
  pickChildReligion,
  type ParentSnapshot,
} from './character-gen.service';
import { writeMemoriesBatch, type MemoryWriteInput } from './memory.service';

export interface BirthEvent {
  pregnancy_id: string;
  child_id:     string;
  child_name:   string;
  parent_a_id:  string;
  parent_b_id:  string;
}

/**
 * Load all religions active in a world into a map keyed by name so
 * `pickChildReligion` can score each parent's religion by fit.
 */
async function loadReligionFitMap(
  worldId: string,
): Promise<Map<string, { profile: Record<string, { min?: number; max?: number }>; tolerance: number }>> {
  const religions = await prisma.religion.findMany({
    where:  { world_id: worldId, is_active: true },
    select: { name: true, virus_profile: true, tolerance: true },
  });
  const map = new Map<string, { profile: Record<string, { min?: number; max?: number }>; tolerance: number }>();
  for (const r of religions) {
    map.set(r.name, {
      profile:   (r.virus_profile as unknown as Record<string, { min?: number; max?: number }>) ?? {},
      tolerance: r.tolerance,
    });
  }
  return map;
}

/**
 * Resolve all due pregnancies in the given world. Runs each birth in its
 * own transaction — one stillbirth (missing parent, e.g.) doesn't take the
 * rest down.
 */
export async function processBirths(
  worldId:       string,
  currentTick:   number,
  worldYear:     number,
  worldGlobalTraits: Record<string, number>,
): Promise<BirthEvent[]> {
  const due = await prisma.pregnancy.findMany({
    where:  { world_id: worldId, resolved: false, due_tick: { lte: currentTick } },
    select: { id: true, parent_a_id: true, parent_b_id: true },
  });
  if (due.length === 0) return [];

  const religionFit = await loadReligionFitMap(worldId);
  const births: BirthEvent[] = [];

  for (const preg of due) {
    try {
      const event = await prisma.$transaction(async (tx) => {
        // Both parents must still be alive. If either is gone, mark the
        // pregnancy resolved without a child — the row stays in the archive
        // so the UI can still surface "lost pregnancy" later if we want.
        const parents = await tx.person.findMany({
          where:  { id: { in: [preg.parent_a_id, preg.parent_b_id] }, health: { gt: 0 } },
          select: {
            id: true, name: true, race: true, religion: true, traits: true, age: true,
          },
        });
        if (parents.length < 2) {
          await tx.pregnancy.update({
            where: { id: preg.id },
            data:  { resolved: true },
          });
          return null;
        }

        // Preserve the A/B parent ordering from the pregnancy row.
        const a = parents.find(p => p.id === preg.parent_a_id)!;
        const b = parents.find(p => p.id === preg.parent_b_id)!;
        const snapA: ParentSnapshot = {
          id: a.id, race: a.race, religion: a.religion,
          traits: (a.traits ?? {}) as Record<string, number>,
        };
        const snapB: ParentSnapshot = {
          id: b.id, race: b.race, religion: b.religion,
          traits: (b.traits ?? {}) as Record<string, number>,
        };

        // Roll the child's traits / appearance / demographics, then pick
        // the religion whose virus profile the child best fits.
        const draft = generateChildCharacter(snapA, snapB, 'None', worldGlobalTraits);
        const religion = pickChildReligion(draft.traits, snapA, snapB, religionFit);
        draft.religion = religion;

        const child = await tx.person.create({
          data: {
            name:                draft.name,
            sexuality:           draft.sexuality,
            gender:              draft.gender,
            race:                draft.race,
            occupation:          draft.occupation,
            age:                 draft.age,
            death_age:           draft.death_age,
            relationship_status: draft.relationship_status,
            religion:            draft.religion,
            criminal_record:     draft.criminal_record as unknown as Prisma.InputJsonValue,
            health:              draft.health,
            physical_appearance: draft.physical_appearance,
            wealth:              draft.wealth,
            traits:              draft.traits as unknown as Prisma.InputJsonValue,
            global_scores:       draft.global_scores as unknown as Prisma.InputJsonValue,
            world_id:            worldId,
            parent_a_id:         a.id,
            parent_b_id:         b.id,
          },
          select: { id: true, name: true },
        });

        // Auto-create the four family inner-circle edges (parent→child and
        // child→parent, both directions). skipDuplicates guards against a
        // pre-existing edge from some earlier mechanic.
        await tx.innerCircleLink.createMany({
          data: [
            { owner_id: a.id,     target_id: child.id, relation_type: 'child',  bond_strength: 85 },
            { owner_id: b.id,     target_id: child.id, relation_type: 'child',  bond_strength: 85 },
            { owner_id: child.id, target_id: a.id,     relation_type: 'parent', bond_strength: 85 },
            { owner_id: child.id, target_id: b.id,     relation_type: 'parent', bond_strength: 85 },
          ],
          skipDuplicates: true,
        });

        const memories: MemoryWriteInput[] = [
          {
            personId:        a.id,
            eventSummary:    `Welcomed a child, ${child.name}, with ${b.name}.`,
            emotionalImpact: 'euphoric',
            deltaApplied:    { kind: 'birth', child_id: child.id },
            magnitude:       0.9,
            counterpartyId:  b.id,
            worldYear,
            tone:            Tone.literary,
            ageAtEvent:      a.age,
            eventKind:       'birth',
          },
          {
            personId:        b.id,
            eventSummary:    `Welcomed a child, ${child.name}, with ${a.name}.`,
            emotionalImpact: 'euphoric',
            deltaApplied:    { kind: 'birth', child_id: child.id },
            magnitude:       0.9,
            counterpartyId:  a.id,
            worldYear,
            tone:            Tone.literary,
            ageAtEvent:      b.age,
            eventKind:       'birth',
          },
        ];
        await writeMemoriesBatch(tx, memories);

        await tx.pregnancy.update({
          where: { id: preg.id },
          data:  { resolved: true, child_id: child.id },
        });

        return {
          pregnancy_id: preg.id,
          child_id:     child.id,
          child_name:   child.name,
          parent_a_id:  a.id,
          parent_b_id:  b.id,
        };
      });
      if (event) births.push(event);
    } catch (err) {
      // One bad row shouldn't kill the whole births phase — log and move on.
      // eslint-disable-next-line no-console
      console.error('[births] failed to resolve pregnancy', preg.id, err);
    }
  }

  return births;
}
