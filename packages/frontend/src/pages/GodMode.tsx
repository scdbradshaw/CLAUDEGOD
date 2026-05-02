// Phase 12 — God Mode console.
// Panels: world settings, drop event, active events, event history.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { EventDef, EventType, PersonType } from '@claude-god/shared';
import { PERSON_TYPES } from '@claude-god/shared';
import { useWorld } from '../hooks/useWorld';
import { useActiveEvents, type WorldEventRow } from '../hooks/useActiveEvents';
import {
  useBulkKill,
  useBulkKillPreview,
  type BulkKillScope,
  useBulkSummon,
  useDropEvent,
  useEndEvent,
  useEventCatalog,
  useEventHistory,
  useKillPerson,
  useSummonPerson,
  useUpdateWorld,
} from '../hooks/useGodMode';
import { api } from '../lib/api';

interface GroupRow {
  id: string;
  name: string;
  kind: 'faction' | 'religion';
  is_active: boolean;
}

export function GodMode() {
  const { worldId } = useParams<{ worldId: string }>();
  const worldQ = useWorld(worldId);

  if (worldQ.isLoading) return <Centered>Loading…</Centered>;
  if (worldQ.error) return <Centered tone="bad">Failed to load world.</Centered>;
  if (!worldQ.data) return <Centered>World not found.</Centered>;

  const { world, city } = worldQ.data;

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
      <header>
        <h1 className="font-display text-3xl text-gold-bright">God Mode</h1>
        <p className="text-muted text-xs uppercase tracking-widest mt-1">
          {world.name} · year {world.current_year}
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <WorldSettingsPanel
          worldId={world.id}
          name={world.name}
        />
        <DropEventPanel
          worldId={world.id}
          year={world.current_year}
          cityId={city?.id ?? null}
        />
        <SummonPersonPanel
          worldId={world.id}
          cityId={city?.id ?? null}
        />
        <KillPersonPanel worldId={world.id} />
        <BulkSummonPanel
          worldId={world.id}
          cityId={city?.id ?? null}
        />
        <BulkKillPanel worldId={world.id} />
        <ActiveEventsPanel
          worldId={world.id}
          year={world.current_year}
        />
        <EventHistoryPanel worldId={world.id} />
      </div>
    </div>
  );
}

// ─── World settings ─────────────────────────────────────────────────────────

function WorldSettingsPanel({
  worldId,
  name,
}: {
  worldId: string;
  name: string;
}) {
  const update = useUpdateWorld(worldId);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(name);

  const commitName = () => {
    const next = draftName.trim();
    if (next && next !== name) update.mutate({ name: next });
    setEditingName(false);
  };

  return (
    <Panel title="World settings">
      <div className="space-y-4 text-sm">
        <Row k="Name">
          {editingName ? (
            <div className="flex gap-2">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitName();
                  if (e.key === 'Escape') {
                    setDraftName(name);
                    setEditingName(false);
                  }
                }}
                autoFocus
                className="flex-1 bg-surface border border-border-warm rounded px-2 py-1 text-sm focus:outline-none focus:border-gold-dim"
              />
              <button
                onClick={commitName}
                className="px-2 py-1 text-xs border border-amber-400 rounded text-amber-300 hover:bg-amber-400/10"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setDraftName(name);
                setEditingName(true);
              }}
              className="text-gold-bright hover:underline text-left"
            >
              {name}
            </button>
          )}
        </Row>
        {update.error && (
          <div className="text-blood text-xs">{update.error.message}</div>
        )}
      </div>
    </Panel>
  );
}

// ─── Drop event ─────────────────────────────────────────────────────────────

