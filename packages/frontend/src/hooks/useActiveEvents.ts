// Active world events for a world (active = ended_year is null).

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export interface WorldEventRow {
  id: string;
  world_id: string;
  event_def_id: string;
  city_id: string | null;
  faction_id: string | null;
  started_year: number;
  ended_year: number | null;
  duration_years: number | null;
}

export function useActiveEvents(worldId: string | undefined) {
  return useQuery<{ rows: WorldEventRow[] }, Error, WorldEventRow[]>({
    queryKey: ['events', { world_id: worldId, active: true }],
    queryFn: () => api(`/api/events?world_id=${worldId}&active=true`),
    enabled: !!worldId,
    select: (data) => data.rows,
  });
}
