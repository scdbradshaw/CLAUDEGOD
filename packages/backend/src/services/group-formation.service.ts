// ============================================================
// GROUP FORMATION SERVICE — emergent + event-driven spawns
// ============================================================
//
// Three paths create groups:
//   1. Player-authored   — POST /api/religions, POST /api/factions (already built)
//   2. Emergent          — capability gate + dramatic event + dice roll
//   3. Event-driven      — outcome band has `creates_group`, always spawns
//
// This module handles 2 + 3. Callers queue spawn intents during a tick
// and then persist them through `spawnGroup` inside the main transaction.
// ============================================================

import type { Prisma } from '@prisma/client';
import type { VirusProfile, OutcomeBand, CapabilityGates } from '@civ-sim/shared';
import type { GroupKind, PersonSnapshot } from './membership.service';

// ── Tunables ────────────────────────────────────────────────
/** Minimum leadership / charisma required for emergent spawn (fallback). */
export const CAPABILITY_GATE = {
  leadership: 60,
  charisma:   55,
} as const;

/** Probability per qualifying dramatic event that an emergent group spawns. */
export const EMERGENT_SPAWN_PROB = 0.08;
/** Minimum band magnitude that can trigger emergent formation. */
export const EMERGENT_MAGNITUDE_THRESHOLD = 0.9;

// ── Types ───────────────────────────────────────────────────

export interface SpawnIntent {
  kind:       GroupKind;
  founderId:  string;
  name:       string;
  profile:    VirusProfile;
  tolerance:  number;
  origin:     'emergent' | 'event';
}

// ── Capability gate ─────────────────────────────────────────

/** Does this person have the raw stats to rally others around them? */
export function meetsCapabilityGate(
  p:     PersonSnapshot,
  gates?: CapabilityGates['found_religion'] | CapabilityGates['found_faction'],
): boolean {
  const leadershipMin = gates?.leadership_min ?? CAPABILITY_GATE.leadership;
  const charismaMin   = gates?.charisma_min   ?? CAPABILITY_GATE.charisma;
  const leadership = p.traits['leadership'] ?? 0;
  const charisma   = p.traits['charisma']   ?? 0;
  return leadership >= leadershipMin && charisma >= charismaMin;
}

// ── Virus profile derivation ────────────────────────────────

/**
 * Pick the founder's most distinctive identity attributes and convert each
 * into a threshold. "Distinctive" = furthest from the neutral 50 mid-point.
 *
 * - Value >= 70 becomes a `min` threshold (attract people who also rank high)
 * - Value <= 30 becomes a `max` threshold (attract people who also rank low)
 * - Values near 50 aren't defining enough to lift into the profile
 *
 * Unknown / undefined traits are skipped automatically.
 */
export function deriveVirusProfile(
  founder: PersonSnapshot,
  maxKeys = 4,
): VirusProfile {
  const scored = Object.entries(founder.traits)
    .filter(([, v]) => typeof v === 'number')
    .map(([k, v]) => ({ key: k, value: v, distance: Math.abs(v - 50) }))
    .filter(t => t.distance >= 20) // must be at least 20 points off-neutral
    .sort((a, b) => b.distance - a.distance)
    .slice(0, maxKeys);

  const profile: VirusProfile = {};
  for (const t of scored) {
    if (t.value >= 70) {
      profile[t.key] = { min: Math.max(0, t.value - 10) };
    } else if (t.value <= 30) {
      profile[t.key] = { max: Math.min(100, t.value + 10) };
    }
  }
  return profile;
}

// ── Name generation ─────────────────────────────────────────

