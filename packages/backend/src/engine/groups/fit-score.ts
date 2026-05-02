// Group fit-score (Phase 7 — DESIGN.md §8.3).
//
// Per-(person|bucket-modal-tags, group) fit:
//   tag_match_count × type_affinity × proximity_bonus
//   × intelligence_target_multiplier   (factions only when configured)
//   × ambitious_bonus                  (factions only — ×1.25 for `ambitious` subjects)
//
// Stat floors zero the score (rejection). Pure helper used by both real-person
// switch and bucket drift.

import type {
  GroupTypeAffinities,
  GroupStatFloors,
  PersonType,
  PersonalityTag,
} from '@claude-god/shared';

/** Slim group shape — what fit scoring actually reads. */
export interface FitGroup {
  id: string;
  wanted_tags: PersonalityTag[];
  type_affinities: GroupTypeAffinities;
  stat_floors: GroupStatFloors;
  /** Soft fit-score bias toward this intelligence level (0–100). Factions
   *  only — religions leave this null. Distance from target falls off
   *  linearly to a floor of 0.5× at full mismatch. */
  intelligence_target?: number | null;
  /** True for factions — subjects with the `ambitious` tag get a ×1.25 bias
   *  on top of any wanted_tag overlap. */
  ambitious_bonus?: boolean;
}

/** ×0.5 floor at 100-point intel mismatch. */
export const INTELLIGENCE_TARGET_FLOOR = 0.5;
/** Factions multiplier when subject carries `ambitious`. */
export const AMBITIOUS_BONUS_MULT = 1.25;

/** Slim person/cohort shape. Bucket callers pass modal/avg values. */
export interface FitSubject {
  type: PersonType;
  personality_tags: PersonalityTag[];
  intelligence?: number;
  combat?: number;
  wealth?: number;
  age?: number;
}

/**
 * Proximity bonus — group's share of subject's city × 1.5 + 1 (so groups with
 * no foothold in the city still register as fit > 0 if other factors hit).
 * Caller supplies `cityShare` as a fraction in [0, 1].
 */
export function proximityBonus(cityShare: number): number {
  if (!Number.isFinite(cityShare) || cityShare <= 0) return 1;
  return 1 + cityShare * 1.5;
}

/** Returns 0 if any stat floor fails (rejects join). */
export function passesStatFloors(s: FitSubject, floors: GroupStatFloors): boolean {
  if (floors.intelligence_min != null && (s.intelligence ?? 0) < floors.intelligence_min) return false;
  if (floors.combat_min != null && (s.combat ?? 0) < floors.combat_min) return false;
  if (floors.wealth_min != null && (s.wealth ?? 0) < floors.wealth_min) return false;
  if (floors.age_min != null && (s.age ?? 0) < floors.age_min) return false;
  return true;
}

/**
 * Soft multiplier toward `target` intelligence. Returns 1 when no target is
 * configured or the subject's intelligence is unknown. Otherwise scales
 * linearly between `INTELLIGENCE_TARGET_FLOOR` (full mismatch) and 1 (exact).
 */
export function intelligenceTargetMultiplier(
  subjectIntel: number | undefined,
  target: number | null | undefined,
): number {
  if (target == null || subjectIntel == null) return 1;
  const dist = Math.min(100, Math.abs(subjectIntel - target)) / 100;
  return INTELLIGENCE_TARGET_FLOOR + (1 - INTELLIGENCE_TARGET_FLOOR) * (1 - dist);
}

/**
 * Score a (subject, group) pair. `cityShare` is the group's current share of
 * the subject's city (0–1). Returns 0 on stat-floor rejection or no overlap.
 */
export function scoreFit(
  subject: FitSubject,
  group: FitGroup,
  cityShare: number,
): number {
  if (!passesStatFloors(subject, group.stat_floors)) return 0;
  const overlap = subject.personality_tags.filter((t) => group.wanted_tags.includes(t)).length;
  if (overlap === 0) return 0;
  const affinity = group.type_affinities[subject.type] ?? 1;
  let score = overlap * affinity * proximityBonus(cityShare);
  score *= intelligenceTargetMultiplier(subject.intelligence, group.intelligence_target);
  if (group.ambitious_bonus && subject.personality_tags.includes('ambitious')) {
    score *= AMBITIOUS_BONUS_MULT;
  }
  return score;
}
