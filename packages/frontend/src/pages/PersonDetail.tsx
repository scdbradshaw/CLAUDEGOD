// Person dossier (Phase 11e → Phase 13b). 3-column layout: Identity | Stats |
// Memories. Full stat/identity editing via PATCH /api/persons/:id.

import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PERSON_TYPES, RACES } from '@claude-god/shared';
import {
  usePerson,
  usePinToggle,
  usePersonFamily,
  useUpdatePerson,
  type RelationshipRow,
  type DecadeSummaryRow,
  type FamilyMember,
  type FamilyLevel,
  type UpdatePersonBody,
} from '../hooks/usePerson';
import { useWorld } from '../hooks/useWorld';
import { QueueEditor } from '../components/QueueEditor';
import { api } from '../lib/api';

// ─── Small helpers ───────────────────────────────────────────────────────────

function Centered({ children, tone }: { children: React.ReactNode; tone?: 'bad' }) {
  return (
    <div className="px-6 py-12 text-center">
      <div className={tone === 'bad' ? 'text-blood' : 'text-muted'}>{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 items-baseline">
      <div className="text-muted text-[10px] uppercase tracking-wider">{k}</div>
      <div className="text-gray-200">{v}</div>
    </div>
  );
}


function PinErrorToast({ message }: { message: string }) {
  let parsed: { error?: string; current?: number; cap?: number } | null = null;
  try {
    parsed = JSON.parse(message);
  } catch {
    parsed = null;
  }
  if (parsed?.error === 'real_person_cap_reached') {
    return (
      <div className="rounded border border-blood/60 bg-blood/10 px-4 py-3 text-sm text-blood">
        At {parsed.cap ?? 6000}-person cap. Unpin someone or wait for engine demotion.
      </div>
    );
  }
  return <div className="text-blood text-sm">{message}</div>;
}

// ─── Panel card shell ────────────────────────────────────────────────────────

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border-warm rounded bg-panel-warm flex flex-col">
      <header className="px-4 py-3 border-b border-border-warm flex items-center justify-between">
        <h2 className="font-display text-lg text-gold-bright">{title}</h2>
        {action}
      </header>
      <div className="flex-1 px-4 py-3">{children}</div>
    </section>
  );
}

// ─── Identity panel ──────────────────────────────────────────────────────────

interface GroupOption {
  id: string;
  name: string;
}

