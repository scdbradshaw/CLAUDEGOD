// World-scoped read hooks.

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { WorldDetail, WorldSummary } from '../lib/wireTypes';

export function useWorlds() {
  return useQuery<{ worlds: WorldSummary[] }>({
    queryKey: ['worlds'],
    queryFn: () => api('/api/worlds'),
  });
}

export function useWorld(worldId: string | undefined) {
  return useQuery<WorldDetail>({
    queryKey: ['world', worldId],
    queryFn: () => api(`/api/worlds/${worldId}`),
    enabled: !!worldId,
  });
}
