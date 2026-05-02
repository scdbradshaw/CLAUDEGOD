// Materialization (Phase 5 — DESIGN.md §4.4).
//
// Pure sampler. Given a Bucket aggregate, draws an unsaved real-person
// shape: race from `race_shares`, age normal-around `avg_age`, stats
// normal-around the bucket averages, gender 50/50, sexuality from
// bucket avg, personality tags weighted from `personality_tag_freqs`.
//
// Fixed at materialization time:
//   - current_health = 100 (they were chosen because they survived)
//   - state_tags = [] (event-triggered overrides land in later phases)
//   - recent_memories = [] (templated backstory in Phase 6)
//   - is_alive = true, is_pinned = false

import {
  PERSONALITY_TAGS,
  RACES,
  type PersonalityTag,
  type PersonType,
  type Race,
  type RaceShares,
  type PersonalityTagFreqs,
} from '@claude-god/shared';
import type { Rng } from '../lib/rng';
import type { BucketState } from './bucket-dynamics/types';

const STAT_MIN = 0;
const STAT_MAX = 100;
const AGE_MIN = 14;
const AGE_MAX = 90;

const STAT_SIGMA_FRAC = 0.15;
const AGE_SIGMA_FRAC = 0.30;
const WEALTH_SIGMA_FRAC = 0.40;

/** Race-keyed first-name pool (placeholder; Phase 6 may grow it). */
const FIRST_NAMES: Record<Race, string[]> = {
  Caucasian: ['Aldric', 'Brenna', 'Cedric', 'Dagmar', 'Edric', 'Freya', 'Gunnar', 'Helga', 'Ingrid', 'Jorund'],
  'African American': ['Amari', 'Bayo', 'Chima', 'Dayo', 'Ebele', 'Femi', 'Gade', 'Halima', 'Ifeoma', 'Jelani'],
  'East Asian': ['An', 'Bo', 'Chen', 'Dao', 'Eun', 'Feng', 'Hua', 'Jin', 'Lin', 'Mei'],
  'South Asian': ['Aarav', 'Bina', 'Chand', 'Devi', 'Esha', 'Falak', 'Gita', 'Harsh', 'Indra', 'Jaya'],
  'Southeast Asian': ['Anh', 'Bayu', 'Chai', 'Dewi', 'Eka', 'Hadi', 'Indah', 'Joko', 'Krit', 'Lan'],
  'Hispanic/Latino': ['Alma', 'Beto', 'Cruz', 'Diego', 'Elena', 'Felipe', 'Gabi', 'Hector', 'Inez', 'Jorge'],
  'Native American': ['Aiyana', 'Bidziil', 'Catori', 'Dyani', 'Enapay', 'Halona', 'Iniko', 'Kaya', 'Lonan', 'Mahpee'],
  'Middle Eastern': ['Amir', 'Basir', 'Camil', 'Dalia', 'Esma', 'Faris', 'Hadi', 'Idris', 'Jamal', 'Karim'],
  'Indigenous Australian': ['Allira', 'Birrani', 'Coorah', 'Daku', 'Edna', 'Galiya', 'Jarrah', 'Kirra', 'Lowanna', 'Marlu'],
  Polynesian: ['Akamu', 'Bane', 'Eleu', 'Hana', 'Ipo', 'Kai', 'Leilani', 'Manu', 'Noa', 'Onika'],
};

const SURNAMES = [
  'Ashfeld', 'Brookshire', 'Carrow', 'Drennan', 'Embry', 'Fenwick',
  'Greaves', 'Holloway', 'Inglewood', 'Jarrow', 'Kindle', 'Lassiter',
  'Mendel', 'Norden', 'Oakes', 'Parrish', 'Quinlan', 'Rookwood',
  'Strand', 'Thorne', 'Underhill', 'Verity', 'Whitlow', 'Yardley',
];

