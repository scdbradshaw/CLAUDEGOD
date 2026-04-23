// ============================================================
// TICK PHASE — resolve interactions (Round 5)
// ------------------------------------------------------------
// The per-protagonist loop extracted out of /api/interactions/tick so
// it can be tested and profiled independently. Makes no DB writes —
// only accumulates intents into maps that the persistence phase flushes
// in a single transaction.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import type {
  GlobalTraitSet,
  RulesetDef,
  TraitSet,
  Tone,
} from '@civ-sim/shared';
import { TRAUMA_SCORE_PENALTY, K_INTERACTION_PAIRS } from '@civ-sim/shared';
import { toneForOutcomeBand } from '../services/tone.service';
import {
  viralJoinsForPair,
  type JoinCandidate,
  type PersonSnapshot,
  type GroupSnapshot,
} from '../services/membership.service';
import {
  tryEmergentSpawn,
  tryEventSpawn,
  type SpawnIntent,
} from '../services/group-formation.service';
import type { OwnedEdge } from '../services/agentic.service';
import {
  pickInteractionType,
  computeScore,
  findBand,
  getEffects,
  applyEffectPacket,
  emotionalImpactForMagnitude,
  invertImpact,
  computeGrudgeBonus,
} from './scoring';

// ── Tunables shared with the route handler ─────────────────
const CONNECTION_PICK_PROB = 0.60;

// ── Types ────────────────────────────────────────────────────

export type PendingMemory = {
  person_id:       string;
  event_summary:   string;
  emotional_impact: 'traumatic' | 'negative' | 'neutral' | 'positive' | 'euphoric';
  magnitude:       number;
  counterparty_id: string | null;
  tone:            Tone;
  age_at_event:    number;
};

export interface LivingPersonLite {
  id:           string;
  name:         string;
  age:          number;
  current_health: number;
  trauma_score: number;
  traits:       unknown;
}

export interface ResolveInteractionsInput {
  prisma:       PrismaClient;
  rules:        RulesetDef;
  living:       LivingPersonLite[];
  byId:         Map<string, LivingPersonLite>;
  linksOf:      Map<string, OwnedEdge[]>;
  personSnaps:  Map<string, PersonSnapshot>;
  groups:       { byId: Map<string, GroupSnapshot> };
  memberships: {
    religionsByPerson: Map<string, Set<string>>;
    factionsByPerson:  Map<string, Set<string>>;
  };
  globalTraits: GlobalTraitSet;
  traitMults:   Record<string, number>;
}

export interface ResolveInteractionsOutput {
  traitDeltas:                Record<string, Record<string, number>>;
  topScores:                  Record<string, { protagonist_name: string; score: number; outcome: string }>;
  pendingMemories:            PendingMemory[];
  pendingJoinsByKey:          Map<string, JoinCandidate>;
  pendingSpawnsByFounder:     Map<string, SpawnIntent>;
  pendingPregnanciesByPair:   Map<string, { parent_a_id: string; parent_b_id: string }>;
  interactionsProcessed:      number;
}

// ── Antagonizer picker ────────────────────────────────────────

