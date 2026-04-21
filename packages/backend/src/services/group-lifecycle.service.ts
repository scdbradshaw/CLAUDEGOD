// ============================================================
// GROUP LIFECYCLE SERVICE — founder death + faction splits
// ============================================================
//
// Step 12: Religion-founder death handler
//   - When a person dies, every religion they founded dissolves.
//   - All living members get a "faith lost" traumatic memory.
//   - Religion row persists (is_active=false) for the archive.
//
// Step 13: Faction split logic
//   - On year boundaries, compare each member's alignment against the
//     current leader's alignment. Members whose lead exceeds
//     SPLIT_LEAD_BUFFER for SPLIT_PRESSURE_THRESHOLD consecutive ticks
//     split off and found a new faction.
//   - Split persists `split_from_id` so lineage is traceable.
// ============================================================

import type { Prisma } from '@prisma/client';
import type { VirusProfile } from '@civ-sim/shared';
import { computeAlignment, type PersonSnapshot } from './membership.service';
import { deriveVirusProfile, generateGroupName } from './group-formation.service';

// ── Tunables ────────────────────────────────────────────────
/** How much a member's alignment must exceed the leader's to accrue pressure. */
export const SPLIT_LEAD_BUFFER = 0.10;
/** Consecutive year-boundary ticks of sustained lead before a split fires. */
export const SPLIT_PRESSURE_THRESHOLD = 10;
/** Faith-lost memory parameters. */
const FAITH_LOST_MAGNITUDE = 0.8;

// ── Step 12: Founder death ──────────────────────────────────

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

/**
 * Dissolve every active religion founded by `personId` and write faith-lost
 * memories for every member (including the dying founder themselves —
 * their memory row cascades when the person is deleted, which is fine).
 *
 * Must be called BEFORE the person is deleted, so we can still read the
 * founder relation and write memories keyed on members.
 */
export async function handlePersonDeath(
  tx:          Prisma.TransactionClient,
  personId:    string,
  personName:  string,
  currentYear: number,
): Promise<ReligionDissolveResult[]> {
  const religions = await tx.religion.findMany({
    where: { founder_id: personId, is_active: true },
    select: {
      id:   true,
      name: true,
      memberships: { select: { person_id: true } },
    },
  });

  if (religions.length === 0) return [];

  const results: ReligionDissolveResult[] = [];

  for (const religion of religions) {
    // Mark the religion dissolved
    await tx.religion.update({
      where: { id: religion.id },
      data:  {
        is_active:        false,
        dissolved_year:   currentYear,
        dissolved_reason: 'founder_death',
      },
    });

    // Write faith-lost memories for every member who is not the founder
    // (the founder is about to be deleted; their memories cascade anyway).
    const otherMembers = religion.memberships.filter(m => m.person_id !== personId);
    if (otherMembers.length > 0) {
      await tx.memoryBank.createMany({
        data: otherMembers.map(m => ({
          person_id:        m.person_id,
          event_summary:    `${religion.name} dissolved when ${personName} died. Faith shaken.`,
          emotional_impact: 'traumatic' as const,
          delta_applied:    {} as Prisma.InputJsonValue,
          magnitude:        FAITH_LOST_MAGNITUDE,
          counterparty_id:  personId,
          world_year:       currentYear,
          tone:             'epic' as const,
        })),
      });
    }

    results.push({
      religion_id:   religion.id,
      religion_name: religion.name,
      members_lost:  religion.memberships.length,
    });
  }

  return results;
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