function IdentityPanel({
  person,
  worldId,
  updateMut,
}: {
  person: import('../hooks/usePerson').PersonRow;
  worldId: string;
  updateMut: ReturnType<typeof useUpdatePerson>;
}) {
  const [editing, setEditing] = useState(false);
  const [addingFaction, setAddingFaction] = useState(false);
  const [addingReligion, setAddingReligion] = useState(false);

  // Edit form state
  const [editName, setEditName] = useState(person.name);
  const [editType, setEditType] = useState(person.type);
  const [editGender, setEditGender] = useState(person.gender);
  const [editRace, setEditRace] = useState(person.race);
  const [editSexuality, setEditSexuality] = useState(String(person.sexuality));
  const [editAge, setEditAge] = useState(String(person.age));

  // Group add state
  const [selectedFactionId, setSelectedFactionId] = useState('');
  const [selectedReligionId, setSelectedReligionId] = useState('');

  const factionGroupsQ = useQuery<{ groups: GroupOption[] }>({
    queryKey: ['groups', person.world_id, 'faction'],
    queryFn: () => api(`/api/groups?world_id=${person.world_id}&kind=faction&active=true`),
    enabled: addingFaction,
  });
  const religionGroupsQ = useQuery<{ groups: GroupOption[] }>({
    queryKey: ['groups', person.world_id, 'religion'],
    queryFn: () => api(`/api/groups?world_id=${person.world_id}&kind=religion&active=true`),
    enabled: addingReligion,
  });

  function startEdit() {
    setEditName(person.name);
    setEditType(person.type);
    setEditGender(person.gender);
    setEditRace(person.race);
    setEditSexuality(String(person.sexuality));
    setEditAge(String(person.age));
    setEditing(true);
  }

  function saveEdit() {
    const body: UpdatePersonBody = {
      name: editName,
      type: editType,
      gender: editGender,
      race: editRace,
      sexuality: Number(editSexuality),
      age: Number(editAge),
    };
    updateMut.mutate(body, { onSuccess: () => setEditing(false) });
  }

  const inputCls =
    'w-full bg-panel border border-border-warm rounded px-2 py-1 text-gray-200 text-sm focus:outline-none focus:border-amber-400';
  const selectCls = inputCls;

  return (
    <Panel
      title="Identity"
      action={
        !editing ? (
          <button
            onClick={startEdit}
            className="text-xs px-2 py-1 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10"
          >
            Edit
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <label className="text-muted text-[10px] uppercase tracking-wider">Name</label>
            <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <label className="text-muted text-[10px] uppercase tracking-wider">Type</label>
            <select className={selectCls} value={editType} onChange={(e) => setEditType(e.target.value as typeof editType)}>
              {PERSON_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <label className="text-muted text-[10px] uppercase tracking-wider">Gender</label>
            <select className={selectCls} value={editGender} onChange={(e) => setEditGender(e.target.value)}>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="nonbinary">Nonbinary</option>
            </select>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <label className="text-muted text-[10px] uppercase tracking-wider">Race</label>
            <select className={selectCls} value={editRace} onChange={(e) => setEditRace(e.target.value)}>
              {RACES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <label className="text-muted text-[10px] uppercase tracking-wider">Sexuality</label>
            <input
              type="number"
              min={0}
              max={100}
              className={inputCls}
              value={editSexuality}
              onChange={(e) => setEditSexuality(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-[8rem_1fr] gap-3 items-center">
            <label className="text-muted text-[10px] uppercase tracking-wider">Age</label>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={editAge}
              onChange={(e) => setEditAge(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveEdit}
              disabled={updateMut.isPending}
              className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs disabled:opacity-50"
            >
              {updateMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded border border-border-warm text-muted text-xs hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
          {updateMut.error && <div className="text-blood text-xs">{updateMut.error.message}</div>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <Row k="Type" v={person.type} />
          <Row k="Race" v={person.race} />
          <Row k="Gender" v={person.gender} />
          <Row k="Age" v={String(person.age)} />
          <Row k="Sexuality" v={`${(person.sexuality / 100).toFixed(2)}`} />
          <Row k="Born" v={`year ${person.created_year}`} />

          {/* Faction row */}
          <Row
            k="Faction"
            v={
              <div className="flex items-center gap-2 flex-wrap">
                {person.faction_id ? (
                  <>
                    <Link
                      to={`/world/${worldId}/group/${person.faction_id}`}
                      className="text-gold-bright hover:underline"
                    >
                      {person.faction_name ?? `${person.faction_id.slice(0, 8)}…`}
                    </Link>
                    <button
                      onClick={() => updateMut.mutate({ faction_id: null })}
                      disabled={updateMut.isPending}
                      className="text-[10px] px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
                    >
                      Kick
                    </button>
                  </>
                ) : addingFaction ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="bg-panel border border-border-warm rounded px-2 py-1 text-gray-200 text-xs"
                      value={selectedFactionId}
                      onChange={(e) => setSelectedFactionId(e.target.value)}
                    >
                      <option value="">— pick faction —</option>
                      {(factionGroupsQ.data?.groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (!selectedFactionId) return;
                        updateMut.mutate({ faction_id: selectedFactionId }, {
                          onSuccess: () => { setAddingFaction(false); setSelectedFactionId(''); },
                        });
                      }}
                      disabled={!selectedFactionId || updateMut.isPending}
                      className="text-[10px] px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                    >
                      Join
                    </button>
                    <button
                      onClick={() => { setAddingFaction(false); setSelectedFactionId(''); }}
                      className="text-[10px] px-2 py-0.5 rounded border border-border-warm text-muted hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-muted italic">none</span>
                    <button
                      onClick={() => setAddingFaction(true)}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            }
          />

          {/* Religion row */}
          <Row
            k="Religion"
            v={
              <div className="flex items-center gap-2 flex-wrap">
                {person.religion_id ? (
                  <>
                    <Link
                      to={`/world/${worldId}/group/${person.religion_id}`}
                      className="text-gold-bright hover:underline"
                    >
                      {person.religion_name ?? `${person.religion_id.slice(0, 8)}…`}
                    </Link>
                    <button
                      onClick={() => updateMut.mutate({ religion_id: null })}
                      disabled={updateMut.isPending}
                      className="text-[10px] px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-50"
                    >
                      Kick
                    </button>
                  </>
                ) : addingReligion ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="bg-panel border border-border-warm rounded px-2 py-1 text-gray-200 text-xs"
                      value={selectedReligionId}
                      onChange={(e) => setSelectedReligionId(e.target.value)}
                    >
                      <option value="">— pick religion —</option>
                      {(religionGroupsQ.data?.groups ?? []).map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => {
                        if (!selectedReligionId) return;
                        updateMut.mutate({ religion_id: selectedReligionId }, {
                          onSuccess: () => { setAddingReligion(false); setSelectedReligionId(''); },
                        });
                      }}
                      disabled={!selectedReligionId || updateMut.isPending}
                      className="text-[10px] px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white disabled:opacity-50"
                    >
                      Join
                    </button>
                    <button
                      onClick={() => { setAddingReligion(false); setSelectedReligionId(''); }}
                      className="text-[10px] px-2 py-0.5 rounded border border-border-warm text-muted hover:text-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-muted italic">none</span>
                    <button
                      onClick={() => setAddingReligion(true)}
                      className="text-[10px] px-2 py-0.5 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10"
                    >
                      Add
                    </button>
                  </div>
                )}
              </div>
            }
          />

          <Row
            k="Personality"
            v={
              <div className="flex flex-wrap gap-1">
                {person.personality_tags.length === 0 && (
                  <span className="text-muted italic">none</span>
                )}
                {person.personality_tags.map((t) => (
                  <span
                    key={t}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-border-warm rounded text-gold"
                  >
                    {t}
                  </span>
                ))}
              </div>
            }
          />
          <Row
            k="State"
            v={
              <div className="flex flex-wrap gap-1">
                {person.state_tags.length === 0 && (
                  <span className="text-muted italic">none</span>
                )}
                {person.state_tags.map((t) => (
                  <span
                    key={t.tag}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 border border-rune/60 rounded text-rune"
                  >
                    {t.tag}
                  </span>
                ))}
              </div>
            }
          />
        </div>
      )}
    </Panel>
  );
}

// ─── Stats panel ─────────────────────────────────────────────────────────────

function StatsPanel({
  person,
  updateMut,
}: {
  person: import('../hooks/usePerson').PersonRow;
  updateMut: ReturnType<typeof useUpdatePerson>;
}) {
  const [editing, setEditing] = useState(false);
  const [editWealth, setEditWealth] = useState(String(person.wealth));
  const [editHealth, setEditHealth] = useState(String(person.current_health));
  const [editHappiness, setEditHappiness] = useState(String(person.happiness));
  const [editIntelligence, setEditIntelligence] = useState(String(person.intelligence));
  const [editCombat, setEditCombat] = useState(String(person.combat));

  function startEdit() {
    setEditWealth(String(person.wealth));
    setEditHealth(String(person.current_health));
    setEditHappiness(String(person.happiness));
    setEditIntelligence(String(person.intelligence));
    setEditCombat(String(person.combat));
    setEditing(true);
  }

  function saveEdit() {
    updateMut.mutate(
      {
        wealth: Number(editWealth),
        current_health: Number(editHealth),
        happiness: Number(editHappiness),
        intelligence: Number(editIntelligence),
        combat: Number(editCombat),
      },
      { onSuccess: () => setEditing(false) },
    );
  }

  const inputCls =
    'w-full bg-panel border border-border-warm rounded px-2 py-1 text-gray-200 text-sm focus:outline-none focus:border-amber-400';

  return (
    <Panel
      title="Stats"
      action={
        !editing ? (
          <button
            onClick={startEdit}
            className="text-xs px-2 py-1 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10"
          >
            Edit stats
          </button>
        ) : undefined
      }
    >
      {editing ? (
        <div className="space-y-3 text-sm">
          {(
            [
              ['Wealth', editWealth, setEditWealth, 0, undefined],
              ['Health', editHealth, setEditHealth, 0, 100],
              ['Happiness', editHappiness, setEditHappiness, 0, 100],
              ['Intelligence', editIntelligence, setEditIntelligence, 0, 100],
              ['Combat', editCombat, setEditCombat, 0, 100],
            ] as const
          ).map(([label, val, setter, min, max]) => (
            <div key={label} className="grid grid-cols-[8rem_1fr] gap-3 items-center">
              <label className="text-muted text-[10px] uppercase tracking-wider">{label}</label>
              <input
                type="number"
                min={min}
                max={max}
                className={inputCls}
                value={val}
                onChange={(e) => setter(e.target.value)}
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <button
              onClick={saveEdit}
              disabled={updateMut.isPending}
              className="px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs disabled:opacity-50"
            >
              {updateMut.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              onClick={() => setEditing(false)}
              className="px-3 py-1 rounded border border-border-warm text-muted text-xs hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
          {updateMut.error && <div className="text-blood text-xs">{updateMut.error.message}</div>}
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <Row k="Wealth" v={person.wealth.toLocaleString()} />
          <Row k="Health" v={String(person.current_health)} />
          <Row k="Happiness" v={String(person.happiness)} />
          <Row k="Intelligence" v={String(person.intelligence)} />
          <Row k="Combat" v={String(person.combat)} />
          {person.faction_wins > 0 && (
            <Row
              k="Faction wins"
              v={
                <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border border-amber-400 text-amber-300 bg-amber-400/10">
                  ★ {person.faction_wins}
                </span>
              }
            />
          )}
          {person.faction_leadership_years > 0 && (
            <Row
              k="Leadership"
              v={
                <span className="text-[10px] uppercase tracking-widest px-2 py-1 rounded border border-rune text-rune bg-rune/10">
                  {person.faction_leadership_years}y
                </span>
              }
            />
          )}
        </div>
      )}
    </Panel>
  );
}

// ─── Memories panel ──────────────────────────────────────────────────────────

function MemoriesPanel({ person }: { person: import('../hooks/usePerson').PersonRow }) {
  return (
    <Panel title="Recent memories">
      {person.recent_memories.length === 0 ? (
        <div className="text-muted text-sm italic">No memories yet.</div>
      ) : (
        <ul className="divide-y divide-border-warm -mx-4">
          {person.recent_memories.map((m, i) => (
            <li key={i} className="px-4 py-2 text-sm">
              <div className="text-muted text-[10px] tabular-nums mb-1">year {m.year}</div>
              <div className="text-gray-200">
                {m.summary || <span className="italic text-muted">no summary</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {m.kind && (
                  <span className="text-[10px] uppercase border border-border-warm rounded px-1.5 py-0.5 text-muted">
                    {m.kind}
                  </span>
                )}
                <span className="text-[10px] tabular-nums text-muted">
                  {(m.magnitude * 100).toFixed(0)}%
                </span>
                {m.counterparty_name && (
                  <span className="text-[10px] text-muted italic">with {m.counterparty_name}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// ─── Relationships section ───────────────────────────────────────────────────

function Relationships({ rows, worldId }: { rows: RelationshipRow[]; worldId: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Bonds</h2>
      </header>
      <ul className="divide-y divide-border-warm">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-2 flex items-center gap-3 text-sm">
            <span className="text-muted text-[10px] uppercase tracking-wider w-16">{r.kind}</span>
            <Link
              to={`/world/${worldId}/person/${r.target_id}`}
              className="text-gold-bright hover:underline font-mono"
            >
              {r.target_name ?? `${r.target_id.slice(0, 8)}…`}
            </Link>
            <span className="flex-1" />
            <span className="font-mono text-muted tabular-nums">
              {r.strength}/100 · yr {r.set_year}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Family tree ─────────────────────────────────────────────────────────────

function FamilyTreePanel({
  tree,
  worldId,
}: {
  tree: { ancestors: FamilyLevel[]; descendants: FamilyLevel[] };
  worldId: string;
}) {
  const ancestorsAsc = [...tree.ancestors].sort((a, b) => a.generation - b.generation);
  const descendantsAsc = [...tree.descendants].sort((a, b) => a.generation - b.generation);
  if (ancestorsAsc.length === 0 && descendantsAsc.length === 0) return null;

  const labelFor = (g: number) => {
    if (g === -1) return 'Parents';
    if (g === -2) return 'Grandparents';
    if (g === -3) return 'Great-grandparents';
    if (g === 1) return 'Children';
    if (g === 2) return 'Grandchildren';
    if (g === 3) return 'Great-grandchildren';
    return `gen ${g}`;
  };

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Family tree</h2>
      </header>
      <div className="px-4 py-3 space-y-3">
        {ancestorsAsc.map((lvl) => (
          <FamilyRow key={lvl.generation} label={labelFor(lvl.generation)} members={lvl.members} worldId={worldId} />
        ))}
        {ancestorsAsc.length > 0 && descendantsAsc.length > 0 && (
          <div className="border-t border-border-warm/50 my-2" />
        )}
        {descendantsAsc.map((lvl) => (
          <FamilyRow key={lvl.generation} label={labelFor(lvl.generation)} members={lvl.members} worldId={worldId} />
        ))}
      </div>
    </section>
  );
}

function FamilyRow({ label, members, worldId }: { label: string; members: FamilyMember[]; worldId: string }) {
  return (
    <div className="grid grid-cols-[10rem_1fr] gap-3 items-baseline">
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className="flex flex-wrap gap-2">
        {members.map((m) => (
          <FamilyChip key={m.id} member={m} worldId={worldId} />
        ))}
      </div>
    </div>
  );
}

function FamilyChip({ member, worldId }: { member: FamilyMember; worldId: string }) {
  if (member.is_alive) {
    return (
      <Link
        to={`/world/${worldId}/person/${member.id}`}
        className="text-sm text-gold-bright hover:underline border border-border-warm rounded px-2 py-1"
      >
        {member.name}
        {member.age != null && (
          <span className="text-muted text-xs ml-2 tabular-nums">{member.age}</span>
        )}
      </Link>
    );
  }
  return (
    <span className="text-sm text-muted border border-border-warm/50 rounded px-2 py-1 italic">
      {member.name}
      {member.age_at_demote != null && member.died_year != null && (
        <span className="ml-2 text-xs tabular-nums">
          (d. yr {member.died_year}, age {member.age_at_demote})
        </span>
      )}
    </span>
  );
}

// ─── Decade summaries ─────────────────────────────────────────────────────────

function DecadeSummaries({ rows }: { rows: DecadeSummaryRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Life decades</h2>
      </header>
      <ul className="divide-y divide-border-warm">
        {rows.map((d) => (
          <li key={d.id} className="px-4 py-3 text-sm">
            <div className="text-muted text-[10px] uppercase tracking-wider">
              years {d.decade_start_year}–{d.decade_start_year + 9}
            </div>
            <ul className="mt-1 list-disc list-inside text-gray-200 space-y-1">
              {d.ranked_memories.map((m, i) => (
                <li key={i}>
                  <span className="text-muted text-xs tabular-nums">[yr {m.year}]</span>{' '}
                  {m.text ?? <span className="italic text-muted">memory</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function PersonDetail() {
  const { personId, worldId } = useParams<{ personId: string; worldId: string }>();
  const q = usePerson(personId);
  const worldQ = useWorld(worldId);
  const pinMut = usePinToggle(personId);
  const updateMut = useUpdatePerson(personId);
  const familyQ = usePersonFamily(personId);

  if (q.isLoading) return <Centered>Loading person…</Centered>;
  if (q.error) return <Centered tone="bad">Failed to load person.</Centered>;
  if (!q.data) return <Centered>Person not found.</Centered>;

  const { person, relationships, decade_summaries } = q.data;
  const currentYear = worldQ.data?.world.current_year ?? 0;

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
      {/* Header */}
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-gold-bright">
            {person.name}
            {person.is_pinned && <span className="ml-3 text-rune">★</span>}
          </h1>
          {!person.is_alive && (
            <p className="text-blood text-xs uppercase tracking-widest mt-1">Deceased</p>
          )}
        </div>
        <div className="flex gap-3 items-center">
          <Link
            to={`/world/${worldId}/city/${person.city_id}`}
            className="text-muted hover:text-gold-bright text-sm"
          >
            home city →
          </Link>
          <button
            onClick={() => pinMut.mutate(!person.is_pinned)}
            disabled={!person.is_alive || pinMut.isPending}
            className="px-4 py-2 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 text-sm disabled:opacity-50"
          >
            {person.is_pinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
      </header>

      {pinMut.error && <PinErrorToast message={pinMut.error.message} />}

      {/* 3-column grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <IdentityPanel person={person} worldId={worldId!} updateMut={updateMut} />
        <StatsPanel person={person} updateMut={updateMut} />
        <MemoriesPanel person={person} />
      </div>

      <Relationships rows={relationships} worldId={worldId!} />

      {familyQ.data && <FamilyTreePanel tree={familyQ.data} worldId={worldId!} />}

      <DecadeSummaries rows={decade_summaries} />

      <QueueEditor person={person} currentYear={currentYear} />
    </div>
  );
}