function pickAntagonizer(
  subject:   LivingPersonLite,
  allLiving: LivingPersonLite[],
  byId:      Map<string, LivingPersonLite>,
  linksOf:   Map<string, OwnedEdge[]>,
): LivingPersonLite | null {
  const pool = allLiving.filter(p => p.id !== subject.id);
  if (pool.length === 0) return null;

  const useConnection = Math.random() < CONNECTION_PICK_PROB;
  const links = linksOf.get(subject.id);

  if (useConnection && links && links.length > 0) {
    const alive = links.filter(l => byId.has(l.target_id));
    if (alive.length > 0) {
      const totalWeight = alive.reduce((s, l) => s + Math.max(1, l.bond_strength), 0);
      let roll = Math.random() * totalWeight;
      for (const l of alive) {
        roll -= Math.max(1, l.bond_strength);
        if (roll <= 0) {
          const picked = byId.get(l.target_id);
          if (picked) return picked;
        }
      }
    }
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Phase entrypoint ────────────────────────────────────────

/**
 * Run one tick's worth of protagonist interactions. Every living person
 * gets one turn as protagonist; antagonist is picked via the 60/40
 * hybrid (bond-weighted vs wild-card). All accumulated intents are
 * returned for the persistence phase to flush.
 */
export async function resolveInteractionsPhase(
  input: ResolveInteractionsInput,
): Promise<ResolveInteractionsOutput> {
  const {
    prisma, rules, living, byId, linksOf, personSnaps,
    groups, memberships, globalTraits, traitMults,
  } = input;

  const traitDeltas:              Record<string, Record<string, number>> = {};
  const topScores:                Record<string, { protagonist_name: string; score: number; outcome: string }> = {};
  const pendingMemories:          PendingMemory[] = [];
  const pendingJoinsByKey:        Map<string, JoinCandidate> = new Map();
  const pendingSpawnsByFounder:   Map<string, SpawnIntent>   = new Map();
  const pendingPregnanciesByPair: Map<string, { parent_a_id: string; parent_b_id: string }> = new Map();

  // Sample K_INTERACTION_PAIRS pairs rather than iterating all N protagonists.
  // Cost is O(K) regardless of population size.
  const K = Math.min(K_INTERACTION_PAIRS, living.length > 1 ? living.length * (living.length - 1) : 0);

  for (let _i = 0; _i < K; _i++) {
    const protagonist = living[Math.floor(Math.random() * living.length)];
    const antagonist = pickAntagonizer(protagonist, living, byId, linksOf);
    if (!antagonist) continue;

    const iType        = pickInteractionType(rules.interaction_types);
    const protagTraits = (protagonist.traits ?? {}) as TraitSet;

    const grudgeBonus   = await computeGrudgeBonus(prisma, protagonist.id, antagonist.id);
    const traumaPenalty = Math.round(protagonist.trauma_score * TRAUMA_SCORE_PENALTY);
    const score         = computeScore(iType, protagTraits, globalTraits, traitMults, grudgeBonus) - traumaPenalty;
    const band          = findBand(score, rules.outcome_bands);

    if (!topScores[iType.id] || score > topScores[iType.id].score) {
      topScores[iType.id] = {
        protagonist_name: protagonist.name,
        score,
        outcome: band.label,
      };
    }

    const { subject, antagonist: antaPacket } = getEffects(band);
    applyEffectPacket(traitDeltas, protagonist.id, subject);
    applyEffectPacket(traitDeltas, antagonist.id,  antaPacket);

    if (band.creates_memory) {
      const magnitude = band.magnitude ?? 0.5;
      const emotional = emotionalImpactForMagnitude(score, magnitude);
      const tone      = toneForOutcomeBand(band, iType);
      const summary   = `${iType.label} with ${antagonist.name} — ${band.label} (${score})`;
      pendingMemories.push({
        person_id:        protagonist.id,
        event_summary:    summary,
        emotional_impact: emotional,
        magnitude,
        counterparty_id:  antagonist.id,
        tone,
        age_at_event:     protagonist.age,
      });
      pendingMemories.push({
        person_id:        antagonist.id,
        event_summary:    `${iType.label} with ${protagonist.name} — ${band.label} (${score})`,
        emotional_impact: invertImpact(emotional),
        magnitude,
        counterparty_id:  protagonist.id,
        tone,
        age_at_event:     antagonist.age,
      });
    }

    const protoSnap = personSnaps.get(protagonist.id);
    const antaSnap  = personSnaps.get(antagonist.id);
    if (protoSnap && antaSnap) {
      const candidates = [
        ...viralJoinsForPair(protoSnap, antaSnap, groups, memberships),
        ...viralJoinsForPair(antaSnap, protoSnap, groups, memberships),
      ];
      for (const c of candidates) {
        const key = `${c.groupId}:${c.subject.id}`;
        const prev = pendingJoinsByKey.get(key);
        if (!prev || c.alignment > prev.alignment) {
          pendingJoinsByKey.set(key, c);
        }
      }

      const eventSpawn = tryEventSpawn(protoSnap, antaSnap, band);
      const spawn = eventSpawn ?? tryEmergentSpawn(protoSnap, band);
      if (spawn) pendingSpawnsByFounder.set(spawn.founderId, spawn);

      if (band.creates_pregnancy && iType.can_conceive) {
        const [a, b] = protagonist.id < antagonist.id
          ? [protagonist.id, antagonist.id]
          : [antagonist.id,  protagonist.id];
        pendingPregnanciesByPair.set(`${a}:${b}`, { parent_a_id: a, parent_b_id: b });
      }
    }
  }

  return {
    traitDeltas,
    topScores,
    pendingMemories,
    pendingJoinsByKey,
    pendingSpawnsByFounder,
    pendingPregnanciesByPair,
    interactionsProcessed: K,
  };
}
