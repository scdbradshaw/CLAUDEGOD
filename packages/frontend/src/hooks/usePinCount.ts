// Pin-count snapshot for the control panel.
// Uses the existing /api/persons list endpoint with limit=1 — we only need `total`.

import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

export { REAL_PERSON_CAP } from '@claude-god/shared';

interface ListResp {
  rows: unknown[];
  total: number;
}

export function usePinCount(worldId: string | undefined) {
  return useQuery<ListResp, Error, number>({
    queryKey: ['persons', { world_id: worldId, limit: 1 }],
    queryFn: () =>
      api(`/api/persons?world_id=${worldId}&limit=1`),
    enabled: !!worldId,
    select: (data) => data.total,
  });
}