/** Shape of an unsaved Person. world_id/city_id added by the caller. */
export interface SampledPerson {
  type: PersonType;
  name: string;
  age: number;
  gender: 'male' | 'female';
  race: Race;
  sexuality: number;
  combat: number;
  intelligence: number;
  happiness: number;
  wealth: number;
  current_health: number;
  personality_tags: PersonalityTag[];
  state_tags: never[];
  is_alive: true;
  is_pinned: false;
  created_year: number;
}

export interface MaterializeInput {
  bucket: BucketState;
  race_shares: RaceShares;
  personality_tag_freqs: PersonalityTagFreqs;
  year: number;
  rng: Rng;
}

export function samplePerson(input: MaterializeInput): SampledPerson {
  const { bucket, race_shares, personality_tag_freqs, year, rng } = input;
  const race = pickWeighted(race_shares, rng) ?? uniformPick(RACES as unknown as Race[], rng);
  const gender: 'male' | 'female' = rng.next() < 0.5 ? 'male' : 'female';
  const first = pick(FIRST_NAMES[race], rng);
  const last = pick(SURNAMES, rng);

  const age = clamp(
    Math.round(normal(bucket.avg_age, bucket.avg_age * AGE_SIGMA_FRAC, rng)),
    AGE_MIN,
    AGE_MAX,
  );
  const wealthSigma = Math.max(1, bucket.avg_wealth * WEALTH_SIGMA_FRAC);

  return {
    type: bucket.type,
    name: `${first} ${last}`,
    age,
    gender,
    race,
    sexuality: clampStat(normal(bucket.avg_sexuality, STAT_MAX * STAT_SIGMA_FRAC, rng)),
    combat: clampStat(normal(bucket.avg_combat, STAT_MAX * STAT_SIGMA_FRAC, rng)),
    intelligence: clampStat(normal(bucket.avg_intelligence, STAT_MAX * STAT_SIGMA_FRAC, rng)),
    happiness: clampStat(normal(bucket.avg_happiness, STAT_MAX * STAT_SIGMA_FRAC, rng)),
    wealth: Math.max(0, Math.round(normal(bucket.avg_wealth, wealthSigma, rng))),
    current_health: 100,
    personality_tags: samplePersonalityTags(personality_tag_freqs, rng),
    state_tags: [],
    is_alive: true,
    is_pinned: false,
    created_year: year,
  };
}

/** Independent Bernoulli per tag, then enforce 1–3. Exported for tests. */
export function samplePersonalityTags(
  freqs: PersonalityTagFreqs,
  rng: Rng,
): PersonalityTag[] {
  const out: PersonalityTag[] = [];
  for (const t of PERSONALITY_TAGS) {
    if (rng.next() < (freqs[t] ?? 0)) out.push(t);
  }
  if (out.length === 0) {
    const sorted = [...PERSONALITY_TAGS].sort((a, b) => (freqs[b] ?? 0) - (freqs[a] ?? 0));
    out.push(sorted[0]);
  }
  if (out.length > 3) {
    out.sort((a, b) => (freqs[b] ?? 0) - (freqs[a] ?? 0));
    out.length = 3;
  }
  return out;
}

// ─── Internals ───────────────────────────────────────────────────────────────

function normal(mean: number, sigma: number, rng: Rng): number {
  const u1 = Math.max(rng.next(), 1e-12);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * sigma;
}

function pickWeighted<T extends string>(weights: Partial<Record<T, number>>, rng: Rng): T | null {
  const keys = Object.keys(weights) as T[];
  if (keys.length === 0) return null;
  const total = keys.reduce((s, k) => s + (weights[k] ?? 0), 0);
  if (total <= 0) return null;
  let r = rng.next() * total;
  for (const k of keys) {
    r -= weights[k] ?? 0;
    if (r <= 0) return k;
  }
  return keys[keys.length - 1];
}

function uniformPick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng.next() * arr.length)];
}
function pick<T>(arr: readonly T[], rng: Rng): T {
  return arr[Math.floor(rng.next() * arr.length)];
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function clampStat(n: number): number {
  return Math.round(clamp(n, STAT_MIN, STAT_MAX));
}
