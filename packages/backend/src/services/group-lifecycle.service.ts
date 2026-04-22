// ============================================================
// GROUP LIFECYCLE SERVICE — leader death, succession, splits
// ============================================================
//
// Round 4: Leader death handler with succession.
//   When a person dies who led a group (faction OR religion):
//     - Try to promote an heir from the living membership.
//     - Composite score = leadership + charisma + bond_to_dead.
//     - Below MIN_HEIR_COMPOSITE we fall back to dissolution.
//   Succession writes a `leader_succession` group memory and per-member
//   memories (literary tone, high weight) so the moment shows up in
//   chronicles even after the raw rows compress.
//
//   Religions previously dissolved unconditionally on founder death;
//   with Round 4 they track a separate `leader_id` and follow the same
//   succession-first / dissolve-fallback pipeline as factions.
//
// Step 13: Faction split logic.
//   On year boundaries, compare each member's alignment against the
//   current leader's alignment. Members whose lead exceeds
//   SPLIT_LEAD_BUFFER for SPLIT_PRESSURE_THRESHOLD consecutive ticks
//   split off and found a new faction. Persists split_from_id.
// ============================================================

import type { Prisma } from '@prisma/client';
import type { VirusProfile } from '@civ-sim/shared';
import { computeAlignment, type PersonSnapshot } from './membership.service';
import { deriveVirusProfile, generateGroupName } from './group-formation.service';
import { writeMemoriesBatch, writeGroupMemory } from './memory.service';

// ── Tunables ────────────────────────────────────────────────
/** How much a member's alignment must exceed the leader's to accrue pressure. */
export const SPLIT_LEAD_BUFFER = 0.10;
/** Consecutive year-boundary ticks of sustained lead before a split fires. */
export const SPLIT_PRESSURE_THRESHOLD = 10;
/** Faith-lost memory parameters. */
const FAITH_LOST_MAGNITUDE = 0.8;
/** Succession memory parameters — literary tone, high weight. */
const SUCCESSION_MAGNITUDE = 0.75;
/**
 * Minimum composite score (leadership + charisma + bond-to-dead) for an
 * heir to be considered worthy. Below this, the group dissolves because
 * nobody can carry the torch. Range: 0-300; 100 is "mediocre but alive".
 */
export const MIN_HEIR_COMPOSITE = 100;

// ── Step 12 / Round 4: Leader death ─────────────────────────

export interface FaithLostMemory {
  person_id:       string;
  event_summary:   string;
  emotional_impact: 'traumatic';
  magnitude:       number;
  counterparty_id: string | null;
}

export interface ReligionDissolveResult {
  religion_id:   string;
  religion_name: string;
  members_lost:  number;
}

export interface FactionDissolveResult {
  faction_id:   string;
  faction_name: string;
  members_lost: number;
}

export interface SuccessionResult {
  group_type:      'religion' | 'faction';
  group_id:        string;
  group_name:      string;
  predecessor_id:  string;
  heir_id:         string;
  heir_name:       string;
  composite_score: number;
}

export interface GroupDeathOutcome {
  religion_dissolves:   ReligionDissolveResult[];
  religion_successions: SuccessionResult[];
  faction_dissolves:    FactionDissolveResult[];
  faction_successions:  SuccessionResult[];
}

interface HeirPick {
  person_id:  string;
  name:       string;
  composite:  number;
  leadership: number;
  charisma:   number;
  bond:       number;
}

/**
 * Among the living members of a group (excluding the dying leader),
 * pick the member with the highest composite = leadership + charisma +
 * bond_to_dead. Returns null when no candidate clears MIN_HEIR_COMPOSITE
 * — the caller should then dissolve the group.
 */
async function pickHeir(
  tx:        Prisma.TransactionClient,
  deadId:    string,
  memberIds: string[],
): Promise<HeirPick | null> {
  const candidateIds = memberIds.filter(id => id !== deadId);
  if (candidateIds.length === 0) return null;

  const persons = await tx.person.findMany({
    where:  { id: { in: candidateIds } },
    select: { id: true, name: true, traits: true, health: true },
  });
  const alive = persons.filter(p => p.health > 0);
  if (alive.length === 0) return null;

  const bonds = await tx.innerCircleLink.findMany({
    where:  { owner_id: { in: alive.map(p => p.id) }, target_id: deadId },
    select: { owner_id: true, bond_strength: true },
  });
  const bondByOwner = new Map<string, number>();
  for (const b of bonds) {
    const prev = bondByOwner.get(b.owner_id) ?? 0;
    if (b.bond_strength > prev) bondByOwner.set(b.owner_id, b.bond_strength);
  }

  let best: HeirPick | null = null;
  for (const p of alive) {
    const traits     = (p.traits ?? {}) as Record<string, number>;
    const leadership = typeof traits.leadership === 'number' ? traits.leadership : 0;
    const charisma   = typeof traits.charisma   === 'number' ? traits.charisma   : 0;
    const bond       = bondByOwner.get(p.id) ?? 0;
    const composite  = leadership + charisma + bond;
    if (!best || composite > best.composite) {
      best = { person_id: p.id, name: p.name, composite, leadership, charisma, bond };
    }
  }

  if (!best || best.composite < MIN_HEIR_COMPOSITE) return null;
  return best;
}

