// Promotion-time backstory (Phase 6 — DESIGN.md §4.4 / §5.5).
//
// At materialization, a fresh real person gets:
//   - 2–4 templated memory entries reflecting their bucket-life
//   - 0–3 declared bonds (prefer kin → same-city compatible peers)
//
// "Compatible peer" for v1 = same city, alive, age within ±15, and a
// best-guess on lover/spouse fit by sexuality compatibility. Phase 6 has no
// faction/religion plumbing yet, so we don't gate on group co-membership.
// Pure: takes the new person + a peer list + rng; returns memories + bonds.

import type { PersonType } from '@claude-god/shared';
import type { Memory, RelationshipKind } from '@claude-god/shared';
import type { Rng } from '../lib/rng';

/** Slim peer shape — what bond seeding actually reads. */
export interface BackstoryPeer {
  id: string;
  age: number;
  gender: 'male' | 'female';
  sexuality: number; // 0=gay … 100=straight
}

/** Slim "fresh person" shape. Caller passes the just-created Person row. */
export interface BackstorySubject {
  id: string;
  city_name: string;
  type: PersonType;
  name: string;
  age: number;
  gender: 'male' | 'female';
  sexuality: number;
}

export interface BackstoryBond {
  target_id: string;
  kind: RelationshipKind;
  strength: number;
  set_year: number;
}

export interface BackstoryResult {
  memories: Memory[];
  bonds: BackstoryBond[];
}

/**
 * Generate the backstory bundle. The same year is stamped on memories +
 * bonds (the year the person was promoted into the real-person tier).
 */
export function generateBackstory(
  subject: BackstorySubject,
  peers: BackstoryPeer[],
  year: number,
  rng: Rng,
): BackstoryResult {
  const memories = generateMemories(subject, year, rng);
  const bonds = generateBonds(subject, peers, year, rng);
  return { memories, bonds };
}

// ─── Memories ───────────────────────────────────────────────────────────────

/** Templates indexed by PersonType. Keep them tame; Claude rewrites in v1.1. */
const TYPE_TEMPLATES: Record<PersonType, string[]> = {
  Farmer: [
    'worked the fields outside {city} from age 14',
    'survived a hard winter in {city}',
    'sold a record harvest at the {city} market',
  ],
  Laborer: [
    'broke ground on the new aqueduct in {city}',
    'hauled stone for the {city} walls',
    'apprenticed to a stonemason in {city}',
  ],
  Artisan: [
    'set up a workshop in the {city} crafters\' quarter',
    'finished a commissioned piece for a {city} noble',
    'taught the trade to a younger sibling in {city}',
  ],
  Merchant: [
    'opened a stall on the {city} square',
    'closed a long-haul deal that funded the family',
    'lost a caravan on the road to {city} and paid it down for years',
  ],
  Soldier: [
    'enlisted in the {city} watch at age 16',
    'survived a skirmish on the {city} frontier',
    'drilled the {city} levy through a hard summer',
  ],
  Priest: [
    'took vows at the {city} temple',
    'led the {city} festival rites for a season',
    'sat with a dying neighbor through the long night',
  ],
  Scholar: [
    'copied manuscripts in the {city} library for years',
    'argued late into the night with a visiting tutor in {city}',
    'wrote a small treatise that got passed around {city}',
  ],
  Noble: [
    'managed the family\'s holdings outside {city}',
    'attended the {city} court from a young age',
    'brokered a marriage between two minor houses of {city}',
  ],
  Outlaw: [
    'fled {city} after a stupid mistake at sixteen',
    'ran with a small crew on the back roads',
    'paid a heavy bribe to keep a record clean',
  ],
  Healer: [
    'apprenticed to the {city} herbalist',
    'pulled a child through a fever everyone said was lost',
    'kept the {city} infirmary running through a bad winter',
  ],
};

function generateMemories(subject: BackstorySubject, year: number, rng: Rng): Memory[] {
  const pool = TYPE_TEMPLATES[subject.type];
  // 2–4 entries.
  const n = 2 + Math.floor(rng.next() * 3);
  const indices = pickDistinct(pool.length, Math.min(n, pool.length), rng);
  const startAge = Math.max(14, subject.age - n * 4);

  return indices.map((i, k): Memory => {
    const t = pool[i].replace('{city}', subject.city_name);
    // Stamp memories across the years leading up to promotion. Order the
    // generated memories by their (synthesized) year ascending.
    const ageAtMemory = startAge + k * 4;
    const memYear = year - (subject.age - ageAtMemory);
    return {
      year: memYear,
      kind: 'backstory',
      summary: t,
      magnitude: 0.2 + rng.next() * 0.3, // mild — promotion doesn't make them legendary
      tone: 'reportage',
    };
  });
}

// ─── Bonds ──────────────────────────────────────────────────────────────────

function generateBonds(
  subject: BackstorySubject,
  peers: BackstoryPeer[],
  year: number,
  rng: Rng,
): BackstoryBond[] {
  if (peers.length === 0) return [];

  // 0–3 bonds. Roll three independent chances for an extra bond.
  let n = 0;
  for (let i = 0; i < 3; i++) if (rng.next() < 0.5) n++;
  if (n === 0) return [];

  // Score peers: small age gap + plausible compatibility for romantic kinds.
  const scored = peers.map((p) => ({
    peer: p,
    score: scorePeer(subject, p),
  }));
  scored.sort((a, b) => b.score - a.score);

  const used = new Set<string>();
  const bonds: BackstoryBond[] = [];
  for (let i = 0; i < n && i < scored.length; i++) {
    const p = scored[i].peer;
    if (used.has(p.id)) continue;
    used.add(p.id);
    bonds.push({
      target_id: p.id,
      kind: pickKind(subject, p, rng),
      strength: 30 + Math.floor(rng.next() * 40),
      set_year: year,
    });
  }
  return bonds;
}

function scorePeer(s: BackstorySubject, p: BackstoryPeer): number {
  const ageGap = Math.abs(s.age - p.age);
  return Math.max(0, 30 - ageGap);
}

function pickKind(
  s: BackstorySubject,
  p: BackstoryPeer,
  rng: Rng,
): RelationshipKind {
  // Romance fit: opposite-gender if sexuality > 50, same-gender if < 50.
  const oppositeGender = s.gender !== p.gender;
  const wantsOpposite = s.sexuality > 50;
  const romanceFit = wantsOpposite === oppositeGender;
  const r = rng.next();
  if (romanceFit && r < 0.25) return 'lover';
  if (r < 0.6) return 'ally';
  if (r < 0.85) return 'rival';
  return 'nemesis';
}

// ─── Internals ──────────────────────────────────────────────────────────────

function pickDistinct(poolSize: number, k: number, rng: Rng): number[] {
  const idx = Array.from({ length: poolSize }, (_, i) => i);
  // Fisher–Yates partial shuffle.
  for (let i = idx.length - 1; i > poolSize - 1 - k; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(poolSize - k);
}
