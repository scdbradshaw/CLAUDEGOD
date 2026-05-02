// Phase 9 — pure descriptor producers for the 4 v1 actions.
//
// Each function takes the actor + target snapshots and returns a descriptor
// of "what should change in the DB" — never touches Prisma. The service
// layer applies these. Memory entries are returned ready-to-append.

import {
  FACTION_COMPETITION_METRIC_DEFAULT,
  FACTION_DEFAULT_COST_PER_YEAR,
  FACTION_LEADER_DUES_CUT_DEFAULT,
  FACTION_PRIZE_SHARES_DEFAULT,
  GIFT_PCT_MAX,
  GIFT_PCT_MIN,
  RELIGION_DONATE_HAPPINESS_BUMP,
  RELIGION_DONATE_TIER_HIGH,
  RELIGION_DONATE_TIER_LOW,
  RELIGION_DONATE_TIER_MID,
  RELIGION_WANTED_TAGS_MAX,
  type Memory,
  type PersonalityTag,
} from '@claude-god/shared';
import type { Rng } from '../../lib/rng';
import type { PersonSnapshot } from './types';

// ─── marry ──────────────────────────────────────────────────────────────────

export interface MarryDescriptor {
  actor_id: string;
  target_id: string;
  /** Set on both Person rows (mutual). */
  set_spouse: true;
  /** Also seed a 90-strength `spouse` bond on owner side (target side mirrors). */
  bond_strength: number;
  actor_memory: Memory;
  target_memory: Memory;
  /** Apply 'wedded-recently' state tag to both. */
  set_state_tag: 'wedded-recently';
}

export function planMarry(
  actor: PersonSnapshot,
  target: PersonSnapshot,
  year: number,
): MarryDescriptor {
  return {
    actor_id: actor.id,
    target_id: target.id,
    set_spouse: true,
    bond_strength: 90,
    set_state_tag: 'wedded-recently',
    actor_memory: {
      year,
      kind: 'married',
      summary: `married`,
      magnitude: 0.95,
      tone: 'literary',
      counterparty_id: target.id,
    },
    target_memory: {
      year,
      kind: 'married',
      summary: `married`,
      magnitude: 0.95,
      tone: 'literary',
      counterparty_id: actor.id,
    },
  };
}

// ─── murder ─────────────────────────────────────────────────────────────────

export interface MurderDescriptor {
  actor_id: string;
  target_id: string;
  /** Per §11.5: higher combat wins. Tie = both die. */
  outcome: 'actor_wins' | 'target_wins' | 'both_die';
  /** Killed person id(s); routed through archiveAndDeleteTx with cause='interaction'. */
  kills: string[];
  /** Memory entry on the survivor (or none if both_die). */
  survivor_memory: Memory | null;
  /** Memory entry on the *witness* — i.e. the surviving person other than killer. */
  witness_id: string | null;
}

/** Soldier class combat edge — applied on top of raw `combat` in interactions. */
const SOLDIER_COMBAT_BONUS = 15;

function effectiveCombat(p: PersonSnapshot): number {
  return p.combat + (p.type === 'Soldier' ? SOLDIER_COMBAT_BONUS : 0);
}

export function planMurder(
  actor: PersonSnapshot,
  target: PersonSnapshot,
  year: number,
): MurderDescriptor {
  let outcome: MurderDescriptor['outcome'];
  let kills: string[];
  let survivorMemory: Memory | null = null;
  let witnessId: string | null = null;
  const actorCombat = effectiveCombat(actor);
  const targetCombat = effectiveCombat(target);
  if (actorCombat > targetCombat) {
    outcome = 'actor_wins';
    kills = [target.id];
    survivorMemory = {
      year,
      kind: 'murdered-rival',
      summary: `killed a rival`,
      magnitude: 0.95,
      tone: 'tabloid',
      counterparty_id: target.id,
    };
    witnessId = actor.id;
  } else if (actorCombat < targetCombat) {
    outcome = 'target_wins';
    kills = [actor.id];
    survivorMemory = {
      year,
      kind: 'survived-attempt',
      summary: `was attacked and survived`,
      magnitude: 0.9,
      tone: 'tabloid',
      counterparty_id: actor.id,
    };
    witnessId = target.id;
  } else {
    outcome = 'both_die';
    kills = [actor.id, target.id];
    // No surviving witness; kin grief routes via the death pipeline.
  }
  return {
    actor_id: actor.id,
    target_id: target.id,
    outcome,
    kills,
    survivor_memory: survivorMemory,
    witness_id: witnessId,
  };
}

// ─── found-group ────────────────────────────────────────────────────────────

export interface FoundGroupDescriptor {
  actor_id: string;
  kind: 'faction' | 'religion';
  /** Drawn from actor wealth; actor wealth is debited by this amount. */
  treasury_seed: number;
  /** Suggested name templated from actor name. */
  name_template_suffix: string;
  /** Wanted tags = actor's personality tags (top 1–3). */
  wanted_tags: string[];
  /** Faction-only competition config; null for religions. */
  faction_config: {
    cost_per_year: number;
    leader_dues_cut: number;
    prize_shares: number[];
    competition_metric: string;
    intelligence_target: number;
  } | null;
  actor_memory: Memory;
}

