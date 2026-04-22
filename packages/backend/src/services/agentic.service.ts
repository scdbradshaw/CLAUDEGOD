// ============================================================
// AGENTIC SERVICE — Phase 7 Wave 3
// ------------------------------------------------------------
// Annual pass where the most "active" members of the population
// take a deliberate action instead of just reacting to random
// interaction rolls. The actions are chosen from the agent's
// existing social graph and personality, so the world reads as
// having intent, not just noise.
//
// Actions (v1):
//   - befriend          — solidify a warm-but-not-close edge into close_friend
//   - betray            — flip an existing close_friend into a rival/enemy
//   - marry             — convert a strong lover/close_friend edge into spouse
//   - murder            — kill a low-bond enemy (requires low-morality agent)
//   - attempt_conception — a bonded pair (bond ≥ conceive_bond_min) creates
//                           a Pregnancy row; resolves later into a Person
//                           via createChildFromParents.
//
// Scope:
//   - Runs only on year-boundary ticks (annual cadence).
//   - Caps at min(100, 2% of living population) — keeps costs bounded
//     even at civilization tier.
//   - Lives inside the year-boundary transaction boundary upstream.
// ============================================================
//
// Note on modularity: the per-action handlers each take a tx and a
// small typed context. They write memories + relationship deltas
// directly so the caller only has to loop and collect results.

import { Prisma, Tone } from '@prisma/client';
import type { CriminalRecord } from '@civ-sim/shared';
import { applyRelationshipDeltas, type RelationshipDelta } from './relationships.service';
import { writeMemoriesBatch, type MemoryWriteInput, type MemoryEventKind } from './memory.service';
import { handlePersonDeath, type ReligionDissolveResult } from './group-lifecycle.service';
import { distributeInheritance, type InheritanceResult } from './economy-occupation.service';

// ── Tunables ────────────────────────────────────────────────

/** Fraction of living population that gets to act each year. */
const AGENT_POP_FRACTION = 0.02;
/** Hard cap so civilization-tier worlds don't spike annually. */
const AGENT_HARD_CAP = 100;
/** Skip if world has fewer living people than this. */
const MIN_POP_FOR_AGENCY = 10;

/** Score thresholds for selecting an action based on a target edge. */
const BEFRIEND_BOND_MIN = 55;   // warm but not already close
const BEFRIEND_BOND_MAX = 74;
const BETRAY_BOND_MIN    = 75;  // close enough to hurt
const MARRY_BOND_MIN     = 80;  // deeply bonded
const MURDER_BOND_MAX    = 15;  // intense enmity only
const MURDER_MORALITY_MAX = 25; // callous agent only
const CONCEIVE_BOND_MIN  = 60;  // warm enough to choose to have a child

// ── Types ───────────────────────────────────────────────────

export interface AgentPersonSnapshot {
  id:     string;
  name:   string;
  age:    number;
  traits: Record<string, number>;
  wealth: number;
  relationship_status: string;
  criminal_record: CriminalRecord[];
}

export interface OwnedEdge {
  target_id:     string;
  relation_type: 'parent' | 'child' | 'sibling' | 'spouse' | 'lover'
               | 'close_friend' | 'rival' | 'enemy';
  bond_strength: number;
}

export type AgenticActionKind =
  | 'befriend'
  | 'betray'
  | 'marry'
  | 'murder'
  | 'attempt_conception';

/**
 * Ruleset-tunable knob for the agentic conception action. `enabled: false`
 * disables the agentic path entirely (interaction-driven conception still
 * works). `bond_min` overrides the default CONCEIVE_BOND_MIN.
 */
export interface ConceiveConfig {
  enabled?: boolean;
  bond_min?: number;
}

export interface AgenticActionLog {
  kind:          AgenticActionKind;
  agent_id:      string;
  agent_name:    string;
  target_id:     string;
  target_name:   string;
  /** Side effect: the target died. Used by the caller to attribute deaths. */
  killed_target: boolean;
}

