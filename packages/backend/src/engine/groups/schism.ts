// Group schism cluster detection (Phase 7 — DESIGN.md §8.3).
//
// At year-end, scan groups with `member_count > GROUP_SCHISM_MIN_MEMBERS`.
// Cluster members by primary personality tag; count clusters with at least
// GROUP_SCHISM_CLUSTER_MIN_SIZE members. If ≥2 such clusters AND the leader's
// primary tag mismatches a sub-cluster's modal tag → fire schism candidate.
//
// Subject to a per-group 10-year cooldown (CASCADE_COOLDOWN_YEARS / §9.3).
// Pure: returns a candidate descriptor. Caller (Phase 8) actually fires the
// event; in Phase 7 we just stamp `last_schism_year` and log the candidate.

import {
  CASCADE_COOLDOWN_YEARS,
  GROUP_SCHISM_CLUSTER_MIN_SIZE,
  GROUP_SCHISM_MIN_MEMBERS,
  type PersonalityTag,
} from '@claude-god/shared';

export interface SchismDetectInput {
  /** Group's current cached member count. */
  memberCount: number;
  /** Tag → count of members whose primary tag is that tag. */
  primaryTagDistribution: Record<PersonalityTag, number>;
  /** Leader's primary tag (or null if leaderless). */
  leaderPrimaryTag: PersonalityTag | null;
  /** When this group last fired a schism (null if never). */
  lastSchismYear: number | null;
  currentYear: number;
}

export type SchismResult =
  | {
      fire: true;
      modalTagOfDefectors: PersonalityTag;
      defectorClusterTags: PersonalityTag[];
    }
  | {
      fire: false;
      blockedBy: 'too-small' | 'cooldown' | 'one-cluster' | 'leader-aligned';
    };

export function detectSchismCandidate(input: SchismDetectInput): SchismResult {
  if (input.memberCount < GROUP_SCHISM_MIN_MEMBERS) {
    return { fire: false, blockedBy: 'too-small' };
  }
  if (
    input.lastSchismYear != null &&
    input.currentYear - input.lastSchismYear < CASCADE_COOLDOWN_YEARS
  ) {
    return { fire: false, blockedBy: 'cooldown' };
  }

  const clusters = (Object.entries(input.primaryTagDistribution) as [PersonalityTag, number][])
    .filter(([, count]) => count >= GROUP_SCHISM_CLUSTER_MIN_SIZE)
    .sort((a, b) => b[1] - a[1]);

  if (clusters.length < 2) {
    return { fire: false, blockedBy: 'one-cluster' };
  }

  // Pick the largest cluster whose tag is NOT the leader's primary tag.
  const defector = clusters.find(([tag]) => tag !== input.leaderPrimaryTag);
  if (!defector) {
    return { fire: false, blockedBy: 'leader-aligned' };
  }

  return {
    fire: true,
    modalTagOfDefectors: defector[0],
    defectorClusterTags: clusters.map(([t]) => t),
  };
}
