// Group-scoped hooks: detail + dissolve + update + membership.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  GroupKind,
  PersonalityTag,
  PersonType,
} from '@claude-god/shared';
import { api } from '../lib/api';

export interface FactionAwardEntry {
  year: number;
  treasury_in_year: number;
  leader_id: string | null;
  leader_cut: number;
  ranks: Array<{
    person_id: string;
    rank: number;
    prize: number;
    income_this_year: number;
  }>;
  total_paid: number;
}

export interface GroupRow {
  id: string;
  world_id: string;
  kind: GroupKind;
  name: string;
  founder_id: string | null;
  leader_id: string | null;
  founded_year: number;
  dissolved_year: number | null;
  is_active: boolean;
  treasury: number;
  member_count_cached: number;
  dominant_city_id: string | null;
  wanted_tags: PersonalityTag[];
  type_affinities: Record<string, number>;
  stat_floors: Record<string, number>;
  cost_per_year: number;
  cost_pct_of_wealth: number | null;
  territory_cities: string[];
  tax_rate: number | null;
  army_size: number;
  at_war_with: string[];
  low_membership_years: number;
  last_schism_year: number | null;
  member_count_history: Array<{ year: number; count: number }>;
  // Faction-only competition config (null for religions).
  leader_dues_cut: number | null;
  prize_shares: number[] | null;
  competition_metric: string | null;
  intelligence_target: number | null;
  award_history: FactionAwardEntry[];
}

export interface GroupDetail {
  group: GroupRow;
  member_count_real: number;
  founder_name: string | null;
  founder_alive: boolean;
  leader_name: string | null;
  leader_alive: boolean;
}

export interface UpdateGroupBody {
  name?: string;
  leader_id?: string | null;
  wanted_tags?: PersonalityTag[];
  type_affinities?: Partial<Record<PersonType, number>>;
  stat_floors?: {
    intelligence_min?: number;
    combat_min?: number;
    wealth_min?: number;
    age_min?: number;
  };
  cost_per_year?: number;
  cost_pct_of_wealth?: number | null;
  territory_cities?: string[];
  tax_rate?: number | null;
  army_size?: number;
}

export function useGroup(groupId: string | undefined) {
  return useQuery<GroupDetail>({
    queryKey: ['group', groupId],
    queryFn: () => api(`/api/groups/${groupId}`),
    enabled: !!groupId,
  });
}

export function useUpdateGroup(groupId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<GroupRow, Error, UpdateGroupBody>({
    mutationFn: (body) =>
      api(`/api/groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['religions'] });
    },
  });
}

export function useDissolveGroup(groupId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, number>({
    mutationFn: (year) =>
      api(`/api/groups/${groupId}/dissolve`, {
        method: 'POST',
        body: JSON.stringify({ year }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['group', groupId] }),
  });
}

// ─── Membership ──────────────────────────────────────────────────────────

export interface MemberRow {
  id: string;
  name: string | null;
  type: PersonType;
  age: number;
  intelligence: number;
  combat: number;
  wealth: number;
  is_pinned: boolean;
  personality_tags: PersonalityTag[];
  faction_wins: number;
  faction_leadership_years: number;
  faction_income_year: number;
}

export interface MembersResponse {
  total: number;
  rows: MemberRow[];
}

export type GroupMemberSort = 'name' | 'wins' | 'leadership' | 'wealth' | 'income';

export function useGroupMembers(
  groupId: string | undefined,
  query?: string,
  limit = 50,
  sort?: GroupMemberSort,
) {
  const params = new URLSearchParams();
  if (query && query.trim()) params.set('q', query.trim());
  params.set('limit', String(limit));
  if (sort) params.set('sort', sort);
  return useQuery<MembersResponse>({
    queryKey: ['group-members', groupId, query ?? '', limit, sort ?? 'name'],
    queryFn: () => api(`/api/groups/${groupId}/members?${params.toString()}`),
    enabled: !!groupId,
  });
}

function invalidateGroup(qc: ReturnType<typeof useQueryClient>, groupId: string | undefined) {
  qc.invalidateQueries({ queryKey: ['group', groupId] });
  qc.invalidateQueries({ queryKey: ['group-members', groupId] });
  qc.invalidateQueries({ queryKey: ['religions'] });
}

export function useKickMember(groupId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (person_id) =>
      api(`/api/groups/${groupId}/kick`, {
        method: 'POST',
        body: JSON.stringify({ person_id }),
      }),
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}

export function useConvertMember(groupId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, string>({
    mutationFn: (person_id) =>
      api(`/api/groups/${groupId}/convert`, {
        method: 'POST',
        body: JSON.stringify({ person_id }),
      }),
    onSuccess: () => invalidateGroup(qc, groupId),
  });
}