function DropEventPanel({
  worldId,
  year,
  cityId,
}: {
  worldId: string;
  year: number;
  cityId: string | null;
}) {
  const catalog = useEventCatalog();
  const factionsQ = useQuery<{ rows: GroupRow[] }, Error, GroupRow[]>({
    queryKey: ['groups', { world_id: worldId, kind: 'faction', active: true }],
    queryFn: () => api(`/api/groups?world_id=${worldId}&kind=faction&active=true`),
    select: (d) => d.rows,
  });

  const [selectedId, setSelectedId] = useState<EventType | ''>('');
  const [factionId, setFactionId] = useState('');
  const drop = useDropEvent();

  const selectedDef: EventDef | undefined = useMemo(
    () => catalog.data?.find((d) => d.id === selectedId),
    [catalog.data, selectedId],
  );

  const submit = () => {
    if (!selectedDef) return;
    const args: Parameters<typeof drop.mutate>[0] = {
      world_id: worldId,
      event_def_id: selectedDef.id,
      year,
    };
    if (selectedDef.scope === 'city') {
      if (!cityId) return;
      args.city_id = cityId;
    }
    if (selectedDef.scope === 'faction') {
      if (!factionId) return;
      args.faction_id = factionId;
    }
    drop.mutate(args, { onSuccess: () => { setSelectedId(''); setFactionId(''); } });
  };

  const canSubmit =
    !!selectedDef &&
    !drop.isPending &&
    (selectedDef.scope !== 'city' || !!cityId) &&
    (selectedDef.scope !== 'faction' || !!factionId);

  return (
    <Panel title="Drop event">
      <div className="space-y-3 text-sm">
        <Row k="Type">
          <select
            value={selectedId}
            onChange={(e) => {
              setSelectedId(e.target.value as EventType | '');
              setFactionId('');
            }}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          >
            <option value="">— select —</option>
            {catalog.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} ({d.scope})
              </option>
            ))}
          </select>
        </Row>
        {selectedDef && (
          <Row k="Detail">
            <div className="text-muted text-xs space-y-0.5">
              <div>scope: {selectedDef.scope}</div>
              <div>
                end: {selectedDef.end_condition.kind}
                {selectedDef.default_duration != null
                  ? ` · default ${selectedDef.default_duration}y`
                  : ''}
              </div>
              <div>tone: {selectedDef.headline_tone}</div>
            </div>
          </Row>
        )}
        {selectedDef?.scope === 'faction' && (
          <Row k="Faction">
            <select
              value={factionId}
              onChange={(e) => setFactionId(e.target.value)}
              className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
            >
              <option value="">— select —</option>
              {factionsQ.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </Row>
        )}
        {selectedDef?.scope === 'city' && (
          <Row k="City">
            <span className="text-muted text-xs italic">
              {cityId ? 'sole city (auto)' : 'no city found'}
            </span>
          </Row>
        )}
        {drop.error && (
          <div className="text-blood text-xs">{drop.error.message}</div>
        )}
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="w-full px-3 py-2 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          {drop.isPending ? 'Dropping…' : 'Drop event'}
        </button>
      </div>
    </Panel>
  );
}

// ─── Summon person ──────────────────────────────────────────────────────────

