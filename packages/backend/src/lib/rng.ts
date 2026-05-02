// Seeded deterministic PRNG for world seeding (§15.2.1).
//
// All randomness during world creation MUST flow through one of these
// helpers, seeded from `World.random_seed_root`. Same seed → same world.

/** mulberry32 — small, fast 32-bit seeded PRNG. Returns [0, 1). */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded RNG with helpers used by world seeding. */
export interface Rng {
  /** Uniform random in [0, 1). */
  next(): number;
  /** Uniform random in [min, max). */
  uniform(min: number, max: number): number;
  /** Integer in [min, max] inclusive. */
  intInclusive(min: number, max: number): number;
  /** ±jitter as a multiplicative factor in [1 - jitter, 1 + jitter]. */
  jitterFactor(jitter: number): number;
}

/**
 * Build a seeded RNG from a BigInt root. We squash the BigInt into a 32-bit
 * unsigned int by XORing high and low 32-bit halves so callers can pass any
 * BigInt without losing entropy entirely.
 */
export function makeRng(seedRoot: bigint): Rng {
  const low = Number(seedRoot & 0xffffffffn);
  const high = Number((seedRoot >> 32n) & 0xffffffffn);
  const seed = (low ^ high) >>> 0;
  const next = mulberry32(seed);
  return {
    next,
    uniform: (min, max) => min + (max - min) * next(),
    intInclusive: (min, max) => Math.floor(min + (max - min + 1) * next()),
    jitterFactor: (j) => 1 + (next() * 2 - 1) * j,
  };
}

/** Generate a random BigInt seed root (used when caller doesn't supply one). */
export function randomSeedRoot(): bigint {
  // Two 32-bit halves of Math.random gives 64 bits of entropy. Mask to signed
  // int64 (Postgres BIGINT max) so the value round-trips through the DB.
  const hi = BigInt(Math.floor(Math.random() * 0x100000000));
  const lo = BigInt(Math.floor(Math.random() * 0x100000000));
  return ((hi << 32n) | lo) & 0x7fffffffffffffffn;
}
