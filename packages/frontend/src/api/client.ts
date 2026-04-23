// ============================================================
// API CLIENT — thin wrapper around fetch
// ============================================================

import type {
  Person,
  MemoryEntry,
  DeltaRequest,
  MutationResult,
  CharacterListItem,
  PaginatedResponse,
  CriminalRecordEntry,
  RulesetDef,
  EconomyState,
  DeceasedPerson,
  BulkActionRequest,
  BulkActionResult,
  World,
  WorldListItem,
  PopulationTier,
  PeopleListItem,
  PeopleSearchParams,
  CityWithStats,
} from '@civ-sim/shared';

// ── Rip (Phase 7) ─────────────────────────────────────────────
// Query shape for GET /api/rip. Matches the backend whitelist.
export interface RipListParams {
  limit?:    number;
  year_min?: number;
  year_max?: number;
  cause?:    'interaction' | 'old_age' | 'health';
  sort?:     'died_at' | 'world_year' | 'age_at_death' | 'final_money' | 'name';
  order?:    'asc' | 'desc';
}

export interface RipListResponse {
  deceased: DeceasedPerson[];
  meta: {
    total:     number;
    limit:     number;
    city_name: string;
  };
}

// Phase 7 Wave 2 — one row of a person's social graph (outgoing edge).
export type RelationshipKind =
  | 'parent' | 'child' | 'sibling' | 'spouse' | 'lover'
  | 'close_friend' | 'rival' | 'enemy';

export interface RelationshipRow {
  id:            string;
  owner_id:      string;
  target_id:     string;
  relation_type: RelationshipKind;
  bond_strength: number;
  target_name:   string;
  target_alive:  boolean;
  updated_at:    string;
}

// Round 2 — immediate genealogy returned by /api/characters/:id/lineage.
// Only living parents/children appear; deaths migrate rows out of `persons`
// and SET NULL the self-relations.
export interface LineagePerson {
  id:       string;
  name:     string;
  age:      number;
  health:   number;
  race:     string;
  religion: string;
}
export interface LineageResponse {
  parents:  LineagePerson[];
  children: LineagePerson[];
}

export type { City, CityWithStats } from '@civ-sim/shared';

// ── Group types ──────────────────────────────────────────────

export interface GroupListItem {
  id:            string;
  name:          string;
  description:   string | null;
  is_active:     boolean;
  member_count:  number;
  cost_per_tick: number;
  tolerance:     number;
  virus_profile: Record<string, { min?: number; max?: number }>;
  trait_minimums: Record<string, number>;
  founded_year:  number;
  founder:       { id: string; name: string } | null;
  leader?:       { id: string; name: string } | null;
  origin:        string;
}

export interface GroupMember {
  id:         string;
  alignment:  number;
  joined_year: number;
  person:     { id: string; name: string; age: number };
}

export interface GroupDetail extends GroupListItem {
  memberships: GroupMember[];
}

export interface PatchGroupBody {
  name?:           string;
  description?:    string | null;
  tolerance?:      number;
  cost_per_tick?:  number;
  virus_profile?:  Record<string, { min?: number; max?: number }>;
  trait_minimums?: Record<string, number>;
  leader_id?:      string | null;
}

const BASE = '/api';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Characters ───────────────────────────────────────────────

