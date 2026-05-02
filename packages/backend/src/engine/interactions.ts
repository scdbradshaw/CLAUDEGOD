// Phase 13a — Interactions phase engine (§15.3 step 1, §15.4).
//
// Pure planner + resolver. Real persons make small social interactions each
// year: chat, argue, gift, romance, betray, comfort. Each actor initiates
// up to INTERACTION_OUTGOING_CAP outgoing interactions; each target receives
// up to INTERACTION_INCOMING_CAP. The service layer applies effects (memory
// entries, wealth transfers, bond plans) against the open Prisma tx.
//
// Design notes (Sam, 2026-04-30):
//   - Restricted to same-city pairs.
//   - Targets weighted by existing bond strength (allies → friendly verbs;
//     rivals → hostile verbs). Random 50% of pulls pick a stranger.
//   - Outcome is a single Bernoulli roll keyed off actor + target stats.
//   - No marriage/murder here — those are agentic actions (Phase 9).

import {
  INTERACTION_KINDS,
  INTERACTION_OUTGOING_CAP,
  INTERACTION_INCOMING_CAP,
  type InteractionKind,
  type RelationshipKind,
} from '@claude-god/shared';
import type { Rng } from '../lib/rng';

export interface PersonForInteraction {
  id: string;
  city_id: string;
  age: number;
  wealth: number;
  is_pinned: boolean;
}

export interface BondForInteraction {
  owner_id: string;
  target_id: string;
  kind: RelationshipKind;
  strength: number;
}

export interface InteractionIntent {
  actor_id: string;
  target_id: string;
  kind: InteractionKind;
}

export interface InteractionOutcome extends InteractionIntent {
  success: boolean;
  /** Set when chat-success should propose a new ally bond. */
  spawn_bond?: { strength: number };
  /** Wealth amount transferred actor → target on a successful gift. */
  gift_amount?: number;
  /** Set on a successful betray to drop the actor's bond toward target. */
  drop_bond?: boolean;
}

const HOSTILE_KINDS: InteractionKind[] = ['argue', 'betray'];
const FRIENDLY_KINDS: InteractionKind[] = ['chat', 'gift', 'comfort'];

/** Per-actor outgoing roll — uniform 0..CAP. Adults only (age >= 13). */
function rollOutgoingCount(p: PersonForInteraction, rng: Rng): number {
  if (p.age < 13) return 0;
  // Pinned persons lean a little more social (they ARE the protagonists).
  const max = INTERACTION_OUTGOING_CAP;
  const r = rng.next();
  if (p.is_pinned) {
    if (r < 0.15) return 1;
    if (r < 0.55) return 2;
    return max;
  }
  if (r < 0.4) return 0;
  if (r < 0.7) return 1;
  if (r < 0.9) return 2;
  return max;
}

interface BondMap {
  /** owner_id → bonds */
  byOwner: Map<string, BondForInteraction[]>;
  /** "owner_id|target_id" → bond */
  pair: Map<string, BondForInteraction>;
}

function indexBonds(bonds: BondForInteraction[]): BondMap {
  const byOwner = new Map<string, BondForInteraction[]>();
  const pair = new Map<string, BondForInteraction>();
  for (const b of bonds) {
    const arr = byOwner.get(b.owner_id) ?? [];
    arr.push(b);
    byOwner.set(b.owner_id, arr);
    pair.set(`${b.owner_id}|${b.target_id}`, b);
  }
  return { byOwner, pair };
}

/** Pick an interaction kind given the actor's bond toward the chosen target. */
function pickKind(
  bond: BondForInteraction | undefined,
  rng: Rng,
): InteractionKind {
  if (bond) {
    if (bond.kind === 'rival' || bond.kind === 'nemesis') {
      // Hostile-leaning. Slim chance of a chat (reconciliation attempt).
      const r = rng.next();
      if (r < 0.05) return 'chat';
      return rng.next() < 0.5 ? 'argue' : 'betray';
    }
    if (bond.kind === 'ally' || bond.kind === 'spouse' || bond.kind === 'lover') {
      const r = rng.next();
      if (r < 0.4) return 'chat';
      if (r < 0.6) return 'gift';
      if (r < 0.8) return 'comfort';
      if (r < 0.95) return bond.kind === 'lover' || bond.kind === 'spouse' ? 'romance' : 'chat';
      return 'argue';
    }
  }
  // Stranger / no bond — favor neutral verbs.
  const r = rng.next();
  if (r < 0.5) return 'chat';
  if (r < 0.7) return 'argue';
  if (r < 0.85) return 'gift';
  if (r < 0.95) return 'comfort';
  return 'romance';
}

/**
 * Pick a target from same-city candidates. Weighted: bonded targets win
 * with probability ~0.5; otherwise uniform random. Never the actor itself.
 * Returns null when no eligible target exists.
 */
