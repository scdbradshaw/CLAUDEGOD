// Person-scoped hooks: detail, pin/unpin, queue read/enqueue/dequeue.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AgenticActionType, PersonType } from '@claude-god/shared';
import { api } from '../lib/api';

export type { PersonType };

export interface PersonRow {
  id: string;
  world_id: string;
  city_id: string;
  type: PersonType;
  faction_id: string | null;
  faction_name: string | null;
  religion_id: string | null;
  religion_name: string | null;
  faction_joined_year: number | null;
  religion_joined_year: number | null;
  name: string;
  age: number;
  gender: string;
  race: string;
  sexuality: number;
  is_alive: boolean;
  is_pinned: boolean;
  combat: number;
  intelligence: number;
  happiness: number;
  wealth: number;
  current_health: number;
  personality_tags: string[];
  state_tags: { tag: string; set_year: number }[];
  recent_memories: Array<{
    year: number;
    kind: string;
    summary: string;
    magnitude: number;
    tone: string;
    counterparty_id?: string;
    counterparty_name?: string;
  }>;
  action_queue: Array<{
    action_type: AgenticActionType;
    target_id?: string;
    params?: Record<string, unknown>;
    scheduled_year: number;
  }>;
  spouse_id: string | null;
  mother_id: string | null;
  father_id: string | null;
  created_year: number;
  faction_wins: number;
  faction_leadership_years: number;
  faction_income_year: number;
}

export interface RelationshipRow {
  id: string;
  owner_id: string;
  target_id: string;
  target_name: string | null;
  kind: string;
  strength: number;
  set_year: number;
}

export interface DecadeSummaryRow {
  id: string;
  person_id: string;
  decade_start_year: number;
  ranked_memories: Array<{ text?: string; year: number; magnitude?: number }>;
  prior_summary_id: string | null;
}

export interface PersonDetail {
  person: PersonRow;
  relationships: RelationshipRow[];
  decade_summaries: DecadeSummaryRow[];
}

export function usePerson(personId: string | undefined) {
  return useQuery<PersonDetail>({
    queryKey: ['person', personId],
    queryFn: () => api(`/api/persons/${personId}`),
    enabled: !!personId,
  });
}

export interface FamilyMember {
  id: string;
  name: string;
  is_alive: boolean;
  age?: number;
  died_year?: number;
  age_at_demote?: number;
}

export interface FamilyLevel {
  generation: number;
  members: FamilyMember[];
}

export interface FamilyTree {
  ancestors: FamilyLevel[];
  descendants: FamilyLevel[];
}

export function usePersonFamily(personId: string | undefined) {
  return useQuery<FamilyTree>({
    queryKey: ['person', personId, 'family'],
    queryFn: () => api(`/api/persons/${personId}/family`),
    enabled: !!personId,
  });
}

export function usePinToggle(personId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<PersonRow, Error, boolean>({
    mutationFn: (shouldPin) =>
      api(`/api/persons/${personId}/${shouldPin ? 'pin' : 'unpin'}`, {
        method: 'POST',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['person', personId] });
      qc.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}

export interface EnqueuePayload {
  action_type: AgenticActionType;
  target_id?: string;
  params?: Record<string, unknown>;
  scheduled_year: number;
}

export function useEnqueueAction(personId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, EnqueuePayload>({
    mutationFn: (entry) =>
      api(`/api/persons/${personId}/queue`, {
        method: 'POST',
        body: JSON.stringify(entry),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['person', personId] }),
  });
}

export function useDequeueAction(personId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, number>({
    mutationFn: (scheduled_year) =>
      api(`/api/persons/${personId}/queue/${scheduled_year}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['person', personId] }),
  });
}

export interface UpdatePersonBody {
  name?: string;
  type?: PersonType;
  gender?: string;
  race?: string;
  sexuality?: number;
  age?: number;
  wealth?: number;
  current_health?: number;
  happiness?: number;
  intelligence?: number;
  combat?: number;
  faction_id?: string | null;
  religion_id?: string | null;
}

export function useUpdatePerson(personId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<PersonRow, Error, UpdatePersonBody>({
    mutationFn: (body) =>
      api(`/api/persons/${personId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['person', personId] });
      qc.invalidateQueries({ queryKey: ['persons'] });
    },
  });
}