/**
 * Handle a person's death for group-lifecycle purposes. For every
 * active religion or faction the person was currently leading, try
 * to promote an heir; on failure, dissolve with faith-lost memories
 * for surviving members.
 *
 * Must be called BEFORE the person is deleted, so we can still read
 * the membership relation and write memories keyed off members.
 */
export async function handlePersonDeath(
  tx:          Prisma.TransactionClient,
  personId:    string,
  personName:  string,
  currentYear: number,
  worldId?:    string,
): Promise<GroupDeathOutcome> {
  const outcome: GroupDeathOutcome = {
    religion_dissolves:   [],
    religion_successions: [],
    faction_dissolves:    [],
    faction_successions:  [],
  };

  // ── Religions led by the dying person ───────────────────
  const religions = await tx.religion.findMany({
    where: { leader_id: personId, is_active: true },
    select: {
      id: true, name: true, world_id: true,
      memberships: { select: { person_id: true } },
    },
  });

  for (const religion of religions) {
    const memberIds = religion.memberships.map(m => m.person_id);
    const heir      = await pickHeir(tx, personId, memberIds);
    const effectiveWorldId = worldId ?? religion.world_id;

    if (heir) {
      await tx.religion.update({
        where: { id: religion.id },
        data:  { leader_id: heir.person_id },
      });

      await writeGroupMemory(tx, {
        groupType:    'religion',
        groupId:      religion.id,
        worldId:      effectiveWorldId,
        eventKind:    'leader_succession',
        eventSummary: `${heir.name} took up the mantle of ${religion.name} after ${personName} died.`,
        worldYear:    currentYear,
        tone:         'epic',
        weight:       90,
        payload: {
          predecessor_id:  personId,
          heir_id:         heir.person_id,
          composite_score: heir.composite,
        },
      });

      // Heir gets a first-person succession memory
      await writeMemoriesBatch(tx, [{
        personId:        heir.person_id,
        eventSummary:    `Took up the mantle of ${religion.name} after ${personName} died.`,
        emotionalImpact: 'positive' as const,
        deltaApplied:    {},
        magnitude:       SUCCESSION_MAGNITUDE,
        counterpartyId:  personId,
        worldYear:       currentYear,
        tone:            'epic' as const,
        eventKind:       'group_leader_death',
      }]);

      // Everyone else gets a witness-voice entry
      const others = memberIds.filter(id => id !== personId && id !== heir.person_id);
      if (others.length > 0) {
        await writeMemoriesBatch(tx, others.map(id => ({
          personId:        id,
          eventSummary:    `${heir.name} rose to lead ${religion.name} after ${personName} passed. The faith continues.`,
          emotionalImpact: 'positive' as const,
          deltaApplied:    {},
          magnitude:       SUCCESSION_MAGNITUDE,
          counterpartyId:  personId,
          worldYear:       currentYear,
          tone:            'epic' as const,
          eventKind:       'group_leader_death',
        })));
      }

      outcome.religion_successions.push({
        group_type:      'religion',
        group_id:        religion.id,
        group_name:      religion.name,
        predecessor_id:  personId,
        heir_id:         heir.person_id,
        heir_name:       heir.name,
        composite_score: heir.composite,
      });
    } else {
      await tx.religion.update({
        where: { id: religion.id },
        data:  {
          is_active:        false,
          dissolved_year:   currentYear,
          dissolved_reason: 'leader_void',
        },
      });

      await writeGroupMemory(tx, {
        groupType:    'religion',
        groupId:      religion.id,
        worldId:      effectiveWorldId,
        eventKind:    'dissolved_leader_void',
        eventSummary: `${religion.name} dissolved when its leader ${personName} died — no worthy heir remained.`,
        worldYear:    currentYear,
        tone:         'epic',
        weight:       95,
        payload:      { predecessor_id: personId, members_lost: memberIds.length },
      });

      const others = memberIds.filter(id => id !== personId);
      if (others.length > 0) {
        await writeMemoriesBatch(tx, others.map((mid) => ({
          personId:        mid,
          eventSummary:    `${religion.name} dissolved when ${personName} died. Faith shaken.`,
          emotionalImpact: 'traumatic' as const,
          deltaApplied:    {},
          magnitude:       FAITH_LOST_MAGNITUDE,
          counterpartyId:  personId,
          worldYear:       currentYear,
          tone:            'epic' as const,
          eventKind:       'group_left',
        })));
      }

      outcome.religion_dissolves.push({
        religion_id:   religion.id,
        religion_name: religion.name,
        members_lost:  memberIds.length,
      });
    }
  }

  // ── Factions led by the dying person ────────────────────
  const factions = await tx.faction.findMany({
    where: { leader_id: personId, is_active: true },
    select: {
      id: true, name: true, world_id: true,
      memberships: { select: { person_id: true } },
    },
  });

  for (const faction of factions) {
    const memberIds = faction.memberships.map(m => m.person_id);
    const heir      = await pickHeir(tx, personId, memberIds);
    const effectiveWorldId = worldId ?? faction.world_id;

    if (heir) {
      await tx.faction.update({
        where: { id: faction.id },
        data:  { leader_id: heir.person_id },
      });

      await writeGroupMemory(tx, {
        groupType:    'faction',
        groupId:      faction.id,
        worldId:      effectiveWorldId,
        eventKind:    'leader_succession',
        eventSummary: `${heir.name} took up the banner of ${faction.name} after ${personName} died.`,
        worldYear:    currentYear,
        tone:         'epic',
        weight:       90,
        payload: {
          predecessor_id:  personId,
          heir_id:         heir.person_id,
          composite_score: heir.composite,
        },
      });

      await writeMemoriesBatch(tx, [{
        personId:        heir.person_id,
        eventSummary:    `Took up the banner of ${faction.name} after ${personName} died.`,
        emotionalImpact: 'positive' as const,
        deltaApplied:    {},
        magnitude:       SUCCESSION_MAGNITUDE,
        counterpartyId:  personId,
        worldYear:       currentYear,
        tone:            'epic' as const,
        eventKind:       'group_leader_death',
      }]);

      const others = memberIds.filter(id => id !== personId && id !== heir.person_id);
      if (others.length > 0) {
        await writeMemoriesBatch(tx, others.map(id => ({
          personId:        id,
          eventSummary:    `${heir.name} rose to lead ${faction.name} after ${personName} passed. The banner endures.`,
          emotionalImpact: 'positive' as const,
          deltaApplied:    {},
          magnitude:       SUCCESSION_MAGNITUDE,
          counterpartyId:  personId,
          worldYear:       currentYear,
          tone:            'epic' as const,
          eventKind:       'group_leader_death',
        })));
      }

      outcome.faction_successions.push({
        group_type:      'faction',
        group_id:        faction.id,
        group_name:      faction.name,
        predecessor_id:  personId,
        heir_id:         heir.person_id,
        heir_name:       heir.name,
        composite_score: heir.composite,
      });
    } else {
      await tx.faction.update({
        where: { id: faction.id },
        data:  {
          is_active:        false,
          dissolved_year:   currentYear,
          dissolved_reason: 'leader_void',
        },
      });

      await writeGroupMemory(tx, {
        groupType:    'faction',
        groupId:      faction.id,
        worldId:      effectiveWorldId,
        eventKind:    'dissolved_leader_void',
        eventSummary: `${faction.name} dissolved when its leader ${personName} died — no heir could raise the banner.`,
        worldYear:    currentYear,
        tone:         'epic',
        weight:       95,
        payload:      { predecessor_id: personId, members_lost: memberIds.length },
      });

      const others = memberIds.filter(id => id !== personId);
      if (others.length > 0) {
        await writeMemoriesBatch(tx, others.map((mid) => ({
          personId:        mid,
          eventSummary:    `${faction.name} dissolved when ${personName} died. The banner fell.`,
          emotionalImpact: 'traumatic' as const,
          deltaApplied:    {},
          magnitude:       FAITH_LOST_MAGNITUDE,
          counterpartyId:  personId,
          worldYear:       currentYear,
          tone:            'epic' as const,
          eventKind:       'group_left',
        })));
      }

      outcome.faction_dissolves.push({
        faction_id:   faction.id,
        faction_name: faction.name,
        members_lost: memberIds.length,
      });
    }
  }

  return outcome;
}

