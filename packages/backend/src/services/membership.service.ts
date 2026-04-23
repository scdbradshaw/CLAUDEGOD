// ============================================================
// MEMBERSHIP SERVICE — viral join + drop-off engine
// ============================================================
//
// Groups (religions + factions) spread like viruses. Every interaction
// is a transmission event: if the antagonist is in a group and the
// subject's profile matches the group's virus_profile (within tolerance),
// the subject gets infected — they join.
//
// Each year boundary we also re-score every existing member's alignment
// against their group's profile. Anyone who drifts below MIN_ALIGNMENT_RETAIN
// falls out of the group.
//
// Unknown profile keys are silently skipped — same data-driven pattern
// used by the tick engine.
// ============================================================

import type { Prisma, PrismaClient } from '@prisma/client';
import type { VirusProfile } from '@civ-sim/shared';

// ── Tunables ────────────────────────────────────────────────
/** Fraction of profile keys that must fall inside the tolerance band
 *  for a subject to become infected / join a group. */
export const MIN_ALIGNMENT_JOIN = 0.75;
/** Members whose alignment falls below this at a year boundary leave
 *  the group. Kept lower than JOIN so churn isn't violent. */
export const MIN_ALIGNMENT_RETAIN = 0.40;

// ── Types ───────────────────────────────────────────────────
export type GroupKind = 'religion' | 'faction';

export interface GroupSnapshot {
  id:            string;
  name:          string;
  kind:          GroupKind;
  virus_profile: VirusProfile;
  tolerance:     number;
}

export interface PersonSnapshot {
  id:             string;
  traits:         Record<string, number>;
  global_scores:  Record<string, number>;
  /** Life/death pool column. 0 = dead. */
  current_health: number;
}

// ── Profile matching ────────────────────────────────────────

/**
 * Resolve a profile key against a person snapshot.
 *
 * Supported key shapes:
 *   - `<identity_attr>`            e.g. "charisma", "ambition"
 *   - `<force>.<child>`            e.g. "faith.devotion"
 *   - `current_health`               the life/death pool column
 * Returns undefined for unknown keys so the caller can skip silently.
 */
function resolveProfileValue(
  key:    string,
  person: PersonSnapshot,
): number | undefined {
  // Namespaced → global score (e.g. "faith.devotion")
  if (key.includes('.')) {
    return person.global_scores[key];
  }
  // current_health column (special-cased since it's not a trait key)
  if (key === 'current_health') return person.current_health;
  // Meta trait (body/mind/heart/drive attributes, 0-100)
  return person.traits[key];
}

/**
 * Compute an alignment score 0.0-1.0 for a person against a virus profile.
 *
 * - Keys the person has no value for are dropped from the denominator
 *   (they don't count for or against).
 * - Keys with values are "hits" if they fall within the tolerance-expanded
 *   band, else "misses".
 * - Empty profile → alignment 1.0 (everyone matches a group with no rules).
 */
export function computeAlignment(
  person:    PersonSnapshot,
  profile:   VirusProfile,
  tolerance: number,
): number {
  const keys = Object.keys(profile);
  if (keys.length === 0) return 1.0;

  let evaluated = 0;
  let hits = 0;

  for (const key of keys) {
    const threshold = profile[key];
    const value     = resolveProfileValue(key, person);
    if (value === undefined) continue; // silently skip unknowns
    evaluated++;

    const minOk = threshold.min === undefined
      ? true
      : value >= (threshold.min - tolerance);
    const maxOk = threshold.max === undefined
      ? true
      : value <= (threshold.max + tolerance);

    if (minOk && maxOk) hits++;
  }

  if (evaluated === 0) return 0; // profile references no known keys — no infection
  return hits / evaluated;
}

// ── Snapshot loaders ────────────────────────────────────────

