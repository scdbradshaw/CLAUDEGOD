// Phase 12 — God Mode hooks. Wraps catalog + drop/end + world patch.
// Phase 13a.12 — summon/kill mutations.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EventDef, EventType, PersonType } from '@claude-god/shared';
import { api } from '../lib/api';
import type { WorldEventRow } from './useActiveEvents';

export function useEventCatalog() {
  return useQuery<{ rows: EventDef[] }, Error, EventDef[]>({
    queryKey: ['eventCatalog'],
    queryFn: () => api(`/api/events/catalog`),
    select: (d) => d.rows,
    staleTime: 60 * 60_000,
  });
}

export function useEventHistory(worldId: string | undefined) {
  return useQuery<{ rows: WorldEventRow[] }, Error, WorldEventRow[]>({
    queryKey: ['events', { world_id: worldId, active: false }],
    queryFn: () => api(`/api/events?world_id=${worldId}&active=false`),
    enabled: !!worldId,
    select: (d) => d.rows,
  });
}

export interface DropEventArgs {
  world_id: string;
  event_def_id: EventType;
  year: number;
  city_id?: string;
  faction_id?: string;
}

export function useDropEvent() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, DropEventArgs>({
    mutationFn: (args) =>
      api(`/api/events`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['events', { world_id: vars.world_id, active: true }] });
      qc.invalidateQueries({ queryKey: ['events', { world_id: vars.world_id, active: false }] });
    },
  });
}

export function useEndEvent(worldId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { eventId: string; year: number }>({
    mutationFn: ({ eventId, year }) =>
      api(`/api/events/${eventId}/end`, {
        method: 'POST',
        body: JSON.stringify({ year }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['events', { world_id: worldId, active: true }] });
      qc.invalidateQueries({ queryKey: ['events', { world_id: worldId, active: false }] });
    },
  });
}

export interface UpdateWorldArgs {
  name?: string;
  prejudice_against_same_sex?: boolean;
}

export interface SummonArgs {
  world_id: string;
  city_id: string;
  type: PersonType;
  pin?: boolean;
}

export type SummonResult =
  | { kind: 'npc'; type: PersonType }
  | { kind: 'real'; id: string; name: string; type: PersonType; is_pinned: boolean };

export function useSummonPerson(worldId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<SummonResult, Error, SummonArgs>({
    mutationFn: (args) =>
      api(`/api/persons/summon`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] });
      qc.invalidateQueries({ queryKey: ['city'] });
      qc.invalidateQueries({ queryKey: ['pinCount', worldId] });
    },
  });
}

export function useKillPerson(worldId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<{ id: string; year: number }, Error, { personId: string }>({
    mutationFn: ({ personId }) =>
      api(`/api/persons/${personId}/kill`, { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] });
      qc.invalidateQueries({ queryKey: ['city'] });
      qc.invalidateQueries({ queryKey: ['pinCount', worldId] });
    },
  });
}

export interface BulkSummonArgs {
  world_id: string;
  city_id: string;
  type: PersonType;
  count: number;
  pin?: boolean;
}

export interface BulkSummonResult {
  requested: number;
  created: number;
  skipped_for_cap: number;
}

export function useBulkSummon(worldId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<BulkSummonResult, Error, BulkSummonArgs>({
    mutationFn: (args) =>
      api(`/api/persons/summon-bulk`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] });
      qc.invalidateQueries({ queryKey: ['city'] });
      qc.invalidateQueries({ queryKey: ['pinCount', worldId] });
    },
  });
}

export type BulkKillScope = 'npc' | 'real' | 'both';

export interface BulkKillArgs {
  world_id: string;
  type?: PersonType;
  is_pinned?: boolean;
  scope?: BulkKillScope;
  limit: number;
}

export interface BulkKillResult {
  killed: number;
  killed_npc: number;
  killed_real: number;
}

export function useBulkKill(worldId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<BulkKillResult, Error, BulkKillArgs>({
    mutationFn: (args) =>
      api(`/api/persons/kill-bulk`, {
        method: 'POST',
        body: JSON.stringify(args),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['persons'] });
      qc.invalidateQueries({ queryKey: ['city'] });
      qc.invalidateQueries({ queryKey: ['pinCount', worldId] });
      qc.invalidateQueries({ queryKey: ['killPreview'] });
    },
  });
}

export interface BulkKillPreviewArgs {
  world_id: string | undefined;
  type?: PersonType;
  is_pinned?: boolean;
  scope: BulkKillScope;
}

export interface BulkKillPreviewResult {
  npc: number;
  real: number;
  total: number;
}

export function useBulkKillPreview(args: BulkKillPreviewArgs) {
  const params = new URLSearchParams();
  if (args.world_id) params.set('world_id', args.world_id);
  if (args.type) params.set('type', args.type);
  if (args.is_pinned !== undefined) params.set('is_pinned', args.is_pinned ? 'true' : 'false');
  params.set('scope', args.scope);
  return useQuery<BulkKillPreviewResult, Error>({
    queryKey: ['killPreview', { world_id: args.world_id, type: args.type, is_pinned: args.is_pinned, scope: args.scope }],
    queryFn: () => api(`/api/persons/kill-preview?${params.toString()}`),
    enabled: !!args.world_id,
  });
}

export function useUpdateWorld(worldId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, UpdateWorldArgs>({
    mutationFn: (patch) =>
      api(`/api/worlds/${worldId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['world', worldId] });
      qc.invalidateQueries({ queryKey: ['worlds'] });
    },
  });
}
