// Memory engine (Phase 6 — DESIGN.md §5.4).
//
// Person.recent_memories is a rolling buffer cap MEMORY_BUFFER_CAP (10).
// Eviction is **weight-FIFO**: on overflow, the lowest-magnitude entry is
// dropped (NOT the oldest). On magnitude ties, the older entry drops first
// (older entries have had their moment in the sun).

import { MEMORY_BUFFER_CAP, type Memory } from '@claude-god/shared';

/**
 * Append `entry` to `buf` and enforce cap. Returns a new array; never mutates
 * the input. If `buf.length + 1 > cap`, evicts the lowest-magnitude entry
 * (with older-first tiebreak).
 */
export function addMemory(
  buf: Memory[],
  entry: Memory,
  cap: number = MEMORY_BUFFER_CAP,
): Memory[] {
  const next = [...buf, entry];
  if (next.length <= cap) return next;
  let evictIdx = 0;
  for (let i = 1; i < next.length; i++) {
    const cur = next[evictIdx];
    const cand = next[i];
    if (cand.magnitude < cur.magnitude) {
      evictIdx = i;
    } else if (cand.magnitude === cur.magnitude && cand.year < cur.year) {
      // Older first on ties.
      evictIdx = i;
    }
  }
  return next.filter((_, i) => i !== evictIdx);
}

/** Bulk-append. Applies cap after each insert (so eviction is per-step). */
export function addMemories(
  buf: Memory[],
  entries: Memory[],
  cap: number = MEMORY_BUFFER_CAP,
): Memory[] {
  let out = buf;
  for (const e of entries) out = addMemory(out, e, cap);
  return out;
}
