// State-tag engine (Phase 6 — DESIGN.md §5.2).
//
// Pure helpers over Person.state_tags (`StateTagEntry[]`):
//   - prune expired tags at year-end (`set_year + duration <= year`)
//   - add a tag with cap enforcement (drop oldest by set_year on overflow)
//
// Boolean carriers; re-adding the same tag *resets* set_year (so a fresh
// trauma re-anchors the 10-year decay window).

import {
  STATE_TAG_DURATIONS,
  STATE_TAG_MAX,
  type StateTag,
  type StateTagEntry,
} from '@claude-god/shared';

/** Drop entries whose decay window has passed. Pure. */
export function pruneExpiredStateTags(
  tags: StateTagEntry[],
  year: number,
): StateTagEntry[] {
  return tags.filter((t) => t.set_year + STATE_TAG_DURATIONS[t.tag] > year);
}

/**
 * Add (or refresh) a state tag. If `tag` is already present, its `set_year`
 * is updated to the new year (resets decay). If the post-add length exceeds
 * STATE_TAG_MAX, drop the oldest entry by set_year (ties broken by tag
 * ordering — stable).
 */
export function addStateTag(
  tags: StateTagEntry[],
  tag: StateTag,
  year: number,
): StateTagEntry[] {
  const existingIdx = tags.findIndex((t) => t.tag === tag);
  let next: StateTagEntry[];
  if (existingIdx >= 0) {
    next = tags.slice();
    next[existingIdx] = { tag, set_year: year };
  } else {
    next = [...tags, { tag, set_year: year }];
  }
  if (next.length <= STATE_TAG_MAX) return next;
  // Overflow: drop oldest by set_year (lowest first).
  const sorted = [...next].sort((a, b) => a.set_year - b.set_year);
  const evictId = sorted[0];
  return next.filter((t) => !(t.tag === evictId.tag && t.set_year === evictId.set_year));
}

/** Convenience: prune then add. */
export function refreshAndAddStateTag(
  tags: StateTagEntry[],
  tag: StateTag,
  year: number,
): StateTagEntry[] {
  return addStateTag(pruneExpiredStateTags(tags, year), tag, year);
}