export interface AgenticRunResult {
  actions:            AgenticActionLog[];
  religion_dissolves: ReligionDissolveResult[];
  /** Wave 4 — inheritance payouts triggered by this turn's murders. */
  inheritances:       InheritanceResult[];
}

// ── Selection ───────────────────────────────────────────────

/**
 * Ranks people by a composite "ready to act" score. The idea is that
 * high-influence people, strong moral poles, and people with extreme
 * relationships (either loving or hating) are the ones who drive story.
 * Children (< 14) are filtered out — no agency for kids in v1.
 */
export function selectAgents(
  living:   AgentPersonSnapshot[],
  linksOf:  Map<string, OwnedEdge[]>,
  k:        number,
): AgentPersonSnapshot[] {
  if (k <= 0) return [];

  const scored = living
    .filter(p => p.age >= 14)
    .map(p => {
      const edges = linksOf.get(p.id) ?? [];
      const maxBondDev = edges.reduce(
        (m, e) => Math.max(m, Math.abs(e.bond_strength - 50)),
        0,
      );
      const honestyDev = Math.abs((p.traits['honesty'] ?? 50) - 50);
      const score = (p.traits['leadership'] ?? 50) + honestyDev * 2 + maxBondDev * 2;
      return { person: p, score };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(s => s.person);
}

// ── Action decision ─────────────────────────────────────────

type PlannedAction =
  | { kind: 'befriend';            target: OwnedEdge }
  | { kind: 'betray';              target: OwnedEdge }
  | { kind: 'marry';               target: OwnedEdge }
  | { kind: 'murder';              target: OwnedEdge }
  | { kind: 'attempt_conception';  target: OwnedEdge };

/**
 * Pick the most interesting action available to this agent given their
 * personality and existing edges. Tries the high-stakes options first
 * (murder, marry) before falling back to softer changes (betray, befriend).
 * Returns null if no suitable edge exists — the agent "acts" by doing
 * nothing that year, which is realistic noise.
 */
export function pickActionFor(
  agent:  AgentPersonSnapshot,
  edges:  OwnedEdge[],
  byId:   Map<string, AgentPersonSnapshot>,
  config: { conceive?: ConceiveConfig } = {},
): PlannedAction | null {
  if (edges.length === 0) return null;

  // Only consider targets that are still alive this tick.
  const live = edges.filter(e => byId.has(e.target_id));
  if (live.length === 0) return null;

  // Murder — low-honesty agent, intense enmity target.
  if ((agent.traits['honesty'] ?? 50) <= MURDER_MORALITY_MAX) {
    const victim = live
      .filter(e => e.relation_type === 'enemy' && e.bond_strength <= MURDER_BOND_MAX)
      .sort((a, b) => a.bond_strength - b.bond_strength)[0];
    if (victim) return { kind: 'murder', target: victim };
  }

  // Marry — both single, deep bond already (close_friend/lover/spouse≥80).
  if (agent.relationship_status === 'Single') {
    const romantic = live
      .filter(e =>
        (e.relation_type === 'lover' || e.relation_type === 'close_friend')
        && e.bond_strength >= MARRY_BOND_MIN
        && byId.get(e.target_id)?.relationship_status === 'Single',
      )
      .sort((a, b) => b.bond_strength - a.bond_strength)[0];
    if (romantic) return { kind: 'marry', target: romantic };
  }

  // Betray — flip a very close friend cold. Low-morality agents preferred
  // but not required; a scorned friend of any morality can snap.
  const traitor = live
    .filter(e => e.relation_type === 'close_friend' && e.bond_strength >= BETRAY_BOND_MIN)
    .sort((a, b) => b.bond_strength - a.bond_strength)[0];
  if (traitor && ((agent.traits['honesty'] ?? 50) <= 40 || Math.random() < 0.3)) {
    return { kind: 'betray', target: traitor };
  }

  // Befriend — cement a warm but not close edge.
  const friend = live
    .filter(e =>
      (e.relation_type === 'close_friend' || e.relation_type === 'rival')
      && e.bond_strength >= BEFRIEND_BOND_MIN
      && e.bond_strength <= BEFRIEND_BOND_MAX,
    )
    .sort((a, b) => b.bond_strength - a.bond_strength)[0];
  if (friend) return { kind: 'befriend', target: friend };

  // Attempt conception — bonded pair (spouse/lover/close_friend with strong
  // bond). Any age, any gender — the world has no biological gating (§4.1).
  // Fires only if the agent isn't already a parent of an unresolved pregnancy
  // (checked in executeActions since this planner is side-effect-free).
  const conceive = config.conceive ?? {};
  if (conceive.enabled !== false) {
    const bondMin = conceive.bond_min ?? CONCEIVE_BOND_MIN;
    const mate = live
      .filter(e =>
        (e.relation_type === 'spouse' || e.relation_type === 'lover' || e.relation_type === 'close_friend')
        && e.bond_strength >= bondMin,
      )
      .sort((a, b) => b.bond_strength - a.bond_strength)[0];
    if (mate) return { kind: 'attempt_conception', target: mate };
  }

  return null;
}

// ── Execution ───────────────────────────────────────────────

/**
 * Apply planned actions within the given transaction. Writes memories,
 * relationship deltas, status/stat updates, and handles murders (including
 * religion-founder cascades). All actions share a single relationship delta
 * batch at the end so we only make one upsert round-trip regardless of N.
 */
export async function executeActions(
  tx:           Prisma.TransactionClient,
  agents:       AgentPersonSnapshot[],
  plans:        Map<string, PlannedAction>,   // agentId -> action
  byId:         Map<string, AgentPersonSnapshot>,
  worldYear:    number,
  worldId:      string,
  ctx:          {
    startedTick:            number;
    pregnancyDurationTicks: number;
  },
): Promise<AgenticRunResult> {
  const logs:        AgenticActionLog[] = [];
  const memories:    MemoryWriteInput[] = [];
  const relDeltas:   RelationshipDelta[] = [];
  const religionDissolves: ReligionDissolveResult[] = [];
  const inheritances:      InheritanceResult[]      = [];

  // Status + stat updates batched as separate UPDATEs for clarity — the
  // counts here are small (K ≤ 100) so a bulk-SQL path isn't worth it.
  const statusUpdates: { id: string; status: string }[] = [];
  const criminalRecordAdds: Map<string, CriminalRecord> = new Map();
  const pendingKills: { agentId: string; victim: AgentPersonSnapshot }[] = [];

  for (const agent of agents) {
    const plan = plans.get(agent.id);
    if (!plan) continue;
    const target = byId.get(plan.target.target_id);
    if (!target) continue;

    switch (plan.kind) {
      case 'befriend': {
        relDeltas.push({
          ownerId: agent.id, targetId: target.id,
          kind: 'close_friend', strengthDelta: 15,
        });
        relDeltas.push({
          ownerId: target.id, targetId: agent.id,
          kind: 'close_friend', strengthDelta: 10,
        });
        memories.push(makeMemory(agent.id, target.id,
          `Deepened friendship with ${target.name}.`,
          'positive', 0.5, agent.age, worldYear));
        memories.push(makeMemory(target.id, agent.id,
          `${agent.name} reached out in friendship.`,
          'positive', 0.4, target.age, worldYear));
        logs.push(log('befriend', agent, target, false));
        break;
      }

      case 'betray': {
        relDeltas.push({
          ownerId: agent.id, targetId: target.id,
          kind: 'close_friend', strengthDelta: -45,
        });
        relDeltas.push({
          ownerId: agent.id, targetId: target.id,
          kind: 'rival', strengthDelta: 15,
        });
        relDeltas.push({
          ownerId: target.id, targetId: agent.id,
          kind: 'enemy', strengthDelta: 20,
        });
        memories.push(makeMemory(agent.id, target.id,
          `Betrayed ${target.name}, a once-close friend.`,
          'negative', 0.7, agent.age, worldYear));
        memories.push(makeMemory(target.id, agent.id,
          `${agent.name}'s betrayal shattered their trust.`,
          'traumatic', 0.9, target.age, worldYear));
        logs.push(log('betray', agent, target, false));
        break;
      }

      case 'marry': {
        relDeltas.push({
          ownerId: agent.id, targetId: target.id,
          kind: 'spouse', strengthDelta: 30,
        });
        relDeltas.push({
          ownerId: target.id, targetId: agent.id,
          kind: 'spouse', strengthDelta: 30,
        });
        statusUpdates.push({ id: agent.id,  status: 'Married' });
        statusUpdates.push({ id: target.id, status: 'Married' });
        memories.push(makeMemory(agent.id, target.id,
          `Married ${target.name}.`,
          'euphoric', 0.9, agent.age, worldYear, 'marriage'));
        memories.push(makeMemory(target.id, agent.id,
          `Married ${agent.name}.`,
          'euphoric', 0.9, target.age, worldYear, 'marriage'));
        logs.push(log('marry', agent, target, false));
        break;
      }

      case 'attempt_conception': {
        // Skip if either parent already carries an unresolved pregnancy —
        // one-at-a-time per person, regardless of partner.
        const existing = await tx.pregnancy.findFirst({
          where: {
            world_id: worldId,
            resolved: false,
            OR: [
              { parent_a_id: agent.id },  { parent_b_id: agent.id },
              { parent_a_id: target.id }, { parent_b_id: target.id },
            ],
          },
          select: { id: true },
        });
        if (existing) break;

        await tx.pregnancy.create({
          data: {
            parent_a_id:  agent.id,
            parent_b_id:  target.id,
            world_id:     worldId,
            started_tick: ctx.startedTick,
            due_tick:     ctx.startedTick + ctx.pregnancyDurationTicks,
          },
        });
        memories.push(makeMemory(agent.id, target.id,
          `Expecting a child with ${target.name}.`,
          'euphoric', 0.7, agent.age, worldYear));
        memories.push(makeMemory(target.id, agent.id,
          `Expecting a child with ${agent.name}.`,
          'euphoric', 0.7, target.age, worldYear));
        logs.push(log('attempt_conception', agent, target, false));
        break;
      }

      case 'murder': {
        // Record the kill; defer the actual death handling until after
        // memory/relationship writes so we don't double-write memories
        // that reference a just-deleted person.
        pendingKills.push({ agentId: agent.id, victim: target });
        criminalRecordAdds.set(agent.id, {
          offense:  `Murder of ${target.name}`,
          date:     `Year ${worldYear}`,
          severity: 'severe',
          status:   'pending',
        });
        memories.push(makeMemory(agent.id, target.id,
          `Murdered ${target.name}.`,
          'traumatic', 1.0, agent.age, worldYear, 'crime'));
        // Target dies — no memory written for them (their memory rows
        // cascade on delete anyway).
        logs.push(log('murder', agent, target, true));
        break;
      }
    }
  }

  // ── Writes ──
  if (memories.length > 0) await writeMemoriesBatch(tx, memories);
  await applyRelationshipDeltas(tx, relDeltas);

  for (const s of statusUpdates) {
    await tx.person.update({
      where: { id: s.id },
      data:  { relationship_status: s.status },
    });
  }

  for (const [agentId, rec] of criminalRecordAdds) {
    await tx.$executeRaw`
      UPDATE persons SET
        criminal_record = COALESCE(criminal_record, '[]'::jsonb) || ${JSON.stringify([rec])}::jsonb,
        updated_at      = NOW()
      WHERE id = ${agentId}::uuid
    `;
  }

  // Kills last — run the existing death handler + Wave 4 inheritance so
  // religion-founder cascades fire and liquid wealth transfers exactly like
  // a natural death.
  for (const k of pendingKills) {
    const dissolved = await handlePersonDeath(tx, k.victim.id, k.victim.name, worldYear, worldId);
    religionDissolves.push(...dissolved);
    const inh = await distributeInheritance(tx, k.victim.id, k.victim.name, k.victim.wealth, worldYear);
    if (inh.heirs.length > 0) inheritances.push(inh);
    await tx.deceasedPerson.create({
      data: {
        name:         k.victim.name,
        age_at_death: k.victim.age,
        world_year:   worldYear,
        cause:        'interaction',
        final_health: 0,
        final_wealth: k.victim.wealth,
        world_id:     worldId,
      },
    });
    await tx.person.delete({ where: { id: k.victim.id } });
  }

  return { actions: logs, religion_dissolves: religionDissolves, inheritances };
}

// ── Orchestrator ────────────────────────────────────────────

/**
 * Top-level entry point called from the tick engine on year-boundary
 * ticks. Selects agents, plans actions, and executes them in the
 * supplied transaction. Returns a summary the tick handler can surface
 * in its response payload.
 */
export async function runAgenticTurn(
  tx:        Prisma.TransactionClient,
  living:    AgentPersonSnapshot[],
  linksOf:   Map<string, OwnedEdge[]>,
  worldYear: number,
  worldId:   string,
  ctx:       {
    startedTick:            number;
    pregnancyDurationTicks: number;
    conceive?:              ConceiveConfig;
  },
): Promise<AgenticRunResult> {
  if (living.length < MIN_POP_FOR_AGENCY) return { actions: [], religion_dissolves: [], inheritances: [] };

  const k = Math.min(AGENT_HARD_CAP, Math.max(1, Math.floor(living.length * AGENT_POP_FRACTION)));
  const agents = selectAgents(living, linksOf, k);
  if (agents.length === 0) return { actions: [], religion_dissolves: [], inheritances: [] };

  const byId = new Map(living.map(p => [p.id, p]));

  // Plan actions first, then execute as a batch. Planning reads the
  // pre-turn state so concurrent agents don't observe each other's
  // partial effects — makes the year's outcomes reproducible.
  const plans = new Map<string, PlannedAction>();
  for (const a of agents) {
    const edges = linksOf.get(a.id) ?? [];
    const plan  = pickActionFor(a, edges, byId, { conceive: ctx.conceive });
    if (plan) plans.set(a.id, plan);
  }
  if (plans.size === 0) return { actions: [], religion_dissolves: [], inheritances: [] };

  return executeActions(tx, agents, plans, byId, worldYear, worldId, {
    startedTick:            ctx.startedTick,
    pregnancyDurationTicks: ctx.pregnancyDurationTicks,
  });
}

// ── Helpers ─────────────────────────────────────────────────

function log(
  kind: AgenticActionKind,
  agent: AgentPersonSnapshot,
  target: AgentPersonSnapshot,
  killedTarget: boolean,
): AgenticActionLog {
  return {
    kind,
    agent_id:      agent.id,
    agent_name:    agent.name,
    target_id:     target.id,
    target_name:   target.name,
    killed_target: killedTarget,
  };
}

function makeMemory(
  personId:    string,
  counterparty: string,
  summary:     string,
  impact:      'negative' | 'neutral' | 'positive' | 'euphoric' | 'traumatic',
  magnitude:   number,
  ageAtEvent:  number,
  worldYear:   number,
  eventKind:   MemoryEventKind = 'interaction',
): MemoryWriteInput {
  return {
    personId,
    eventSummary:    summary,
    emotionalImpact: impact,
    deltaApplied:    { kind: 'agentic' },
    magnitude,
    counterpartyId:  counterparty,
    worldYear,
    tone:            Tone.literary,
    ageAtEvent,
    eventKind,
  };
}