/** Fetch all active groups of both kinds — shape normalised. */
export async function loadActiveGroups(
  tx: Prisma.TransactionClient | PrismaClient,
): Promise<{
  byId:        Map<string, GroupSnapshot>;
  religions:   GroupSnapshot[];
  factions:    GroupSnapshot[];
}> {
  const [religions, factions] = await Promise.all([
    tx.religion.findMany({
      where:  { is_active: true },
      select: { id: true, name: true, virus_profile: true, tolerance: true },
    }),
    tx.faction.findMany({
      where:  { is_active: true },
      select: { id: true, name: true, virus_profile: true, tolerance: true },
    }),
  ]);

  const religionSnaps: GroupSnapshot[] = religions.map(r => ({
    id:            r.id,
    name:          r.name,
    kind:          'religion',
    virus_profile: (r.virus_profile ?? {}) as unknown as VirusProfile,
    tolerance:     r.tolerance,
  }));
  const factionSnaps: GroupSnapshot[] = factions.map(f => ({
    id:            f.id,
    name:          f.name,
    kind:          'faction',
    virus_profile: (f.virus_profile ?? {}) as unknown as VirusProfile,
    tolerance:     f.tolerance,
  }));

  const byId = new Map<string, GroupSnapshot>();
  for (const g of religionSnaps) byId.set(g.id, g);
  for (const g of factionSnaps) byId.set(g.id, g);

  return { byId, religions: religionSnaps, factions: factionSnaps };
}

/**
 * Build lookup: personId → list of groupIds they already belong to.
 * Returned map values are split by kind so callers can test either side.
 */
export async function loadMembershipIndex(
  tx: Prisma.TransactionClient | PrismaClient,
): Promise<{
  religionsByPerson: Map<string, Set<string>>;
  factionsByPerson:  Map<string, Set<string>>;
}> {
  const [rms, fms] = await Promise.all([
    tx.religionMembership.findMany({
      select: { person_id: true, religion_id: true },
    }),
    tx.factionMembership.findMany({
      select: { person_id: true, faction_id: true },
    }),
  ]);

  const religionsByPerson = new Map<string, Set<string>>();
  for (const m of rms) {
    const s = religionsByPerson.get(m.person_id) ?? new Set<string>();
    s.add(m.religion_id);
    religionsByPerson.set(m.person_id, s);
  }

  const factionsByPerson = new Map<string, Set<string>>();
  for (const m of fms) {
    const s = factionsByPerson.get(m.person_id) ?? new Set<string>();
    s.add(m.faction_id);
    factionsByPerson.set(m.person_id, s);
  }

  return { religionsByPerson, factionsByPerson };
}

// ── Viral join attempt ──────────────────────────────────────

export interface JoinCandidate {
  subject:   PersonSnapshot;
  groupId:   string;
  groupKind: GroupKind;
  alignment: number;
}

/**
 * Given a subject, an antagonist, and the current world snapshot,
 * return every group the antagonist belongs to that the subject
 * *also* matches strongly enough to join. The subject must not
 * already be a member.
 *
 * Pure function — no DB writes. Caller batches writes into a transaction.
 */
export function viralJoinsForPair(
  subject:     PersonSnapshot,
  antagonist:  PersonSnapshot,
  groups: {
    byId: Map<string, GroupSnapshot>;
  },
  memberships: {
    religionsByPerson: Map<string, Set<string>>;
    factionsByPerson:  Map<string, Set<string>>;
  },
): JoinCandidate[] {
  const out: JoinCandidate[] = [];

  const antagonistReligions = memberships.religionsByPerson.get(antagonist.id);
  const subjectReligions    = memberships.religionsByPerson.get(subject.id);
  if (antagonistReligions) {
    for (const gid of antagonistReligions) {
      if (subjectReligions?.has(gid)) continue;
      const g = groups.byId.get(gid);
      if (!g) continue;
      const a = computeAlignment(subject, g.virus_profile, g.tolerance);
      if (a >= MIN_ALIGNMENT_JOIN) {
        out.push({ subject, groupId: gid, groupKind: 'religion', alignment: a });
      }
    }
  }

  const antagonistFactions = memberships.factionsByPerson.get(antagonist.id);
  const subjectFactions    = memberships.factionsByPerson.get(subject.id);
  if (antagonistFactions) {
    for (const gid of antagonistFactions) {
      if (subjectFactions?.has(gid)) continue;
      const g = groups.byId.get(gid);
      if (!g) continue;
      const a = computeAlignment(subject, g.virus_profile, g.tolerance);
      if (a >= MIN_ALIGNMENT_JOIN) {
        out.push({ subject, groupId: gid, groupKind: 'faction', alignment: a });
      }
    }
  }

  return out;
}