function pickTarget(
  actor: PersonForInteraction,
  candidates: PersonForInteraction[],
  bonds: BondMap,
  incomingCount: Map<string, number>,
  rng: Rng,
): PersonForInteraction | null {
  const eligible = candidates.filter(
    (c) =>
      c.id !== actor.id &&
      c.city_id === actor.city_id &&
      (incomingCount.get(c.id) ?? 0) < INTERACTION_INCOMING_CAP,
  );
  if (eligible.length === 0) return null;

  const myBonds = (bonds.byOwner.get(actor.id) ?? []).filter((b) =>
    eligible.some((c) => c.id === b.target_id),
  );

  if (myBonds.length > 0 && rng.next() < 0.5) {
    // Strength-weighted pick among bonded targets.
    const totalW = myBonds.reduce((s, b) => s + Math.max(1, b.strength), 0);
    let pick = rng.next() * totalW;
    for (const b of myBonds) {
      pick -= Math.max(1, b.strength);
      if (pick <= 0) {
        const found = eligible.find((c) => c.id === b.target_id);
        if (found) return found;
      }
    }
  }
  // Uniform among eligible.
  const idx = rng.intInclusive(0, eligible.length - 1);
  return eligible[idx];
}

/** Roll the outcome for a chosen (actor, target, kind). */
function rollOutcome(
  actor: PersonForInteraction,
  target: PersonForInteraction,
  kind: InteractionKind,
  bond: BondForInteraction | undefined,
  rng: Rng,
): InteractionOutcome {
  // Base success rate per kind. Bonded targets boost friendly success;
  // rivals depress it.
  const baseRates: Record<InteractionKind, number> = {
    chat: 0.7,
    gift: 0.85,
    comfort: 0.75,
    romance: 0.45,
    argue: 0.6,
    betray: 0.5,
  };
  let p = baseRates[kind];
  if (bond) {
    if (FRIENDLY_KINDS.includes(kind) || kind === 'romance') {
      if (bond.kind === 'rival' || bond.kind === 'nemesis') p -= 0.3;
      else p += 0.1;
    }
    if (HOSTILE_KINDS.includes(kind)) {
      if (bond.kind === 'ally' || bond.kind === 'spouse') p -= 0.15;
    }
  }
  p = Math.max(0.05, Math.min(0.95, p));
  const success = rng.next() < p;

  const out: InteractionOutcome = {
    actor_id: actor.id,
    target_id: target.id,
    kind,
    success,
  };

  if (success) {
    if (kind === 'chat' && !bond) {
      // Chat with a stranger — propose a small ally bond.
      out.spawn_bond = { strength: 25 };
    }
    if (kind === 'gift' && actor.wealth > 0) {
      out.gift_amount = computeGiftAmount(actor.wealth);
    }
    if (kind === 'betray') {
      out.drop_bond = !!bond;
    }
  }
  return out;
}

function computeGiftAmount(actorWealth: number): number {
  // Imported lazily so tests can monkeypatch constants if needed; safe here.
  // 5% of wealth, capped at 200, floored at 1.
  const pct = Math.floor(actorWealth * 0.05);
  return Math.max(1, Math.min(200, pct));
}

/** Plan + roll outcomes for every actor in `persons`. Pure. */
export function planInteractions(
  persons: PersonForInteraction[],
  bonds: BondForInteraction[],
  rng: Rng,
): InteractionOutcome[] {
  const outcomes: InteractionOutcome[] = [];
  const incomingCount = new Map<string, number>();
  const idx = indexBonds(bonds);

  // Bucket persons by city so pickTarget operates on the city slice instead
  // of the world. O(citySize) per pick instead of O(N). Insertion order
  // matches `persons`, so RNG-driven outcomes remain deterministic.
  const byCity = new Map<string, PersonForInteraction[]>();
  for (const p of persons) {
    const arr = byCity.get(p.city_id) ?? [];
    arr.push(p);
    byCity.set(p.city_id, arr);
  }

  // Iterate actors in stable order. RNG is seeded so this is replayable.
  for (const actor of persons) {
    const n = rollOutgoingCount(actor, rng);
    if (n === 0) continue;
    const cityRoster = byCity.get(actor.city_id);
    // No city-mates — pickTarget would return null without consuming rng.
    if (!cityRoster || cityRoster.length < 2) continue;
    const usedTargets = new Set<string>();
    for (let i = 0; i < n; i++) {
      const target = pickTarget(actor, cityRoster, idx, incomingCount, rng);
      if (!target) break;
      if (usedTargets.has(target.id)) continue; // no double-tap same target
      usedTargets.add(target.id);

      const bond = idx.pair.get(`${actor.id}|${target.id}`);
      const kind = pickKind(bond, rng);
      const outcome = rollOutcome(actor, target, kind, bond, rng);
      outcomes.push(outcome);
      incomingCount.set(target.id, (incomingCount.get(target.id) ?? 0) + 1);
    }
  }
  return outcomes;
}

/** For test/diagnostic use. */
export const _testing = {
  rollOutgoingCount,
  pickKind,
  computeGiftAmount,
  HOSTILE_KINDS,
  FRIENDLY_KINDS,
  INTERACTION_KINDS,
};