// ── Step 13: Faction splits ─────────────────────────────────

export interface FactionSplitResult {
  new_faction_id:    string;
  new_faction_name:  string;
  split_from_id:     string;
  new_leader_id:     string;
  profile_keys:      string[];
}

/**
 * For each active faction with a living leader:
 *   - Recompute leader's alignment against the faction profile.
 *   - For every member, compute alignment and compare to leader.
 *   - Members exceeding leader by SPLIT_LEAD_BUFFER accrue pressure;
 *     others reset to zero.
 *   - The first member to cross SPLIT_PRESSURE_THRESHOLD triggers a
 *     split: a new faction is founded, the splitter leaves the old one,
 *     and they are installed as leader of the new faction.
 *
 * Only runs on year-boundary ticks (caller's responsibility).
 */
export async function runFactionSplitCheck(
  tx:          Prisma.TransactionClient,
  persons:     Map<string, PersonSnapshot>,
  currentYear: number,
  worldId:     string,
): Promise<FactionSplitResult[]> {
  const factions = await tx.faction.findMany({
    where: { world_id: worldId, is_active: true, leader_id: { not: null } },
    select: {
      id: true, name: true, tolerance: true, virus_profile: true, leader_id: true,
      memberships: {
        select: { id: true, person_id: true, alignment: true, split_pressure_ticks: true },
      },
    },
  });

  const results: FactionSplitResult[] = [];

  for (const fac of factions) {
    if (!fac.leader_id) continue;
    const leader = persons.get(fac.leader_id);
    if (!leader) continue; // leader dead or missing — succession handled elsewhere
    const profile   = (fac.virus_profile ?? {}) as unknown as VirusProfile;
    const leaderAlign = computeAlignment(leader, profile, fac.tolerance);

    // Find the member with the most pressure after this tick. We process
    // at most one split per faction per year to keep churn readable.
    let splitter: {
      membership_id:     string;
      person_id:         string;
      alignment:         number;
      pressure:          number;
    } | null = null;

    for (const m of fac.memberships) {
      if (m.person_id === fac.leader_id) continue;
      const candidate = persons.get(m.person_id);
      if (!candidate) continue; // dead member — cascade will clean up
      const a = computeAlignment(candidate, profile, fac.tolerance);

      const leads = a > leaderAlign + SPLIT_LEAD_BUFFER;
      const newPressure = leads ? m.split_pressure_ticks + 1 : 0;

      if (newPressure !== m.split_pressure_ticks) {
        await tx.factionMembership.update({
          where: { id: m.id },
          data:  { split_pressure_ticks: newPressure, alignment: a },
        });
      }

      if (newPressure >= SPLIT_PRESSURE_THRESHOLD) {
        if (!splitter || newPressure > splitter.pressure) {
          splitter = {
            membership_id: m.id,
            person_id:     m.person_id,
            alignment:     a,
            pressure:      newPressure,
          };
        }
      }
    }

    if (!splitter) continue;

    // ── Execute the split ───────────────────────────────────
    const splitterSnap = persons.get(splitter.person_id)!;
    const newProfile   = deriveVirusProfile(splitterSnap);
    // Fall back to inheriting the parent profile if the splitter has
    // nothing distinctive — otherwise the new faction would be open to all.
    const effectiveProfile = Object.keys(newProfile).length > 0 ? newProfile : profile;

    const newFaction = await tx.faction.create({
      data: {
        name:          generateGroupName('faction'),
        founder_id:    splitter.person_id,
        leader_id:     splitter.person_id,
        origin:        'emergent',
        tolerance:     10,
        virus_profile: effectiveProfile as Prisma.InputJsonValue,
        founded_year:  currentYear,
        split_from_id: fac.id,
        world_id:      worldId,
      },
    });

    // Splitter leaves the old faction…
    await tx.factionMembership.delete({ where: { id: splitter.membership_id } });
    // …and founds the new one as first member.
    await tx.factionMembership.create({
      data: {
        faction_id:  newFaction.id,
        person_id:   splitter.person_id,
        joined_year: currentYear,
        alignment:   splitter.alignment,
      },
    });

    results.push({
      new_faction_id:   newFaction.id,
      new_faction_name: newFaction.name,
      split_from_id:    fac.id,
      new_leader_id:    splitter.person_id,
      profile_keys:     Object.keys(effectiveProfile),
    });
  }

  return results;
}
