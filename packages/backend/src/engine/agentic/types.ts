// Phase 9 — shared engine types for agentic actions (DESIGN.md §11).
//
// The planner consumes pre-loaded snapshots (no DB) and emits a list of
// intents. The service layer dispatches each intent against an open Prisma
// transaction.

import type {
  ActionQueueEntry,
  AgenticActionType,
  PersonalityTag,
  RelationshipKind,
  StateTag,
} from '@claude-god/shared';

/** Minimal Person view the engine needs to evaluate eligibility / weights. */
export interface PersonSnapshot {
  id: string;
  age: number;
  city_id: string;
  type: string;
  gender: string;
  sexuality: number;
  spouse_id: string | null;
  wealth: number;
  combat: number;
  intelligence: number;
  happiness: number;
  is_pinned: boolean;
  faction_id: string | null;
  religion_id: string | null;
  personality_tags: PersonalityTag[];
  state_tags: StateTag[];
}

/** Minimal Relationship view for bond-aware weighting. */
export interface BondSnapshot {
  owner_id: string;
  target_id: string;
  kind: RelationshipKind;
  strength: number;
}

/** Pinned-person action queue snapshot. */
export interface QueuedActionSnapshot {
  person_id: string;
  entry: ActionQueueEntry;
}

/** A queued (pinned) intent that has been gate-checked by the planner. */
export interface QueuedIntent {
  source: 'queued';
  actor_id: string;
  action_type: AgenticActionType;
  target_id?: string;
  params?: Record<string, unknown>;
  /** scheduled_year of the queue entry (for round-trip status writes). */
  scheduled_year: number;
  /** If `gated`, the executor will skip and write a memory entry. */
  gate: 'pass' | 'fail';
  failure_reason?: string;
}

/** An engine-rolled intent (random-weighted, no queue). */
export interface EngineIntent {
  source: 'engine';
  actor_id: string;
  action_type: AgenticActionType;
  target_id?: string;
  params?: Record<string, unknown>;
}

export type AgenticIntent = QueuedIntent | EngineIntent;

export interface AgenticPlan {
  intents: AgenticIntent[];
}