// ── Drop-off pass ───────────────────────────────────────────

export interface DropoffResult {
  religion_drops: number;
  faction_drops:  number;
}

/**
 * Year-boundary pass: recompute alignment for every active member,
 * delete rows that fall below MIN_ALIGNMENT_RETAIN, and refresh the
 * stored alignment value on survivors.
 *
 * Uses bulk deleteMany + raw-SQL UPDATE to avoid N round-trips and
 * transaction timeouts on large populations.
 */
export async function runMembershipDropoff(
  prisma:  PrismaClient,
  persons: Map<string, PersonSnapshot>,
  groups:  { byId: Map<string, GroupSnapshot> },
): Promise<DropoffResult> {
  // ── Religions ─────────────────────────────────────
  const rms = await prisma.religionMembership.findMany({
    select: { id: true, religion_id: true, person_id: true, alignment: true },
  });

  const rDropIds:   string[] = [];
  const rUpdateIds: string[] = [];
  const rUpdateVals: number[] = [];

  for (const m of rms) {
    const person = persons.get(m.person_id);
    const group  = groups.byId.get(m.religion_id);
    if (!person || !group) continue;
    const a = computeAlignment(person, group.virus_profile, group.tolerance);
    if (a < MIN_ALIGNMENT_RETAIN) {
      rDropIds.push(m.id);
    } else if (Math.abs(a - m.alignment) > 0.01) {
      rUpdateIds.push(m.id);
      rUpdateVals.push(a);
    }
  }

  const [rDelResult] = await Promise.all([
    rDropIds.length > 0
      ? prisma.religionMembership.deleteMany({ where: { id: { in: rDropIds } } })
      : Promise.resolve({ count: 0 }),
    rUpdateIds.length > 0
      ? prisma.$executeRawUnsafe(`
          UPDATE religion_memberships AS rm
          SET alignment = v.a
          FROM (SELECT UNNEST($1::uuid[]) AS id, UNNEST($2::float8[]) AS a) AS v
          WHERE rm.id = v.id
        `, rUpdateIds, rUpdateVals)
      : Promise.resolve(0),
  ]);

  // ── Factions ──────────────────────────────────────
  const fms = await prisma.factionMembership.findMany({
    select: { id: true, faction_id: true, person_id: true, alignment: true },
  });

  const fDropIds:    string[] = [];
  const fUpdateIds:  string[] = [];
  const fUpdateVals: number[] = [];

  for (const m of fms) {
    const person = persons.get(m.person_id);
    const group  = groups.byId.get(m.faction_id);
    if (!person || !group) continue;
    const a = computeAlignment(person, group.virus_profile, group.tolerance);
    if (a < MIN_ALIGNMENT_RETAIN) {
      fDropIds.push(m.id);
    } else if (Math.abs(a - m.alignment) > 0.01) {
      fUpdateIds.push(m.id);
      fUpdateVals.push(a);
    }
  }

  const [fDelResult] = await Promise.all([
    fDropIds.length > 0
      ? prisma.factionMembership.deleteMany({ where: { id: { in: fDropIds } } })
      : Promise.resolve({ count: 0 }),
    fUpdateIds.length > 0
      ? prisma.$executeRawUnsafe(`
          UPDATE faction_memberships AS fm
          SET alignment = v.a
          FROM (SELECT UNNEST($1::uuid[]) AS id, UNNEST($2::float8[]) AS a) AS v
          WHERE fm.id = v.id
        `, fUpdateIds, fUpdateVals)
      : Promise.resolve(0),
  ]);

  return {
    religion_drops: rDelResult.count,
    faction_drops:  fDelResult.count,
  };
}
