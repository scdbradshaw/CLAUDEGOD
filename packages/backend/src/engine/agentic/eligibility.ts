// Phase 9 — per-action eligibility gates (DESIGN.md §11.1).
//
// Each gate takes a PersonSnapshot + bond view and returns either a
// candidate target (where applicable) or null/false. Pure: no DB.

import {
  FOUND_GROUP_MIN_AGE,
  FOUND_GROUP_MIN_INTELLIGENCE,
  FOUND_GROUP_TREASURY_SEED,
} from '@claude-god/shared';
import type { BondSnapshot, PersonSnapshot } from './types';

export interface EligibilityCtx {
  /** All bonds owned by the actor. */
  ownedBonds: BondSnapshot[];
  /** All alive persons in the world (including the actor). */
  alivePersons: PersonSnapshot[];
}

// ─── marry ──────────────────────────────────────────────────────────────────
// §11.1: declare spouse bond with bonded target. We require:
//  - actor alive + no spouse
//  - has at least one `lover` bond (own side) with an alive target who
//    also has no spouse
export function marryEligibility(
  actor: PersonSnapshot,
  ctx: EligibilityCtx,
): { ok: false } | { ok: true; target: PersonSnapshot } {
  if (actor.spouse_id) return { ok: false };
  const aliveById = new Map(ctx.alivePersons.map((p) => [p.id, p]));
  const lovers = ctx.ownedBonds
    .filter((b) => b.kind === 'lover')
    .sort((a, b) => b.strength - a.strength);
  for (const b of lovers) {
    const target = aliveById.get(b.target_id);
    if (!target) continue;
    if (target.spouse_id) continue;
    if (target.id === actor.id) continue;
    return { ok: true, target };
  }
  return { ok: false };
}

// ─── murder ─────────────────────────────────────────────────────────────────
// §11.1: kill a real-person target. We require:
//  - actor has a `rival` or `nemesis` bond (preferred), or
//  - actor has `cruel`/`vengeful` and any same-city target exists
// Returns the strongest qualifying target.
export function murderEligibility(
  actor: PersonSnapshot,
  ctx: EligibilityCtx,
): { ok: false } | { ok: true; target: PersonSnapshot } {
  const aliveById = new Map(ctx.alivePersons.map((p) => [p.id, p]));
  const enemies = ctx.ownedBonds
    .filter((b) => b.kind === 'rival' || b.kind === 'nemesis')
    .sort((a, b) => b.strength - a.strength);
  for (const b of enemies) {
    const target = aliveById.get(b.target_id);
    if (!target || target.id === actor.id) continue;
    return { ok: true, target };
  }
  return { ok: false };
}

// ─── found-group ────────────────────────────────────────────────────────────
// §11.1: start a new faction or religion. Class-gated per role-power spec:
//  - age ≥ FOUND_GROUP_MIN_AGE
//  - wealth ≥ FOUND_GROUP_TREASURY_SEED
//  - intelligence ≥ FOUND_GROUP_MIN_INTELLIGENCE
//  - religion: only Priests (or anyone `faithful`)
//  - faction:  only Merchants/Scholars/Nobles (or anyone `ambitious`)
// Religion takes priority when both gates pass (matches the kind-resolution
// downstream in executors).
const FACTION_FOUNDER_TYPES = new Set(['Merchant', 'Scholar', 'Noble']);

export function foundGroupEligibility(
  actor: PersonSnapshot,
): { ok: false } | { ok: true; kind: 'faction' | 'religion' } {
  if (actor.age < FOUND_GROUP_MIN_AGE) return { ok: false };
  if (actor.wealth < FOUND_GROUP_TREASURY_SEED) return { ok: false };
  if (actor.intelligence < FOUND_GROUP_MIN_INTELLIGENCE) return { ok: false };
  const tags = actor.personality_tags;
  const canFoundReligion = actor.type === 'Priest' || tags.includes('faithful');
  const canFoundFaction =
    FACTION_FOUNDER_TYPES.has(actor.type) || tags.includes('ambitious');
  if (canFoundReligion) return { ok: true, kind: 'religion' };
  if (canFoundFaction) return { ok: true, kind: 'faction' };
  return { ok: false };
}

// ─── donate (§8.3) ──────────────────────────────────────────────────────────
// Donate to one's own religion. Gates:
//  - actor has a religion_id
//  - actor.wealth ≥ 100 (same floor as gift)
// Target = the religion id (NOT a person id) — the executor loads the Group.
export function donateEligibility(
  actor: PersonSnapshot,
): { ok: false } | { ok: true; religion_id: string } {
  if (!actor.religion_id) return { ok: false };
  if (actor.wealth < 100) return { ok: false };
  return { ok: true, religion_id: actor.religion_id };
}

// ─── gift ───────────────────────────────────────────────────────────────────
// §11.1: transfer wealth to a bonded target with strictly less wealth.
// Bonded = any non-rival/non-nemesis bond (spouse, lover, ally count).
export function giftEligibility(
  actor: PersonSnapshot,
  ctx: EligibilityCtx,
): { ok: false } | { ok: true; target: PersonSnapshot } {
  if (actor.wealth < 100) return { ok: false };
  const aliveById = new Map(ctx.alivePersons.map((p) => [p.id, p]));
  const friendlyBonds = ctx.ownedBonds
    .filter((b) => b.kind === 'spouse' || b.kind === 'lover' || b.kind === 'ally')
    .sort((a, b) => b.strength - a.strength);
  for (const b of friendlyBonds) {
    const target = aliveById.get(b.target_id);
    if (!target || target.id === actor.id) continue;
    if (target.wealth >= actor.wealth) continue;
    return { ok: true, target };
  }
  return { ok: false };
}
