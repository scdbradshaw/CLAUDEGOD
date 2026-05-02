// Rich person-search hook (god-mode picker).
//
// Wraps POST /api/persons/search. Filter state lives in the consumer; this
// hook just turns the body into a TanStack Query.

import { useQuery, keepPreviousData } from '@tanstack/react-query';
import type {
  GroupKind,
  PersonType,
  PersonalityTag,
} from '@claude-god/shared';
import { api } from '../lib/api';

export type GroupFilterValue = string | 'none';

export interface PersonSearchFilter {
  world_id: string;
  q?: string;
  race?: string[];
  gender?: string[];
  is_alive?: boolean;
  is_pinned?: boolean;
  city_ids?: string[];
  types?: PersonType[];
  faction_ids?: GroupFilterValue[];
  religion_ids?: GroupFilterValue[];
  personality_tags?: PersonalityTag[];
  personality_mode?: 'any' | 'all';
  age_min?: number;
  age_max?: number;
  wealth_min?: number;
  wealth_max?: number;
  intelligence_min?: number;
  intelligence_max?: number;
  combat_min?: number;
  combat_max?: number;
  happiness_min?: number;
  happiness_max?: number;
  health_min?: number;
  health_max?: number;
  sort_by?:
    | 'name'
    | 'age'
    | 'wealth'
    | 'intelligence'
    | 'combat'
    | 'happiness'
    | 'created_year';
  sort_dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface PersonSearchRow {
  id: string;
  name: string;
  type: PersonType;
  race: string;
  gender: string;
  age: number;
  city_id: string;
  city_name: string | null;
  faction_id: string | null;
  faction_name: string | null;
  religion_id: string | null;
  religion_name: string | null;
  intelligence: number;
  combat: number;
  happiness: number;
  wealth: number;
  current_health: number;
  personality_tags: PersonalityTag[];
  is_alive: boolean;
  is_pinned: boolean;
  death_year: number | null;
}

export interface PersonSearchResponse {
  rows: PersonSearchRow[];
  total: number;
}

export function usePersonSearch(filter: PersonSearchFilter, enabled = true) {
  return useQuery<PersonSearchResponse>({
    queryKey: ['person-search', filter],
    queryFn: () =>
      api('/api/persons/search', {
        method: 'POST',
        body: JSON.stringify(filter),
      }),
    enabled: enabled && !!filter.world_id,
    placeholderData: keepPreviousData,
  });
}

// ─── Mini lists for filter dropdowns ─────────────────────────────────────

export interface CityMini {
  id: string;
  name: string;
}

export interface GroupMini {
  id: string;
  name: string;
  kind: GroupKind;
  is_active: boolean;
}

export function useCitiesMini(worldId: string | undefined) {
  return useQuery<{ cities: CityMini[] }>({
    queryKey: ['cities-mini', worldId],
    queryFn: () => api(`/api/worlds/${worldId}/cities-mini`),
    enabled: !!worldId,
    staleTime: 60_000,
  });
}

export function useGroupsMini(
  worldId: string | undefined,
  kind?: GroupKind,
  activeOnly = true,
) {
  const params = new URLSearchParams();
  if (kind) params.set('kind', kind);
  if (activeOnly) params.set('active', 'true');
  return useQuery<{ groups: GroupMini[] }>({
    queryKey: ['groups-mini', worldId, kind ?? 'any', activeOnly],
    queryFn: () =>
      api(`/api/worlds/${worldId}/groups-mini?${params.toString()}`),
    enabled: !!worldId,
    staleTime: 30_000,
  });
}