function SummonPersonPanel({
  worldId,
  cityId,
}: {
  worldId: string;
  cityId: string | null;
}) {
  const summon = useSummonPerson(worldId);
  const [type, setType] = useState<PersonType>('Farmer');
  const [pin, setPin] = useState(false);
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const submit = () => {
    if (!cityId) return;
    summon.mutate(
      { world_id: worldId, city_id: cityId, type, pin },
      {
        onSuccess: (r) =>
          setLastSummary(r.kind === 'real' ? `summoned: ${r.name}` : `+1 ${r.type} (npc)`),
      },
    );
  };

  return (
    <Panel title="Summon person">
      <div className="space-y-3 text-sm">
        <Row k="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PersonType)}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          >
            {PERSON_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Row>
        <Row k="Pin">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={pin}
              onChange={(e) => setPin(e.target.checked)}
            />
            auto-pin (survives churn)
          </label>
        </Row>
        {summon.error && (
          <div className="text-blood text-xs">{summon.error.message}</div>
        )}
        {lastSummary && !summon.isPending && !summon.error && (
          <div className="text-gold-dim text-xs">{lastSummary}</div>
        )}
        <button
          onClick={submit}
          disabled={summon.isPending || !cityId}
          className="w-full px-3 py-2 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          {summon.isPending ? 'Summoning…' : 'Summon'}
        </button>
      </div>
    </Panel>
  );
}

// ─── Kill person ────────────────────────────────────────────────────────────

interface PersonRow {
  id: string;
  name: string;
  type: PersonType;
  age: number;
  is_pinned: boolean;
}

function KillPersonPanel({ worldId }: { worldId: string }) {
  const [q, setQ] = useState('');
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const kill = useKillPerson(worldId);

  const params = new URLSearchParams({ world_id: worldId, limit: '20' });
  if (q.trim()) params.set('q', q.trim());
  if (pinnedOnly) params.set('is_pinned', 'true');

  const listQ = useQuery<{ rows: PersonRow[] }, Error, PersonRow[]>({
    queryKey: ['persons', { world_id: worldId, q: q.trim(), pinned: pinnedOnly }],
    queryFn: () => api(`/api/persons?${params.toString()}`),
    select: (d) => d.rows,
  });

  return (
    <Panel title="Kill person">
      <div className="space-y-3 text-sm">
        <Row k="Search">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="name…"
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          />
        </Row>
        <Row k="Filter">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={pinnedOnly}
              onChange={(e) => setPinnedOnly(e.target.checked)}
            />
            pinned only
          </label>
        </Row>
        {kill.error && (
          <div className="text-blood text-xs">{kill.error.message}</div>
        )}
        {listQ.isLoading && <div className="text-muted text-xs">Loading…</div>}
        {listQ.data && listQ.data.length === 0 && (
          <div className="text-muted text-xs italic">No matches.</div>
        )}
        {listQ.data && listQ.data.length > 0 && (
          <ul className="divide-y divide-border-warm max-h-64 overflow-y-auto">
            {listQ.data.map((p) => (
              <li key={p.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-gold-bright truncate">
                    {p.is_pinned && <span className="text-gold mr-1">★</span>}
                    {p.name}
                  </div>
                  <div className="text-muted text-xs">
                    {p.type} · age {p.age}
                  </div>
                </div>
                <button
                  onClick={() => kill.mutate({ personId: p.id })}
                  disabled={kill.isPending}
                  className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs disabled:opacity-40"
                >
                  Kill
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

// ─── Bulk summon ────────────────────────────────────────────────────────────

function BulkSummonPanel({
  worldId,
  cityId,
}: {
  worldId: string;
  cityId: string | null;
}) {
  const bulk = useBulkSummon(worldId);
  const [type, setType] = useState<PersonType>('Farmer');
  const [count, setCount] = useState(100);
  const [pin, setPin] = useState(false);

  const clamped = Math.max(1, Math.min(count, 10_000));

  const submit = () => {
    if (!cityId) return;
    bulk.mutate({ world_id: worldId, city_id: cityId, type, count: clamped, pin });
  };

  return (
    <Panel title="Bulk summon">
      <div className="space-y-3 text-sm">
        <Row k="Type">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as PersonType)}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          >
            {PERSON_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Row>
        <Row k="Count">
          <input
            type="number"
            min={1}
            max={10000}
            value={count}
            onChange={(e) => setCount(Number.parseInt(e.target.value, 10) || 1)}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          />
        </Row>
        <Row k="Quick">
          <div className="flex gap-1.5 flex-wrap">
            {[10, 100, 500, 1000, 5000, 10000].map((n) => (
              <button
                key={n}
                onClick={() => setCount(n)}
                className="px-2 py-1 text-xs border border-amber-400/50 rounded text-amber-300/70 hover:text-amber-300 hover:border-amber-400"
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
        </Row>
        <Row k="Pin">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={pin}
              onChange={(e) => setPin(e.target.checked)}
            />
            auto-pin all (caps at 6,000 alive)
          </label>
        </Row>
        {bulk.error && <div className="text-blood text-xs">{bulk.error.message}</div>}
        {bulk.data && !bulk.isPending && (
          <div className="text-gold-dim text-xs">
            Created {bulk.data.created.toLocaleString()} / {bulk.data.requested.toLocaleString()}
            {bulk.data.skipped_for_cap > 0 && ` · ${bulk.data.skipped_for_cap.toLocaleString()} blocked by cap`}
          </div>
        )}
        <button
          onClick={submit}
          disabled={bulk.isPending || !cityId}
          className="w-full px-3 py-2 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          {bulk.isPending
            ? `Summoning ${clamped.toLocaleString()}…`
            : `Summon ${clamped.toLocaleString()}`}
        </button>
      </div>
    </Panel>
  );
}

// ─── Bulk kill ──────────────────────────────────────────────────────────────

function BulkKillPanel({ worldId }: { worldId: string }) {
  const bulk = useBulkKill(worldId);
  const [typeFilter, setTypeFilter] = useState<PersonType | ''>('');
  const [scope, setScope] = useState<BulkKillScope>('npc');
  const [pinnedFilter, setPinnedFilter] = useState<'any' | 'pinned' | 'unpinned'>('unpinned');
  const [limit, setLimit] = useState(100);

  // Pinned filter only applies to the real leg — npcs have no pin concept.
  const effectivePinned: boolean | undefined =
    scope === 'npc' || pinnedFilter === 'any'
      ? undefined
      : pinnedFilter === 'pinned';

  const previewQ = useBulkKillPreview({
    world_id: worldId,
    type: typeFilter || undefined,
    is_pinned: effectivePinned,
    scope,
  });

  const matchCount = previewQ.data?.total ?? 0;
  const clamped = Math.max(1, Math.min(limit, 10_000));
  const targetCount = Math.min(clamped, matchCount);

  const submit = () => {
    if (targetCount === 0) return;
    bulk.mutate({
      world_id: worldId,
      type: typeFilter || undefined,
      is_pinned: effectivePinned,
      scope,
      limit: clamped,
    });
  };

  return (
    <Panel title="Bulk kill">
      <div className="space-y-3 text-sm">
        <Row k="Scope">
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value as BulkKillScope)}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          >
            <option value="npc">npcs only</option>
            <option value="real">real people only</option>
            <option value="both">both (npcs first)</option>
          </select>
        </Row>
        <Row k="Type">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as PersonType | '')}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          >
            <option value="">— any —</option>
            {PERSON_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Row>
        {scope !== 'npc' && (
          <Row k="Pinned">
            <select
              value={pinnedFilter}
              onChange={(e) => setPinnedFilter(e.target.value as 'any' | 'pinned' | 'unpinned')}
              className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
            >
              <option value="any">any</option>
              <option value="unpinned">unpinned only</option>
              <option value="pinned">pinned only</option>
            </select>
          </Row>
        )}
        <Row k="Limit">
          <input
            type="number"
            min={1}
            max={10000}
            value={limit}
            onChange={(e) => setLimit(Number.parseInt(e.target.value, 10) || 1)}
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          />
        </Row>
        <Row k="Quick">
          <div className="flex gap-1.5 flex-wrap">
            {[10, 100, 500, 1000, 5000, 10000].map((n) => (
              <button
                key={n}
                onClick={() => setLimit(n)}
                className="px-2 py-1 text-xs border border-red-500/60 rounded text-red-400/80 hover:text-white hover:bg-red-700 hover:border-red-500"
              >
                {n.toLocaleString()}
              </button>
            ))}
          </div>
        </Row>
        <div className="text-muted text-xs">
          {previewQ.isLoading
            ? 'Loading…'
            : scope === 'both'
            ? `${matchCount.toLocaleString()} match${matchCount === 1 ? '' : 'es'} (npc ${(previewQ.data?.npc ?? 0).toLocaleString()} / real ${(previewQ.data?.real ?? 0).toLocaleString()}) · will kill ${targetCount.toLocaleString()}`
            : `${matchCount.toLocaleString()} match${matchCount === 1 ? '' : 'es'} · will kill ${targetCount.toLocaleString()}`}
        </div>
        {bulk.error && <div className="text-blood text-xs">{bulk.error.message}</div>}
        {bulk.data && !bulk.isPending && (
          <div className="text-blood/80 text-xs">
            Killed {bulk.data.killed.toLocaleString()}
            {bulk.data.killed_npc > 0 && bulk.data.killed_real > 0
              ? ` (npc ${bulk.data.killed_npc.toLocaleString()} / real ${bulk.data.killed_real.toLocaleString()})`
              : bulk.data.killed_npc > 0
              ? ' (npc)'
              : bulk.data.killed_real > 0
              ? ' (real)'
              : ''}
            .
          </div>
        )}
        <button
          onClick={submit}
          disabled={bulk.isPending || targetCount === 0}
          className="w-full px-3 py-2 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 disabled:cursor-not-allowed text-sm"
        >
          {bulk.isPending
            ? `Killing ${targetCount.toLocaleString()}…`
            : `Kill ${targetCount.toLocaleString()}`}
        </button>
      </div>
    </Panel>
  );
}

// ─── Active events ──────────────────────────────────────────────────────────

function ActiveEventsPanel({ worldId, year }: { worldId: string; year: number }) {
  const q = useActiveEvents(worldId);
  const end = useEndEvent(worldId);

  return (
    <Panel title={`Active events (${q.data?.length ?? 0}/6)`}>
      {q.isLoading && <p className="text-muted text-sm">Loading…</p>}
      {q.error && <p className="text-blood text-sm">{q.error.message}</p>}
      {q.data && q.data.length === 0 && (
        <p className="text-muted text-sm italic">No active events.</p>
      )}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-border-warm">
          {q.data.map((ev) => (
            <ActiveEventRow
              key={ev.id}
              ev={ev}
              worldId={worldId}
              onEnd={() => end.mutate({ eventId: ev.id, year })}
              ending={end.isPending}
            />
          ))}
        </ul>
      )}
      {end.error && (
        <div className="mt-2 text-blood text-xs">{end.error.message}</div>
      )}
    </Panel>
  );
}

function ActiveEventRow({
  ev,
  worldId,
  onEnd,
  ending,
}: {
  ev: WorldEventRow;
  worldId: string;
  onEnd: () => void;
  ending: boolean;
}) {
  return (
    <li className="py-2 flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="font-display text-gold-bright">{ev.event_def_id}</div>
        <div className="text-muted text-xs">
          started yr {ev.started_year}
          {ev.duration_years != null && ` · ${ev.duration_years}y duration`}
          {ev.city_id && (
            <>
              {' · '}
              <Link
                to={`/world/${worldId}/city/${ev.city_id}`}
                className="text-gold hover:underline"
              >
                city
              </Link>
            </>
          )}
          {ev.faction_id && (
            <>
              {' · '}
              <Link
                to={`/world/${worldId}/group/${ev.faction_id}`}
                className="text-gold hover:underline"
              >
                faction
              </Link>
            </>
          )}
        </div>
      </div>
      <button
        onClick={onEnd}
        disabled={ending}
        className="px-2 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs disabled:opacity-40"
      >
        {ending ? '…' : 'End'}
      </button>
    </li>
  );
}

// ─── Event history ──────────────────────────────────────────────────────────

function EventHistoryPanel({ worldId }: { worldId: string }) {
  const q = useEventHistory(worldId);
  const rows = (q.data ?? []).slice(0, 50);

  return (
    <Panel title="Event history">
      {q.isLoading && <p className="text-muted text-sm">Loading…</p>}
      {q.error && <p className="text-blood text-sm">{q.error.message}</p>}
      {q.data && rows.length === 0 && (
        <p className="text-muted text-sm italic">No ended events yet.</p>
      )}
      {rows.length > 0 && (
        <ul className="divide-y divide-border-warm max-h-80 overflow-y-auto">
          {rows.map((ev) => (
            <li key={ev.id} className="py-2 flex items-baseline gap-3">
              <span className="font-display text-gold-bright text-sm">
                {ev.event_def_id}
              </span>
              <span className="text-muted text-xs">
                yr {ev.started_year}
                {ev.ended_year != null && ` → ${ev.ended_year}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">{title}</h2>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 items-baseline">
      <div className="text-muted text-[10px] uppercase tracking-wider">{k}</div>
      <div className="text-gray-200">{children}</div>
    </div>
  );
}

function Centered({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: 'bad';
}) {
  return (
    <div className="px-6 py-12 text-center">
      <div className={tone === 'bad' ? 'text-blood' : 'text-muted'}>{children}</div>
    </div>
  );
}