export const api = {
  characters: {
    list: (page = 1, limit = 20) =>
      request<PaginatedResponse<CharacterListItem>>(
        `/characters?page=${page}&limit=${limit}`,
      ),

    get: (id: string) =>
      request<Person & { memory_bank: MemoryEntry[] }>(`/characters/${id}`),

    create: (body: Omit<Person, 'id' | 'created_at' | 'updated_at'>) =>
      request<Person>('/characters', { method: 'POST', body: JSON.stringify(body) }),

    bulk: (count: number, archetype?: string) =>
      request<{ created: number }>('/characters/bulk', {
        method: 'POST',
        body:   JSON.stringify({ count, ...(archetype ? { archetype } : {}) }),
      }),

    seed: () =>
      request<{ seeded: boolean; count: number }>('/characters/seed'),

    search: (params: PeopleSearchParams = {}) => {
      const q = new URLSearchParams();
      if (params.status)                  q.set('status',    params.status);
      if (params.age_min !== undefined)   q.set('age_min',   String(params.age_min));
      if (params.age_max !== undefined)   q.set('age_max',   String(params.age_max));
      if (params.races?.length)           q.set('races',     params.races.join(','));
      if (params.religions?.length)       q.set('religions', params.religions.join(','));
      if (params.factions?.length)        q.set('factions',  params.factions.join(','));
      if (params.q)                       q.set('q',         params.q);
      if (params.sort)                    q.set('sort',      params.sort);
      if (params.order)                   q.set('order',     params.order);
      if (params.page  !== undefined)     q.set('page',      String(params.page));
      if (params.limit !== undefined)     q.set('limit',     String(params.limit));
      return request<PaginatedResponse<PeopleListItem>>(`/characters/search?${q.toString()}`);
    },

    delete: (id: string) =>
      request<void>(`/characters/${id}`, { method: 'DELETE' }),

    bulkKill: (count: number) =>
      request<{ killed: number; names: string[] }>('/characters/bulk-kill', {
        method: 'POST',
        body:   JSON.stringify({ count }),
      }),

    applyDelta: (id: string, body: DeltaRequest) =>
      request<MutationResult>(`/characters/${id}/delta`, {
        method: 'POST',
        body:   JSON.stringify(body),
      }),

    addCriminalRecord: (id: string, body: CriminalRecordEntry) =>
      request<MutationResult>(`/characters/${id}/criminal-record`, {
        method: 'POST',
        body:   JSON.stringify(body),
      }),

    memory: (id: string, page = 1, limit = 50) =>
      request<PaginatedResponse<MemoryEntry>>(
        `/characters/${id}/memory?page=${page}&limit=${limit}`,
      ),

    // Phase 7 Wave 2 — outgoing relationship edges, strongest-from-neutral first.
    relationships: (id: string, limit = 24) =>
      request<RelationshipRow[]>(`/characters/${id}/relationships?limit=${limit}`),

    // Round 2 — immediate genealogy (living parents + children only).
    lineage: (id: string) =>
      request<LineageResponse>(`/characters/${id}/lineage`),
  },

  rulesets: {
    list: () =>
      request<RulesetListItem[]>('/rulesets'),

    active: () =>
      request<RulesetRow>('/rulesets/active'),

    get: (id: string) =>
      request<RulesetRow>(`/rulesets/${id}`),

    create: (body: { name: string; description?: string; rules: RulesetDef }) =>
      request<RulesetRow>('/rulesets', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: { name?: string; description?: string; rules?: RulesetDef }) =>
      request<RulesetRow>(`/rulesets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    activate: (id: string) =>
      request<RulesetRow>(`/rulesets/${id}/activate`, { method: 'POST' }),

    clone: (id: string) =>
      request<RulesetRow>(`/rulesets/${id}/clone`, { method: 'POST' }),

    delete: (id: string) =>
      request<void>(`/rulesets/${id}`, { method: 'DELETE' }),
  },

  religions: {
    list: (activeOnly = true) =>
      request<GroupListItem[]>(`/religions${activeOnly ? '?active=true' : ''}`),
    get: (id: string) =>
      request<GroupDetail>(`/religions/${id}`),
    patch: (id: string, body: PatchGroupBody) =>
      request<GroupDetail>(`/religions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addMember: (id: string, person_id: string) =>
      request<{ id: string }>(`/religions/${id}/members`, { method: 'POST', body: JSON.stringify({ person_id }) }),
    removeMember: (id: string, person_id: string) =>
      request<void>(`/religions/${id}/members/${person_id}`, { method: 'DELETE' }),
    dissolve: (id: string, reason = 'player') =>
      request<GroupDetail>(`/religions/${id}/dissolve`, { method: 'POST', body: JSON.stringify({ reason }) }),
    delete: (id: string) =>
      request<void>(`/religions/${id}`, { method: 'DELETE' }),
  },

  factions: {
    list: (activeOnly = true) =>
      request<GroupListItem[]>(`/factions${activeOnly ? '?active=true' : ''}`),
    get: (id: string) =>
      request<GroupDetail>(`/factions/${id}`),
    patch: (id: string, body: PatchGroupBody) =>
      request<GroupDetail>(`/factions/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addMember: (id: string, person_id: string) =>
      request<{ id: string }>(`/factions/${id}/members`, { method: 'POST', body: JSON.stringify({ person_id }) }),
    removeMember: (id: string, person_id: string) =>
      request<void>(`/factions/${id}/members/${person_id}`, { method: 'DELETE' }),
    dissolve: (id: string, reason = 'player') =>
      request<GroupDetail>(`/factions/${id}/dissolve`, { method: 'POST', body: JSON.stringify({ reason }) }),
    delete: (id: string) =>
      request<void>(`/factions/${id}`, { method: 'DELETE' }),
  },

  worlds: {
    list: () =>
      request<WorldListItem[]>('/worlds'),

    get: (id: string) =>
      request<World>(`/worlds/${id}`),

    create: (body: { name: string; description?: string; population_tier?: PopulationTier; ruleset_id?: string }) =>
      request<World>('/worlds', { method: 'POST', body: JSON.stringify(body) }),

    update: (id: string, body: { name?: string; description?: string; ruleset_id?: string | null; population_tier?: PopulationTier }) =>
      request<World>(`/worlds/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

    activate: (id: string) =>
      request<World>(`/worlds/${id}/activate`, { method: 'POST' }),

    archive: (id: string) =>
      request<World>(`/worlds/${id}/archive`, { method: 'POST' }),

    unarchive: (id: string) =>
      request<World>(`/worlds/${id}/unarchive`, { method: 'POST' }),

    delete: (id: string) =>
      request<void>(`/worlds/${id}`, { method: 'DELETE' }),

    newGame: (opts: { name?: string; summon?: number; delete_old?: boolean; population_tier?: PopulationTier; ruleset_id?: string } = {}) =>
      request<{ world: World; summoned: number }>('/worlds/new-game', {
        method: 'POST',
        body:   JSON.stringify(opts),
      }),
  },

  interactions: {
    force: (body: { subject_id: string; antagonist_id: string; interaction_type_id: string }) =>
      request<ForceInteractionResult>('/interactions/force', {
        method: 'POST',
        body:   JSON.stringify(body),
      }),

    steal: (body: { thief_id: string; victim_id: string }) =>
      request<StealResult>('/interactions/steal', {
        method: 'POST',
        body:   JSON.stringify(body),
      }),

    gift: (body: { donor_id: string; recipient_id: string; amount: number }) =>
      request<GiftResult>('/interactions/gift', {
        method: 'POST',
        body:   JSON.stringify(body),
      }),
  },

  economy: {
    getState: () =>
      request<EconomyState>('/economy'),

    push: (direction: 'up' | 'down') =>
      request<Pick<EconomyState, 'market_index' | 'market_trend' | 'market_volatility'>>(
        '/economy/push', { method: 'POST', body: JSON.stringify({ direction }) },
      ),

    setVolatility: (volatility: number) =>
      request<{ market_volatility: number }>(
        '/economy/volatility', { method: 'PATCH', body: JSON.stringify({ volatility }) },
      ),

    patchMarket: (
      bucket:  'stable' | 'standard' | 'volatile',
      patch:   { trend?: number; volatility?: number; index?: number },
    ) =>
      request<{
        bucket:            'stable' | 'standard' | 'volatile';
        market_index:      number;
        market_trend:      number;
        market_volatility: number;
      }>(
        `/economy/market/${bucket}`,
        { method: 'PATCH', body: JSON.stringify(patch) },
      ),
  },

  rip: {
    list: (params: RipListParams = {}) => {
      const qs = new URLSearchParams();
      if (params.limit    !== undefined) qs.set('limit',    String(params.limit));
      if (params.year_min !== undefined) qs.set('year_min', String(params.year_min));
      if (params.year_max !== undefined) qs.set('year_max', String(params.year_max));
      if (params.cause)                  qs.set('cause',    params.cause);
      if (params.sort)                   qs.set('sort',     params.sort);
      if (params.order)                  qs.set('order',    params.order);
      return request<RipListResponse>(`/rip?${qs.toString()}`);
    },
  },

  cities: {
    // Phase 7 Wave 1 — the active world's single city plus live pop + dead totals.
    getActive: () => request<CityWithStats>('/cities/active'),
  },

  world: {
    getState: () => request<WorldSnapshot>('/world'),
  },

  godMode: {
    apply: (id: string, body: DeltaRequest) =>
      request<MutationResult>(`/god-mode/${id}`, {
        method: 'POST',
        body:   JSON.stringify(body),
      }),

    bulk: (body: BulkActionRequest) =>
      request<BulkActionResult>('/god-mode/bulk', {
        method: 'POST',
        body:   JSON.stringify(body),
      }),
  },

  time: {
    getState: () => request<WorldStateResponse>('/time'),

    rewind: (years: number) =>
      request<RewindResult>('/time/rewind', {
        method: 'POST',
        body:   JSON.stringify({ years }),
      }),

    headlines: (params?: { type?: 'ANNUAL' | 'DECADE'; category?: string; yearFrom?: number; yearTo?: number }) => {
      const q = new URLSearchParams();
      if (params?.type)     q.set('type',     params.type);
      if (params?.category) q.set('category', params.category);
      if (params?.yearFrom) q.set('yearFrom', String(params.yearFrom));
      if (params?.yearTo)   q.set('yearTo',   String(params.yearTo));
      return request<Headline[]>(`/time/headlines?${q.toString()}`);
    },

    generateHeadlines: (year: number) =>
      request<{ job: JobRow }>('/time/headlines/generate', {
        method: 'POST',
        body:   JSON.stringify({ year }),
      }),

    generateDecadeHeadlines: (decadeStart: number) =>
      request<{ job: JobRow }>('/time/headlines/generate', {
        method: 'POST',
        body:   JSON.stringify({ decadeStart }),
      }),

    getJob: (id: string) => request<JobRow>(`/time/jobs/${id}`),

    listJobs: (params?: { status?: 'pending' | 'running' | 'done' | 'failed'; kind?: string; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.status) q.set('status', params.status);
      if (params?.kind)   q.set('kind',   params.kind);
      if (params?.limit)  q.set('limit',  String(params.limit));
      return request<JobRow[]>(`/time/jobs?${q.toString()}`);
    },

    listReports: (params?: { yearFrom?: number; yearTo?: number; limit?: number }) => {
      const q = new URLSearchParams();
      if (params?.yearFrom) q.set('yearFrom', String(params.yearFrom));
      if (params?.yearTo)   q.set('yearTo',   String(params.yearTo));
      if (params?.limit)    q.set('limit',    String(params.limit));
      return request<YearlyReportRow[]>(`/time/reports?${q.toString()}`);
    },
  },

  years: {
    advance: () =>
      request<{ year_run_id: string; year: number }>('/years/advance', { method: 'POST' }),

    getStatus: (id: string) =>
      request<YearRunRow>(`/years/${id}`),

    // Phase 6 — current in-flight year-run, or null. Used by PipelineProvider
    // so every page knows whether the Advance button should be locked.
    running: () =>
      request<YearRunRow | null>('/years/running'),

    // SSE — caller must construct EventSource directly (fetch can't stream).
    streamUrl: (id: string) => `/api/years/${id}/stream`,
  },

  events: {
    list: () =>
      request<ActiveEventSummary[]>('/events'),

    history: () =>
      request<EventHistoryRow[]>('/events/history'),

    activate: (event_def_id: string, params: Record<string, unknown>, duration_years?: number | null) =>
      request<ActiveEventSummary>('/events', {
        method: 'POST',
        body: JSON.stringify({ event_def_id, params, duration_years }),
      }),

    deactivate: (eventId: string) =>
      request<{ success: true }>(`/events/${eventId}`, { method: 'DELETE' }),
  },
};

// ── Year run types ───────────────────────────────────────────

export type YearRunPhase = 'bi_annual_a' | 'bi_annual_b' | 'year_end' | 'completed' | 'failed';
export type YearRunStatus = 'running' | 'completed' | 'failed';

export interface YearRunRow {
  id:           string;
  world_id:     string;
  year:         number;
  phase:        YearRunPhase;
  progress_pct: number;
  status:       YearRunStatus;
  error:        string | null;
  message:      string | null;
  started_at:   string;
  completed_at: string | null;
}

export interface YearRunUpdate {
  year_run_id:  string;
  phase:        YearRunPhase;
  progress_pct: number;
  status:       YearRunStatus;
  message?:     string;
}

// ── Jobs / Reports types ─────────────────────────────────────

export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface JobRow {
  id:            string;
  world_id:      string;
  kind:          string;
  status:        JobStatus;
  payload:       unknown;
  result:        unknown;
  error:         string | null;
  attempts:      number;
  max_attempts:  number;
  created_at:    string;
  started_at:    string | null;
  finished_at:   string | null;
}

export interface YearlyReportRow {
  id:                  string;
  world_id:            string;
  year:                number;
  population_start:    number;
  population_end:      number;
  births:              number;
  deaths:              number;
  deaths_by_cause:     Record<string, number>;
  market_index_start:  number;
  market_index_end:    number;
  created_at:          string;
}

// ── World events types ───────────────────────────────────────

export interface ActiveEventSummary {
  id:               string;
  event_def_id:     string;
  params:           Record<string, unknown>;
  started_tick:     number;
  started_year:     number;
  duration_years?:  number | null;
  years_remaining?: number;
  is_active:        boolean;
}

// Phase 4 — completed event archive row.
export interface EventHistoryRow {
  id:              string;
  event_def_id:    string;
  params:          Record<string, unknown>;
  started_year:    number;
  ended_year:      number;
  end_reason:      'expired' | 'manual' | 'condition_met';
  duration_actual: number | null;
  created_at:      string;
}

// ── World snapshot (Phase 6 denormalized payload) ────────────

export interface SnapshotMarkets {
  stable:   { index: number; trend: number };
  standard: { index: number; trend: number };
  volatile: { index: number; trend: number };
}

export interface SnapshotGroupRef {
  id:    string;
  name:  string;
  value: number;
}

export interface SnapshotRichestLeader {
  id:           string;
  name:         string;
  leader_name:  string;
  leader_money: number;
}

export interface SnapshotGroupSection {
  top_by_count:   SnapshotGroupRef[];
  top_by_balance: SnapshotGroupRef[];
  richest_leader: SnapshotRichestLeader | null;
}

export interface SnapshotActiveEvent {
  id:              string;
  def_id:          string;
  params:          Record<string, unknown>;
  started_year:    number;
  duration_years:  number | null;
  years_remaining: number;
  stats: {
    infected_count: number;
  };
}

export interface WorldSnapshot {
  // Pipeline-bound fields (snapshot-time)
  year:               number;
  bi_annual_index:    number;
  population:         number;
  total_deaths:       number;
  recent_deaths_year: { year: number; total: number; by_cause: Record<string, number> };
  averages:           { health: number; happiness: number; money: number };
  markets:            SnapshotMarkets;
  religions:          SnapshotGroupSection;
  factions:           SnapshotGroupSection;
  active_events:      SnapshotActiveEvent[];
  snapshot_at:        string | null;

  // World-level live fields (refreshed on every read)
  current_year: number;
  year_count:   number;

  // ── Legacy flat fields (always emitted by /api/world for back-compat) ──
  market_index:          number;
  market_trend:          number;
  market_stable_index:   number;
  market_stable_trend:   number;
  market_volatile_index: number;
  market_volatile_trend: number;
  avg_health:            number;
  avg_happiness:         number;
  avg_money:             number;
}

// ── Time types ───────────────────────────────────────────────

export type Tone = 'tabloid' | 'literary' | 'epic' | 'reportage' | 'neutral';

export interface Headline {
  id:          string;
  year:        number;
  type:        'ANNUAL' | 'DECADE';
  category:    string;
  headline:    string;
  story:       string;
  person_name: string | null;
  person_id:   string | null;
  tone:        Tone;
  created_at:  string;
}

export interface WorldStateResponse {
  id:               number;
  current_year:     number;
  updated_at:       string;
  recent_headlines: Headline[];
  decade_headlines: Headline[];
}

export interface RewindResult {
  previous_year: number;
  current_year:  number;
  rewound_by:    number;
}

export interface ForceInteractionResult {
  subject_name:             string;
  antagonist_name:          string;
  interaction_type:         { id: string; label: string };
  score:                    number;
  grudge_bonus:             number;
  outcome:                  string;
  magnitude:                number;
  creates_memory:           boolean;
  subject_traits_changed:    Record<string, number>;
  antagonist_traits_changed: Record<string, number>;
}

export interface StealResult {
  stolen:      number;
  thief_name:  string;
  victim_name: string;
  new_bond:    number | null;
}

export interface GiftResult {
  amount:         number;
  donor_name:     string;
  recipient_name: string;
  new_bond:       number | null;
}

export interface RulesetListItem {
  id:          string;
  name:        string;
  description: string | null;
  is_active:   boolean;
  created_at:  string;
  updated_at:  string;
}

export interface RulesetRow extends RulesetListItem {
  rules: RulesetDef;
}
