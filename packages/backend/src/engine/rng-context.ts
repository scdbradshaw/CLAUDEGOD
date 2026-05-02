// Per-year deterministic RNG context (Phase 4).
//
// Per DESIGN.md §15.2.1, all randomness in the year-phase pipeline must flow
// through a PRNG seeded by `(world_id, year, random_seed)`. `makeYearRng`
// folds those three into a single 32-bit seed for `mulberry32` so any year
// run can be replayed exactly given the same inputs.

import { makeRng, type Rng } from '../lib/rng';

/** FNV-1a 32-bit hash of a UTF-8 string. Used to fold world_id into the seed. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Build a per-year RNG by combining the world's seed root, world id, and
 * year into a 32-bit seed. Same `(seedRoot, worldId, year)` always yields
 * the same sequence — this is the replay contract.
 */
export function makeYearRng(seedRoot: bigint, worldId: string, year: number): Rng {
  const low = Number(seedRoot & 0xffffffffn);
  const high = Number((seedRoot >> 32n) & 0xffffffffn);
  const idHash = fnv1a32(worldId);
  // Mix with multiplicative-XOR so all three inputs influence every bit.
  let mixed = (low ^ high) >>> 0;
  mixed = Math.imul(mixed ^ idHash, 0x85ebca6b) >>> 0;
  mixed = Math.imul(mixed ^ (year | 0), 0xc2b2ae35) >>> 0;
  mixed ^= mixed >>> 16;
  return makeRng(BigInt(mixed >>> 0));
}
