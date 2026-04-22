// ============================================================
// Groups — Religions + Factions management page.
// Edit cost, virus profile (match thresholds), trait minimums.
// Add / kick members.
// ============================================================

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { GroupListItem, PatchGroupBody } from '../api/client';

// ── Trait labels (for sliders) ────────────────────────────────

const TRAIT_KEYS = [
  'health','strength','endurance','agility','beauty',
  'intelligence','memory','curiosity','creativity','street_smarts',
  'charisma','empathy','humor','persuasion','leadership',
  'honesty','courage','discipline','ambition','resilience',
  'combat','survival','craftsmanship','artistry','cunning',
];

// ── Cost tier suggestions ─────────────────────────────────────

const COST_PRESETS = [
  { label: 'Open',     value: 0   },
  { label: 'Modest',   value: 3   },
  { label: 'Moderate', value: 10  },
  { label: 'Affluent', value: 22  },
  { label: 'Elite',    value: 45  },
];

// ── Helpers ───────────────────────────────────────────────────

type GroupKind = 'religion' | 'faction';

function groupApi(kind: GroupKind) {
  return kind === 'religion' ? api.religions : api.factions;
}

// ── Main page ─────────────────────────────────────────────────

export default function Groups() {
  const [tab, setTab] = useState<GroupKind>('religion');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const qc = useQueryClient();

  const religionsQ = useQuery({
    queryKey: ['groups', 'religion'],
    queryFn:  () => api.religions.list(false),
  });
  const factionsQ = useQuery({
    queryKey: ['groups', 'faction'],
    queryFn:  () => api.factions.list(false),
  });

  const list = (tab === 'religion' ? religionsQ.data : factionsQ.data) ?? [];
  const isLoading = tab === 'religion' ? religionsQ.isLoading : factionsQ.isLoading;
  const selected = selectedId ? list.find(g => g.id === selectedId) ?? null : null;

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['groups'] });
  }

  return (
    <div className="min-h-screen bg-bg text-text p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="font-display text-gold tracking-widest text-lg">Groups</h1>
          <div className="flex gap-1 panel p-0.5 rounded">
            {(['religion', 'faction'] as GroupKind[]).map(k => (
              <button
                key={k}
                onClick={() => { setTab(k); setSelectedId(null); }}
                className={`px-4 py-1.5 text-xs rounded transition-colors capitalize
                  ${tab === k ? 'bg-gold/20 text-gold' : 'text-muted hover:text-gray-300'}`}
              >
                {k === 'religion' ? 'Religions' : 'Factions'}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">

          {/* Left: group list */}
          <div className="space-y-2">
            {isLoading && <p className="text-muted text-xs">Loading…</p>}
            {!isLoading && list.length === 0 && (
              <p className="text-muted text-xs panel p-4">No {tab === 'religion' ? 'religions' : 'factions'} exist yet.</p>
            )}
            {list.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedId(g.id === selectedId ? null : g.id)}
                className={`w-full text-left panel p-3 rounded transition-colors
                  ${selectedId === g.id ? 'border-gold/40 bg-gold/5' : 'hover:border-border-warm'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-medium ${g.is_active ? 'text-text' : 'text-muted line-through'}`}>
                    {g.name}
                  </span>
                  <span className="text-[10px] text-muted shrink-0">{g.member_count} members</span>
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-[10px] text-zinc-500">
                    {g.cost_per_tick > 0 ? `${g.cost_per_tick} wealth/tick` : 'Free'}
                  </span>
                  {Object.keys(g.trait_minimums ?? {}).length > 0 && (
                    <span className="text-[10px] text-zinc-500">
                      {Object.keys(g.trait_minimums).length} req
                    </span>
                  )}
                  {!g.is_active && (
                    <span className="text-[10px] text-red-500/70">dissolved</span>
                  )}
                </div>
              </button>
            ))}
          </div>

          {/* Right: detail panel */}
          <div>
            {selected
              ? <GroupDetailPanel kind={tab} group={selected} onUpdate={invalidate} />
              : (
                <div className="panel p-6 text-center text-muted text-sm">
                  Select a group to view and edit
                </div>
              )
            }
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────

function GroupDetailPanel({
  kind,
  group,
  onUpdate,
}: {
  kind:     GroupKind;
  group:    GroupListItem;
  onUpdate: () => void;
}) {
  const qc = useQueryClient();
  const detailQ = useQuery({
    queryKey: ['group-detail', kind, group.id],
    queryFn:  () => groupApi(kind).get(group.id),
  });
  const detail = detailQ.data;

  // Edit state
  const [cost, setCost]                   = useState<number>(group.cost_per_tick);
  const [virusProfile, setVirusProfile]   = useState<Record<string, { min?: number; max?: number }>>(group.virus_profile ?? {});
  const [traitMins, setTraitMins]         = useState<Record<string, number>>(group.trait_minimums ?? {});
  const [addPersonId, setAddPersonId]     = useState('');
  const [addPersonName, setAddPersonName] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{ id: string; name: string; age: number }>>([]);
  const [searchQuery, setSearchQuery]     = useState('');
  const [dirty, setDirty]                 = useState(false);

  // Reset edit state when group changes
  const groupId = group.id;
  const [lastGroupId, setLastGroupId] = useState(groupId);
  if (lastGroupId !== groupId) {
    setLastGroupId(groupId);
    setCost(group.cost_per_tick);
    setVirusProfile(group.virus_profile ?? {});
    setTraitMins(group.trait_minimums ?? {});
    setDirty(false);
    setSearchQuery('');
    setSearchResults([]);
    setAddPersonId('');
    setAddPersonName('');
  }

  // Save mutation
  const saveMut = useMutation({
    mutationFn: () => groupApi(kind).patch(group.id, {
      cost_per_tick:  cost,
      virus_profile:  virusProfile,
      trait_minimums: traitMins,
    } as PatchGroupBody),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-detail', kind, group.id] });
      onUpdate();
      setDirty(false);
    },
  });

  // Add member
  const addMut = useMutation({
    mutationFn: (pid: string) => groupApi(kind).addMember(group.id, pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-detail', kind, group.id] });
      onUpdate();
      setAddPersonId('');
      setAddPersonName('');
      setSearchQuery('');
      setSearchResults([]);
    },
  });

  // Kick member
  const kickMut = useMutation({
    mutationFn: (pid: string) => groupApi(kind).removeMember(group.id, pid),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group-detail', kind, group.id] });
      onUpdate();
    },
  });

  // Search people
  async function doSearch(q: string) {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    try {
      const res = await api.characters.search({ q, status: 'alive', limit: 10 });
      setSearchResults(res.data.map((p: any) => ({ id: p.id, name: p.name, age: p.age })));
    } catch { setSearchResults([]); }
  }

  function setVirusTrait(key: string, side: 'min' | 'max', val: number | undefined) {
    setVirusProfile(prev => {
      const existing = prev[key] ?? {};
      const updated = { ...existing, [side]: val };
      if (updated.min === undefined && updated.max === undefined) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: updated };
    });
    setDirty(true);
  }

  function setTraitMin(key: string, val: number | null) {
    setTraitMins(prev => {
      if (val === null) {
        const { [key]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [key]: val };
    });
    setDirty(true);
  }

  const members = detail?.memberships ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="panel p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-gold font-display tracking-wider text-base">{group.name}</h2>
            {group.description && <p className="text-muted text-xs mt-1">{group.description}</p>}
            <div className="flex items-center gap-3 mt-2 text-[10px] text-zinc-500">
              <span>Founded yr {group.founded_year}</span>
              {group.founder && <span>Founder: {group.founder.name}</span>}
              <span>{group.member_count} members</span>
              <span className={group.is_active ? 'text-emerald-500/70' : 'text-red-500/70'}>
                {group.is_active ? 'Active' : 'Dissolved'}
              </span>
            </div>
          </div>
          {dirty && (
            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="btn-primary text-xs py-1 px-3 shrink-0 disabled:opacity-40"
            >
              {saveMut.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">

        {/* Cost */}
        <div className="panel p-4 space-y-3">
          <p className="label text-[10px]">Membership Cost (wealth / tick)</p>
          <div className="flex items-center gap-3">
            <input
              type="range" min={0} max={100} value={cost}
              onChange={e => { setCost(Number(e.target.value)); setDirty(true); }}
              className="flex-1 accent-gold"
            />
            <span className="text-gold text-sm w-8 text-right">{cost}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {COST_PRESETS.map(p => (
              <button
                key={p.label}
                onClick={() => { setCost(p.value); setDirty(true); }}
                className={`text-[10px] px-2 py-0.5 rounded border transition-colors
                  ${cost === p.value
                    ? 'border-gold text-gold'
                    : 'border-border text-muted hover:border-border-warm hover:text-gray-300'}`}
              >
                {p.label} ({p.value})
              </button>
            ))}
          </div>
        </div>

        {/* Trait minimums */}
        <div className="panel p-4 space-y-3">
          <p className="label text-[10px]">Trait Minimums (entry requirements)</p>
          <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
            {TRAIT_KEYS.map(key => {
              const val = traitMins[key];
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-[10px] text-muted w-24 shrink-0 capitalize">{key.replace(/_/g, ' ')}</span>
                  <input
                    type="range" min={0} max={100} value={val ?? 0}
                    disabled={val === undefined}
                    onChange={e => setTraitMin(key, Number(e.target.value))}
                    className={`flex-1 accent-gold ${val === undefined ? 'opacity-30' : ''}`}
                  />
                  <span className="text-[10px] text-muted w-6 text-right">{val ?? '—'}</span>
                  <button
                    onClick={() => setTraitMin(key, val === undefined ? 50 : null)}
                    className={`text-[10px] w-5 h-5 flex items-center justify-center rounded transition-colors
                      ${val !== undefined ? 'text-red-400 hover:text-red-300' : 'text-zinc-600 hover:text-zinc-400'}`}
                    title={val !== undefined ? 'Remove requirement' : 'Add requirement'}
                  >
                    {val !== undefined ? '✕' : '+'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Virus profile (match thresholds) */}
      <div className="panel p-4 space-y-3">
        <p className="label text-[10px]">Virus Profile (auto-match thresholds)</p>
        <p className="text-[10px] text-zinc-500">Set min/max bounds for traits — people matching this profile are auto-recruited over time.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 max-h-64 overflow-y-auto pr-1">
          {TRAIT_KEYS.map(key => {
            const entry = virusProfile[key];
            const hasMin = entry?.min !== undefined;
            const hasMax = entry?.max !== undefined;
            return (
              <div key={key} className="flex items-center gap-2">
                <span className="text-[10px] text-muted w-20 shrink-0 capitalize">{key.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-1 text-[10px]">
                  <button
                    onClick={() => setVirusTrait(key, 'min', hasMin ? undefined : 40)}
                    className={`px-1 rounded border transition-colors
                      ${hasMin ? 'border-sky-600 text-sky-400' : 'border-border text-zinc-600 hover:border-border-warm'}`}
                  >
                    {hasMin ? `≥${entry!.min}` : '+ min'}
                  </button>
                  {hasMin && (
                    <input
                      type="range" min={0} max={100} value={entry!.min!}
                      onChange={e => setVirusTrait(key, 'min', Number(e.target.value))}
                      className="w-14 accent-sky-500"
                    />
                  )}
                  <button
                    onClick={() => setVirusTrait(key, 'max', hasMax ? undefined : 80)}
                    className={`px-1 rounded border transition-colors ml-1
                      ${hasMax ? 'border-amber-600 text-amber-400' : 'border-border text-zinc-600 hover:border-border-warm'}`}
                  >
                    {hasMax ? `≤${entry!.max}` : '+ max'}
                  </button>
                  {hasMax && (
                    <input
                      type="range" min={0} max={100} value={entry!.max!}
                      onChange={e => setVirusTrait(key, 'max', Number(e.target.value))}
                      className="w-14 accent-amber-500"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Members */}
      <div className="panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="label text-[10px]">Members ({members.length})</p>
        </div>

        {/* Add member */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search person by name…"
            value={searchQuery}
            onChange={e => doSearch(e.target.value)}
            className="input-sm w-full text-xs pr-20"
          />
          {searchResults.length > 0 && (
            <div className="absolute top-full left-0 right-0 z-20 panel shadow-xl mt-0.5 max-h-40 overflow-y-auto">
              {searchResults.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setAddPersonId(p.id); setAddPersonName(p.name); setSearchQuery(p.name); setSearchResults([]); }}
                  className="w-full text-left px-3 py-2 text-xs hover:bg-gold/10 transition-colors flex items-center justify-between"
                >
                  <span>{p.name}</span>
                  <span className="text-muted text-[10px]">age {p.age}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {addPersonId && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-400 flex-1 truncate">Selected: {addPersonName}</span>
            <button
              onClick={() => addMut.mutate(addPersonId)}
              disabled={addMut.isPending}
              className="btn-primary text-xs py-1 px-3 disabled:opacity-40"
            >
              {addMut.isPending ? 'Adding…' : 'Add'}
            </button>
            <button
              onClick={() => { setAddPersonId(''); setAddPersonName(''); setSearchQuery(''); }}
              className="text-muted hover:text-gray-300 text-xs"
            >
              ✕
            </button>
          </div>
        )}
        {addMut.isError && (
          <p className="text-[10px] text-red-400">{(addMut.error as Error).message}</p>
        )}

        {/* Member list */}
        {detailQ.isLoading && <p className="text-muted text-xs">Loading members…</p>}
        <div className="space-y-1 max-h-64 overflow-y-auto pr-1">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between gap-2 py-1 border-b border-border/40 last:border-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-text truncate">{m.person.name}</span>
                <span className="text-[10px] text-muted shrink-0">age {m.person.age}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-zinc-500">
                  {Math.round(m.alignment * 100)}% align
                </span>
                <button
                  onClick={() => kickMut.mutate(m.person.id)}
                  disabled={kickMut.isPending}
                  className="text-[10px] text-red-400/70 hover:text-red-400 transition-colors disabled:opacity-40"
                  title="Kick member"
                >
                  Kick
                </button>
              </div>
            </div>
          ))}
          {!detailQ.isLoading && members.length === 0 && (
            <p className="text-muted text-[10px]">No members yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