const RELIGION_ROOTS = [
  'Light', 'Dawn', 'Ember', 'Silence', 'Veil', 'Flame',
  'Root', 'Tide', 'Storm', 'Hollow', 'Pillar', 'Thorn',
];
const FACTION_ROOTS = [
  'Iron', 'Crimson', 'Black', 'Gilded', 'Silver', 'Shattered',
  'Vigilant', 'Hidden', 'Burning', 'Free', 'Bound', 'Forgotten',
];
const RELIGION_SUFFIXES = [
  'Faith', 'Path', 'Word', 'Doctrine', 'Flame', 'Circle',
];
const FACTION_SUFFIXES = [
  'Hand', 'Order', 'Banner', 'Brotherhood', 'Compact', 'Front',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateGroupName(kind: GroupKind, prefix?: string): string {
  if (kind === 'religion') {
    const base = `The ${pick(RELIGION_ROOTS)} ${pick(RELIGION_SUFFIXES)}`;
    return prefix ? `${prefix} ${base}` : base;
  }
  const base = `The ${pick(FACTION_ROOTS)} ${pick(FACTION_SUFFIXES)}`;
  return prefix ? `${prefix} ${base}` : base;
}

// ── Intent builders ─────────────────────────────────────────

/**
 * Evaluate emergent formation for one interaction outcome.
 * Returns a SpawnIntent when every gate passes, else null.
 */
export function tryEmergentSpawn(
  subject: PersonSnapshot,
  band:    OutcomeBand,
): SpawnIntent | null {
  if (band.magnitude < EMERGENT_MAGNITUDE_THRESHOLD) return null;
  if (!meetsCapabilityGate(subject))                 return null;
  if (Math.random() >= EMERGENT_SPAWN_PROB)          return null;

  const profile = deriveVirusProfile(subject);
  if (Object.keys(profile).length === 0) return null; // nothing distinctive to rally around

  // Euphoric events → religions (shared ecstasy); traumatic → factions
  // (shared grievance). Neutral-magnitude wouldn't reach this code path.
  const kind: GroupKind = band.magnitude >= 0.95 ? 'religion' : 'faction';

  return {
    kind,
    founderId: subject.id,
    name:      generateGroupName(kind),
    profile,
    tolerance: 10,
    origin:    'emergent',
  };
}

/**
 * Evaluate event-driven formation. Always spawns when `creates_group` is
 * present on the band — the ruleset author has opted in deliberately.
 */
export function tryEventSpawn(
  subject:    PersonSnapshot,
  antagonist: PersonSnapshot,
  band:       OutcomeBand,
): SpawnIntent | null {
  const spec = band.creates_group;
  if (!spec) return null;

  const founder = spec.founder === 'antagonist' ? antagonist : subject;
  const profile = deriveVirusProfile(founder);

  return {
    kind:      spec.kind,
    founderId: founder.id,
    name:      generateGroupName(spec.kind, spec.name_prefix),
    profile,
    tolerance: 10,
    origin:    'event',
  };
}

// ── Spawn writer ────────────────────────────────────────────

export interface SpawnResult {
  kind:      GroupKind;
  groupId:   string;
  name:      string;
  founderId: string;
}

/**
 * Persist one spawn intent inside the caller's transaction. Also enrols
 * the founder as the first member at alignment 1.0. For factions the
 * founder is set as leader (per schema: leader defaults to founder).
 */
export async function spawnGroup(
  tx:          Prisma.TransactionClient,
  intent:      SpawnIntent,
  currentYear: number,
  worldId:     string,
): Promise<SpawnResult> {
  if (intent.kind === 'religion') {
    const rel = await tx.religion.create({
      data: {
        name:          intent.name,
        founder_id:    intent.founderId,
        origin:        intent.origin,
        tolerance:     intent.tolerance,
        virus_profile: intent.profile as Prisma.InputJsonValue,
        founded_year:  currentYear,
        world_id:      worldId,
      },
    });
    await tx.religionMembership.create({
      data: {
        religion_id: rel.id,
        person_id:   intent.founderId,
        joined_year: currentYear,
        alignment:   1.0,
      },
    });
    return { kind: 'religion', groupId: rel.id, name: rel.name, founderId: intent.founderId };
  }

  const fac = await tx.faction.create({
    data: {
      name:          intent.name,
      founder_id:    intent.founderId,
      leader_id:     intent.founderId,
      origin:        intent.origin,
      tolerance:     intent.tolerance,
      virus_profile: intent.profile as Prisma.InputJsonValue,
      founded_year:  currentYear,
      world_id:      worldId,
    },
  });
  await tx.factionMembership.create({
    data: {
      faction_id:  fac.id,
      person_id:   intent.founderId,
      joined_year: currentYear,
      alignment:   1.0,
    },
  });
  return { kind: 'faction', groupId: fac.id, name: fac.name, founderId: intent.founderId };
}