export function planFoundGroup(
  actor: PersonSnapshot,
  kind: 'faction' | 'religion',
  treasurySeed: number,
  year: number,
): FoundGroupDescriptor {
  const wanted_tags =
    kind === 'religion'
      ? buildReligionWantedTags(actor)
      : actor.personality_tags.slice(0, 3);

  // Factions spawn with full competition config so payouts can run from
  // year 1. Religions stay null on these fields (they're not competitions).
  const faction_config =
    kind === 'faction'
      ? {
          cost_per_year: FACTION_DEFAULT_COST_PER_YEAR,
          leader_dues_cut: FACTION_LEADER_DUES_CUT_DEFAULT,
          prize_shares: [...FACTION_PRIZE_SHARES_DEFAULT],
          competition_metric: FACTION_COMPETITION_METRIC_DEFAULT,
          // Founder's intelligence biases the fit-score so similar minds are
          // pulled toward the faction. Tunable later from the UI.
          intelligence_target: actor.intelligence,
        }
      : null;

  return {
    actor_id: actor.id,
    kind,
    treasury_seed: treasurySeed,
    name_template_suffix: kind === 'faction' ? 'Faction' : 'Faith',
    wanted_tags,
    faction_config,
    actor_memory: {
      year,
      kind: kind === 'faction' ? 'founded-faction' : 'founded-religion',
      summary: kind === 'faction' ? `founded a faction` : `founded a religion`,
      magnitude: 0.95,
      tone: 'epic',
    },
  };
}

/**
 * Religion `wanted_tags` (§8.3 — founder-scaled breadth):
 *
 *   slot 0          = 'faithful' (always — caller must guarantee actor is faithful)
 *   total slot count = 1 base
 *                    + intel tiers @ 40 / 60 / 80 (+1 each)
 *                    + wealth tiers @ 1000 / 5000 (+1 each)
 *                    capped at RELIGION_WANTED_TAGS_MAX
 *
 * Smarter, wealthier founders cast a broader doctrinal net. Remaining slots
 * are filled from the founder's own personality tags (excluding `faithful`),
 * preserving order.
 */
function buildReligionWantedTags(actor: PersonSnapshot): PersonalityTag[] {
  let count = 1;
  if (actor.intelligence >= 40) count++;
  if (actor.intelligence >= 60) count++;
  if (actor.intelligence >= 80) count++;
  if (actor.wealth >= 1000) count++;
  if (actor.wealth >= 5000) count++;
  count = Math.min(count, RELIGION_WANTED_TAGS_MAX);

  const remaining: PersonalityTag[] = [];
  for (const t of actor.personality_tags) {
    if (t === 'faithful') continue;
    if (remaining.includes(t)) continue;
    remaining.push(t);
    if (remaining.length >= count - 1) break;
  }
  return ['faithful' as PersonalityTag, ...remaining];
}

// ─── gift ───────────────────────────────────────────────────────────────────

export interface GiftDescriptor {
  actor_id: string;
  target_id: string;
  /** Whole gold units transferred. Drawn from actor wealth, deposited to target. */
  amount: number;
  actor_memory: Memory;
  target_memory: Memory;
}

export function planGift(
  actor: PersonSnapshot,
  target: PersonSnapshot,
  year: number,
  rng: Rng,
): GiftDescriptor {
  const pct = rng.uniform(GIFT_PCT_MIN, GIFT_PCT_MAX);
  const amount = Math.max(1, Math.floor(actor.wealth * pct));
  // Cap so we don't overshoot to zero; floor at 1 above ensures non-zero gift.
  const safeAmount = Math.min(amount, Math.max(1, actor.wealth - 1));
  return {
    actor_id: actor.id,
    target_id: target.id,
    amount: safeAmount,
    actor_memory: {
      year,
      kind: 'gave-gift',
      summary: `gifted wealth`,
      magnitude: 0.4,
      tone: 'reportage',
      counterparty_id: target.id,
    },
    target_memory: {
      year,
      kind: 'received-gift',
      summary: `received a gift`,
      magnitude: 0.5,
      tone: 'reportage',
      counterparty_id: actor.id,
    },
  };
}

// ─── donate (§8.3) ──────────────────────────────────────────────────────────
//
// Tithe a fraction of personal wealth to actor's religion. Tier picked from
// happiness:
//   0–33   → 1% of wealth   (low — duty-only)
//   34–66  → 5% of wealth   (mid — comfortable)
//   67–100 → 10% of wealth  (high — generous)
// Donation also bumps actor happiness by RELIGION_DONATE_HAPPINESS_BUMP.

export interface DonateDescriptor {
  actor_id: string;
  /** Religion (group) id, NOT a person id. Executor loads the Group row. */
  religion_id: string;
  /** Whole gold units; debited from actor.wealth, credited to religion treasury. */
  amount: number;
  happiness_bump: number;
  actor_memory: Memory;
}

export function planDonate(
  actor: PersonSnapshot,
  religionId: string,
  year: number,
): DonateDescriptor {
  const tier =
    actor.happiness >= 67
      ? RELIGION_DONATE_TIER_HIGH
      : actor.happiness >= 34
        ? RELIGION_DONATE_TIER_MID
        : RELIGION_DONATE_TIER_LOW;
  const raw = Math.floor(Math.max(0, actor.wealth) * tier);
  // Floor at 1 so a "donate" intent always actually moves a coin (the 100-
  // wealth eligibility floor guarantees ≥1 at even the low tier).
  const amount = Math.max(1, Math.min(raw, Math.max(0, actor.wealth)));
  return {
    actor_id: actor.id,
    religion_id: religionId,
    amount,
    happiness_bump: RELIGION_DONATE_HAPPINESS_BUMP,
    actor_memory: {
      year,
      kind: 'donated-religion',
      summary: `tithed to their faith`,
      magnitude: 0.4,
      tone: 'literary',
    },
  };
}
