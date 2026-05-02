// City-scoped hooks: detail, leaderboards, tax-rate update.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PersonType } from '@claude-god/shared';
import { api } from '../lib/api';
import type { BucketRow, CityRow } from '../lib/wireTypes';

export interface CityDetail {
  city: CityRow;
  buckets: BucketRow[];
  active_events: ActiveEvent[];
  dominant_faction: { id: string; name: string; kind: string } | null;
  dominant_religion: { id: string; name: string; kind: string } | null;
  real_counts: Partial<Record<PersonType, number>>;
}

export interface ActiveEvent {
  id: string;
  event_def_id: string;
  city_id: string | null;
  started_year: number;
  duration_years: number | null;
}

export type LeaderboardMetric =
  | 'richest'
  | 'poorest'
  | 'happiest'
  | 'smartest'
  | 'strongest'
  | 'oldest'
  | 'famous'
  | 'infamous';

export interface LeaderboardPerson {
  id: string;
  name: string;
  type: PersonType;
  age: number;
  wealth: number;
  happiness: number;
  intelligence: number;
  combat: number;
  is_pinned: boolean;
}

export function useCity(cityId: string | undefined) {
  return useQuery<CityDetail>({
    queryKey: ['city', cityId],
    queryFn: () => api(`/api/cities/${cityId}`),
    enabled: !!cityId,
  });
}

export function useLeaderboard(
  cityId: string | undefined,
  metric: LeaderboardMetric,
  limit = 10,
) {
  return useQuery<{ metric: LeaderboardMetric; rows: LeaderboardPerson[] }>({
    queryKey: ['leaderboards', cityId, metric, limit],
    queryFn: () =>
      api(
        `/api/cities/${cityId}/leaderboards?metric=${metric}&limit=${limit}`,
      ),
    enabled: !!cityId,
  });
}

export function useUpdateTaxRate(cityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ id: string; tax_rate: number }, Error, number>({
    mutationFn: (tax_rate) =>
      api(`/api/cities/${cityId}`, {
        method: 'PATCH',
        body: JSON.stringify({ tax_rate }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['city', cityId] });
    },
  });
}
