// ============================================================
// CharacterDetail — full profile with memory beside stats,
// visual relationship graph, and all four God Mode features.
// ============================================================

import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type RelationshipKind, type RelationshipRow } from '../api/client';
import StatBar, { statTextColor } from '../components/StatBar';
import MemoryBankPanel from '../components/MemoryBankPanel';
import type { CriminalRecord, EmotionalImpact, PersonDelta } from '@civ-sim/shared';
import { GLOBAL_TRAITS, IDENTITY_ATTRIBUTES } from '@civ-sim/shared';
import { FORCE_CONFIG } from '../constants/forces';

// ── Relation metadata ─────────────────────────────────────────

const RELATION_META: Record<RelationshipKind, { label: string; tag: string; nodeColor: string }> = {
  parent:       { label: 'Parent',       tag: 'bg-sky-900/50 text-sky-300',         nodeColor: '#7dd3fc' },
  child:        { label: 'Child',        tag: 'bg-sky-900/50 text-sky-300',         nodeColor: '#7dd3fc' },
  sibling:      { label: 'Sibling',      tag: 'bg-indigo-900/50 text-indigo-300',   nodeColor: '#a5b4fc' },
  spouse:       { label: 'Spouse',       tag: 'bg-pink-900/50 text-pink-300',       nodeColor: '#f9a8d4' },
  lover:        { label: 'Lover',        tag: 'bg-rose-900/50 text-rose-300',       nodeColor: '#fda4af' },
  close_friend: { label: 'Close Friend', tag: 'bg-emerald-900/50 text-emerald-300', nodeColor: '#6ee7b7' },
  rival:        { label: 'Rival',        tag: 'bg-amber-900/50 text-amber-300',     nodeColor: '#fcd34d' },
  enemy:        { label: 'Enemy',        tag: 'bg-red-900/50 text-red-300',         nodeColor: '#f87171' },
};

// ── Trait categories ──────────────────────────────────────────

const TRAIT_CATEGORIES: { label: string; color: string; keys: readonly string[] }[] = [
  { label: 'Physical',  color: 'text-red-400',     keys: IDENTITY_ATTRIBUTES.physical  },
  { label: 'Mental',    color: 'text-sky-400',      keys: IDENTITY_ATTRIBUTES.mental    },
  { label: 'Social',    color: 'text-emerald-400',  keys: IDENTITY_ATTRIBUTES.social    },
  { label: 'Character', color: 'text-amber-400',    keys: IDENTITY_ATTRIBUTES.character },
  { label: 'Skills',    color: 'text-violet-400',   keys: IDENTITY_ATTRIBUTES.skills    },
];

// ── Helpers ───────────────────────────────────────────────────

function normalizeChild(force: string, child: string, value: number): number {
  const def = (GLOBAL_TRAITS as Record<string, { children: Record<string, { min: number; max: number }> }>)
    [force]?.children[child];
  if (!def || def.max === def.min) return 50;
  return Math.round(((value - def.min) / (def.max - def.min)) * 100);
}

function wealthStr(w: number): string {
  if (w >= 1_000_000) return `$${(w / 1_000_000).toFixed(2)}M`;
  if (w >= 1_000)     return `$${(w / 1_000).toFixed(1)}K`;
  return `$${w.toFixed(2)}`;
}

// ── Relationship Graph (SVG) ──────────────────────────────────

function RelationshipGraph({ relationships, subjectName }: {
  relationships: RelationshipRow[];
  subjectName:   string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);

  const W = 340, H = 300, CX = 170, CY = 150, R = 110, NODE_R = 9;

  if (relationships.length === 0) {
    return (
      <p className="text-xs text-muted italic p-4 text-center">No significant bonds yet.</p>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full max-w-xs mx-auto"
      style={{ fontFamily: 'JetBrains Mono, monospace' }}
    >
      {/* Faint ring guide */}
      <circle cx={CX} cy={CY} r={R} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={1} />

      {/* Edges */}
      {relationships.map((rel, i) => {
        const angle = (i / relationships.length) * Math.PI * 2 - Math.PI / 2;
        const nx = CX + Math.cos(angle) * R;
        const ny = CY + Math.sin(angle) * R;
        const opacity = 0.15 + (rel.bond_strength / 100) * 0.6;
        const meta = RELATION_META[rel.relation_type];
        return (
          <line
            key={rel.id}
            x1={CX} y1={CY}
            x2={nx}  y2={ny}
            stroke={meta.nodeColor}
            strokeWidth={1 + (rel.bond_strength / 100) * 2}
            opacity={opacity}
          />
        );
      })}

      {/* Outer nodes */}
      {relationships.map((rel, i) => {
        const angle  = (i / relationships.length) * Math.PI * 2 - Math.PI / 2;
        const nx     = CX + Math.cos(angle) * R;
        const ny     = CY + Math.sin(angle) * R;
        const meta   = RELATION_META[rel.relation_type];
        const isHov  = hovered === rel.id;
        const opacity = rel.target_alive ? 1 : 0.35;

        // Label position: push outward from center
        const labelR = R + 18;
        const lx     = CX + Math.cos(angle) * labelR;
        const ly     = CY + Math.sin(angle) * labelR;

        return (
          <g
            key={rel.id}
            onMouseEnter={() => setHovered(rel.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer', opacity }}
          >
            <circle
              cx={nx} cy={ny}
              r={isHov ? NODE_R + 3 : NODE_R}
              fill={meta.nodeColor}
              fillOpacity={isHov ? 0.9 : 0.6}
              stroke={meta.nodeColor}
              strokeWidth={isHov ? 2 : 1}
            />
            {/* Name label — only on hover */}
            {isHov && (
              <text
                x={lx} y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={8}
                fill="#e5e7eb"
              >
                {rel.target_name.split(' ')[0]}
              </text>
            )}
          </g>
        );
      })}

      {/* Center node — subject */}
      <circle cx={CX} cy={CY} r={16} fill="#5e4a18" stroke="#c9a432" strokeWidth={2} />
      <text
        x={CX} y={CY}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={7}
        fill="#c9a432"
      >
        {subjectName.split(' ')[0]}
      </text>

      {/* Tooltip on hover */}
      {hovered && (() => {
        const rel = relationships.find(r => r.id === hovered);
        if (!rel) return null;
        const meta = RELATION_META[rel.relation_type];
        return (
          <g>
            <rect x={4} y={H - 30} width={W - 8} height={24} rx={4}
                  fill="#0e1117" stroke="#3a2e14" strokeWidth={1} />
            <text x={12} y={H - 14} fontSize={9} fill="#e5e7eb">
              {rel.target_name}
              <tspan fill={meta.nodeColor}> · {meta.label}</tspan>
              <tspan fill="#7a7060"> · bond {rel.bond_strength}</tspan>
              {!rel.target_alive && <tspan fill="#6b7280"> · deceased</tspan>}
            </text>
          </g>
        );
      })()}
    </svg>
  );
}

// ── God Mode — Edit Stats tab ─────────────────────────────────

const STAT_GROUPS = [
  {
    label: 'Vital Stats',
    stats: ['health', 'age', 'death_age', 'wealth'],
  },
  {
    label: 'Social Stats',
    stats: ['morality', 'happiness', 'reputation', 'influence', 'intelligence'],
  },
];

// Flatten identity attribute keys for the dropdown
const ALL_TRAIT_KEYS = [
  ...IDENTITY_ATTRIBUTES.physical,
  ...IDENTITY_ATTRIBUTES.mental,
  ...IDENTITY_ATTRIBUTES.social,
  ...IDENTITY_ATTRIBUTES.character,
  ...IDENTITY_ATTRIBUTES.skills,
];

function EditStatsPanel({ personId }: { personId: string }) {
  const qc = useQueryClient();
  const [stat,    setStat]    = useState('health');
  const [value,   setValue]   = useState('');
  const [summary, setSummary] = useState('');
  const [impact,  setImpact]  = useState<EmotionalImpact>('neutral');
  const [mode,    setMode]    = useState<'god' | 'sim'>('god');
  const [errMsg,  setErrMsg]  = useState('');
  const [okMsg,   setOkMsg]   = useState('');

  const mutation = useMutation({
    mutationFn: async () => {
      const parsed = parseFloat(value);
      if (Number.isNaN(parsed)) throw new Error('Value must be a number');
      if (!summary.trim())      throw new Error('Event summary required');
      const delta: PersonDelta = { [stat]: parsed };
      const body = { delta, event_summary: summary.trim(), emotional_impact: impact, force: mode === 'god' };
      return mode === 'god'
        ? api.godMode.apply(personId, body)
        : api.characters.applyDelta(personId, body);
    },
    onSuccess: () => {
      setOkMsg('Applied.'); setErrMsg(''); setValue(''); setSummary('');
      qc.invalidateQueries({ queryKey: ['character', personId] });
      setTimeout(() => setOkMsg(''), 3000);
    },
    onError: (e: Error) => { setErrMsg(e.message); setOkMsg(''); },
  });

  return (
    <div className="space-y-3">
      {/* Mode toggle */}
      <div className="flex gap-2">
        <button onClick={() => setMode('god')} className={mode === 'god' ? 'btn-god' : 'btn-ghost'}>
          ⚡ God Mode
        </button>
        <button onClick={() => setMode('sim')} className={mode === 'sim' ? 'btn-sim' : 'btn-ghost'}>
          ⚙ Simulation
        </button>
      </div>
      {mode === 'god' && (
        <p className="text-[10px] text-amber-500/70 italic">Bypasses all simulation rules.</p>
      )}

      <div className="grid grid-cols-2 gap-2">
        {/* Stat picker */}
        <div className="space-y-1">
          <label className="label block">Attribute</label>
          <select value={stat} onChange={e => setStat(e.target.value)} className="input-base">
            {STAT_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.stats.map(s => <option key={s} value={s}>{s}</option>)}
              </optgroup>
            ))}
            <optgroup label="Identity Traits">
              {ALL_TRAIT_KEYS.map(k => (
                <option key={k} value={`trait.${k}`}>trait.{k}</option>
              ))}
            </optgroup>
          </select>
        </div>
        {/* Value */}
        <div className="space-y-1">
          <label className="label block">New Value</label>
          <input
            type="number" placeholder="e.g. 75"
            value={value} onChange={e => setValue(e.target.value)}
            className="input-base"
          />
        </div>
      </div>

      {/* Emotional impact */}
      <div className="space-y-1">
        <label className="label block">Emotional Impact</label>
        <select value={impact} onChange={e => setImpact(e.target.value as EmotionalImpact)} className="input-base">
          {(['traumatic','negative','neutral','positive','euphoric'] as EmotionalImpact[]).map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>

      {/* Event summary */}
      <div className="space-y-1">
        <label className="label block">Event Summary</label>
        <textarea
          rows={2} placeholder="Describe what happened…"
          value={summary} onChange={e => setSummary(e.target.value)}
          className="input-base resize-none"
        />
      </div>

      <button
        onClick={() => mutation.mutate()} disabled={mutation.isPending}
        className={`${mode === 'god' ? 'btn-god' : 'btn-sim'} w-full disabled:opacity-40`}
      >
        {mutation.isPending ? 'Applying…' : mode === 'god' ? '⚡ Apply God Mode' : '⚙ Apply Delta'}
      </button>
      {errMsg && <p className="text-red-400 text-[10px]">{errMsg}</p>}
      {okMsg  && <p className="text-emerald-400 text-[10px]">{okMsg}</p>}
    </div>
  );
}

// ── God Mode — Force Interaction tab ─────────────────────────

function ForceInteractionTab({ subjectId, subjectName }: { subjectId: string; subjectName: string }) {
  const qc = useQueryClient();
  const [antaId,  setAntaId]  = useState('');
  const [typeId,  setTypeId]  = useState('');
  const [errMsg,  setErrMsg]  = useState<string | null>(null);
  const [result,  setResult]  = useState<string | null>(null);

  const { data: charData } = useQuery({
    queryKey: ['characters', 1, 100],
    queryFn:  () => api.characters.list(1, 100),
  });
  const { data: ruleset } = useQuery({
    queryKey: ['ruleset-active'],
    queryFn:  api.rulesets.active,
  });

  const chars  = charData?.data.filter(c => c.id !== subjectId) ?? [];
  const iTypes = ruleset?.rules?.interaction_types ?? [];

  const mutation = useMutation({
    mutationFn: () => {
      if (!antaId)  throw new Error('Select an antagonist');
      if (!typeId)  throw new Error('Select an interaction type');
      return api.interactions.force({
        subject_id:          subjectId,
        antagonist_id:       antaId,
        interaction_type_id: typeId,
      });
    },
    onSuccess: (data) => {
      setResult(`${data.outcome}  ·  score ${data.score}`);
      setErrMsg(null);
      qc.invalidateQueries({ queryKey: ['character', subjectId] });
    },
    onError: (e: Error) => { setErrMsg(e.message); setResult(null); },
  });

  return (
    <div className="space-y-3">
      <p className="text-[10px] text-muted">
        Subject: <span className="text-gray-300">{subjectName}</span>
      </p>
      <div className="space-y-1">
        <label className="label block">Antagonist</label>
        <select value={antaId} onChange={e => setAntaId(e.target.value)} className="input-base">
          <option value="">— select —</option>
          {chars.map(c => <option key={c.id} value={c.id}>{c.name} (age {c.age})</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label className="label block">Interaction Type</label>
        {iTypes.length === 0
          ? <p className="text-[10px] text-muted italic">No active ruleset.</p>
          : (
            <select value={typeId} onChange={e => setTypeId(e.target.value)} className="input-base">
              <option value="">— select —</option>
              {iTypes.map((t: { id: string; label: string }) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          )
        }
      </div>
      <button
        onClick={() => { setResult(null); mutation.mutate(); }}
        disabled={mutation.isPending}
        className="w-full btn bg-sky-900/40 border border-sky-700/60 hover:bg-sky-800/60 text-sky-300 disabled:opacity-40"
      >
        {mutation.isPending ? 'Running…' : '⚔ Run Forced Interaction'}
      </button>
      {errMsg  && <p className="text-red-400 text-[10px]">{errMsg}</p>}
      {result  && <p className="text-emerald-400 text-[10px]">{result}</p>}
    </div>
  );
}

// ── God Mode — Write Event tab ────────────────────────────────

function WriteEventTab({ personId }: { personId: string }) {
  const qc = useQueryClient();
  const [summary, setSummary] = useState('');
  const [impact,  setImpact]  = useState<EmotionalImpact>('neutral');
  const [stat,    setStat]    = useState('health');
  const [delta,   setDelta]   = useState('');
  const [errMsg,  setErrMsg]  = useState('');
  const [okMsg,   setOkMsg]   = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (!summary.trim()) throw new Error('Event summary required');
      const d: Record<string, number> = {};
      if (delta !== '' && !isNaN(parseFloat(delta))) d[stat] = parseFloat(delta);
      return api.godMode.apply(personId, {
        delta: d, event_summary: summary.trim(), emotional_impact: impact, force: true,
      });
    },
    onSuccess: () => {
      setOkMsg('Memory written.'); setErrMsg(''); setSummary(''); setDelta('');
      qc.invalidateQueries({ queryKey: ['character', personId] });
      setTimeout(() => setOkMsg(''), 3000);
    },
    onError: (e: Error) => { setErrMsg(e.message); setOkMsg(''); },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="label block">Event Summary (becomes a memory)</label>
        <textarea
          rows={3} placeholder="Describe what happened in this person's life…"
          value={summary} onChange={e => setSummary(e.target.value)}
          className="input-base resize-none"
        />
      </div>
      <div className="space-y-1">
        <label className="label block">Emotional Impact</label>
        <select value={impact} onChange={e => setImpact(e.target.value as EmotionalImpact)} className="input-base">
          {(['traumatic','negative','neutral','positive','euphoric'] as EmotionalImpact[]).map(i => (
            <option key={i} value={i}>{i}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="label block">Stat affected (optional)</label>
          <select value={stat} onChange={e => setStat(e.target.value)} className="input-base">
            {['health','morality','happiness','reputation','influence','intelligence','wealth','age'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="label block">Delta value</label>
          <input
            type="number" placeholder="e.g. -15"
            value={delta} onChange={e => setDelta(e.target.value)}
            className="input-base"
          />
        </div>
      </div>
      <button
        onClick={() => mutation.mutate()} disabled={mutation.isPending}
        className="btn-rune w-full disabled:opacity-40"
      >
        {mutation.isPending ? 'Writing…' : '✍ Write Memory'}
      </button>
      {errMsg && <p className="text-red-400 text-[10px]">{errMsg}</p>}
      {okMsg  && <p className="text-emerald-400 text-[10px]">{okMsg}</p>}
    </div>
  );
}

// ── God Mode — Add Criminal Record tab ───────────────────────

function CriminalRecordTab({ personId }: { personId: string }) {
  const qc = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [offense,      setOffense]      = useState('');
  const [severity,     setSeverity]     = useState<CriminalRecord['severity']>('minor');
  const [status,       setStatus]       = useState<CriminalRecord['status']>('convicted');
  const [date,         setDate]         = useState(today);
  const [notes,        setNotes]        = useState('');
  const [eventSummary, setEventSummary] = useState('');
  const [errMsg,       setErrMsg]       = useState('');
  const [okMsg,        setOkMsg]        = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (!offense.trim())      throw new Error('Offense required');
      if (!eventSummary.trim()) throw new Error('Event summary required');
      return api.characters.addCriminalRecord(personId, {
        record: {
          offense: offense.trim(),
          severity,
          status,
          date,
          notes: notes.trim() || undefined,
        },
        event_summary: eventSummary.trim(),
      });
    },
    onSuccess: () => {
      setOkMsg('Record added.'); setErrMsg('');
      setOffense(''); setNotes(''); setEventSummary('');
      qc.invalidateQueries({ queryKey: ['character', personId] });
      setTimeout(() => setOkMsg(''), 3000);
    },
    onError: (e: Error) => { setErrMsg(e.message); setOkMsg(''); },
  });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="label block">Offense</label>
        <input
          type="text" placeholder="e.g. Murder, Theft, Heresy…"
          value={offense} onChange={e => setOffense(e.target.value)}
          className="input-base"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="label block">Severity</label>
          <select value={severity} onChange={e => setSeverity(e.target.value as typeof severity)} className="input-base">
            <option value="minor">Minor</option>
            <option value="moderate">Moderate</option>
            <option value="severe">Severe</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className="label block">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className="input-base">
            <option value="pending">Pending</option>
            <option value="convicted">Convicted</option>
            <option value="acquitted">Acquitted</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="label block">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} className="input-base" />
        </div>
        <div className="space-y-1">
          <label className="label block">Notes</label>
          <input type="text" placeholder="Optional context" value={notes} onChange={e => setNotes(e.target.value)} className="input-base" />
        </div>
      </div>
      <div className="space-y-1">
        <label className="label block">Event Summary</label>
        <input
          type="text" maxLength={500} placeholder="One-line chronicle entry (required)"
          value={eventSummary} onChange={e => setEventSummary(e.target.value)}
          className="input-base"
        />
      </div>
      <button
        onClick={() => mutation.mutate()} disabled={mutation.isPending}
        className="btn-danger w-full disabled:opacity-40"
      >
        {mutation.isPending ? 'Adding…' : '⚖ Add to Record'}
      </button>
      {errMsg && <p className="text-red-400 text-[10px]">{errMsg}</p>}
      {okMsg  && <p className="text-emerald-400 text-[10px]">{okMsg}</p>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────

type GodTab = 'stats' | 'interaction' | 'event' | 'record';

export default function CharacterDetail() {
  const { id } = useParams<{ id: string }>();
  const [godTab, setGodTab] = useState<GodTab>('stats');

  const { data: person, isLoading, isError } = useQuery({
    queryKey:  ['character', id],
    queryFn:   () => api.characters.get(id!),
    enabled:   !!id,
    refetchOnWindowFocus: true,
  });

  const { data: relationships } = useQuery({
    queryKey: ['character', id, 'relationships'],
    queryFn:  () => api.characters.relationships(id!),
    enabled:  !!id,
  });

  const { data: lineage } = useQuery({
    queryKey: ['character', id, 'lineage'],
    queryFn:  () => api.characters.lineage(id!),
    enabled:  !!id,
  });

  if (isLoading) return <div className="p-8 text-muted animate-pulse">Loading…</div>;
  if (isError || !person) {
    return (
      <div className="p-8 text-red-400">
        Character not found.{' '}
        <Link to="/souls" className="underline">Back to Souls</Link>
      </div>
    );
  }

  const traits       = (person.traits ?? {}) as Record<string, number>;
  const globalScores = (person.global_scores ?? {}) as Record<string, number>;

  // Derived vitals from identity traits
  const avg = (...vals: number[]) => Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  const vitalMorality    = avg(traits.honesty ?? 50, traits.courage ?? 50, traits.discipline ?? 50);
  const vitalInfluence   = avg(traits.charisma ?? 50, traits.leadership ?? 50);
  const vitalHappiness   = avg(traits.humor ?? 50, traits.empathy ?? 50);
  const vitalReputation  = avg(traits.persuasion ?? 50, traits.charisma ?? 50);
  const vitalIntelligence = traits.intelligence ?? 0;

  return (
    <div className="page space-y-6">

      {/* ── Breadcrumb ── */}
      <nav className="text-[10px] text-muted">
        <Link to="/souls" className="hover:text-gold transition-colors">Souls</Link>
        <span className="mx-2 text-border-warm">◆</span>
        <span className="text-gray-300">{person.name}</span>
      </nav>

      {/* ── Hero header ── */}
      <div className="flex flex-wrap items-start gap-3">
        <h1 className="font-display text-3xl font-bold text-gold tracking-wide">{person.name}</h1>
        <div className="flex flex-wrap gap-2 items-center mt-1">
          <span className="tag bg-surface border border-border text-muted">{person.sexuality}</span>
          <span className="tag bg-surface border border-border text-muted">{person.race}</span>
          <span className="tag bg-surface border border-border text-muted">{person.occupation}</span>
          {person.criminal_record.length > 0 && (
            <span className="tag bg-blood/20 border border-blood/50 text-red-400">
              {person.criminal_record.length} record{person.criminal_record.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* ── 5-stat quick strip ── */}
      <div className="grid grid-cols-5 gap-2">
        {[
          { label: 'Health',    value: person.health      },
          { label: 'Morality',  value: vitalMorality      },
          { label: 'Influence', value: vitalInfluence     },
          { label: 'Happiness', value: vitalHappiness     },
          { label: 'Intellect', value: vitalIntelligence  },
        ].map(({ label, value }) => (
          <div key={label} className="panel p-3 text-center">
            <div className="label mb-1">{label}</div>
            <div className={`text-lg font-bold tabular-nums ${statTextColor(value)}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── Main two-column: stats + memory ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* LEFT — stats (3/5) */}
        <div className="lg:col-span-3 space-y-4">

          {/* Identity */}
          <div className="panel p-4">
            <h2 className="label text-gold/70 mb-3">Identity</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
              {([
                ['Gender',       person.gender],
                ['Religion',     person.religion],
                ['Relationship', person.relationship_status],
                ['Age',          `${person.age} / ${person.death_age} yrs`],
                ['Wealth',       wealthStr(person.wealth)],
                ['Trauma',       Math.round(person.trauma_score)],
              ] as [string, string | number][]).map(([k, v]) => (
                <div key={k}>
                  <span className="label block">{k}</span>
                  <span className="text-gray-200">{v}</span>
                </div>
              ))}
            </div>
            {person.physical_appearance && (
              <div className="mt-3 pt-3 border-t border-border">
                <span className="label block mb-1">Appearance</span>
                <p className="text-xs text-gray-400 leading-relaxed">{person.physical_appearance}</p>
              </div>
            )}
          </div>

          {/* Vital stat bars */}
          <div className="panel p-4 space-y-3">
            <h2 className="label text-gold/70">Vital</h2>
            <StatBar label="Health"       value={person.health}       />
            <StatBar label="Morality"     value={vitalMorality}       />
            <StatBar label="Happiness"    value={vitalHappiness}      />
            <StatBar label="Reputation"   value={vitalReputation}     />
            <StatBar label="Influence"    value={vitalInfluence}      />
            <StatBar label="Intelligence" value={vitalIntelligence}   />
            {/* Trauma — inverted bar */}
            <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
              <span className="text-[10px] text-muted uppercase tracking-widest">Trauma</span>
              <div className="stat-bar-track">
                <div
                  className="h-full rounded-full bg-red-600 transition-all duration-500"
                  style={{
                    width:   `${Math.min(100, person.trauma_score)}%`,
                    opacity: 0.3 + (person.trauma_score / 100) * 0.65,
                  }}
                />
              </div>
              <span className="text-[11px] font-medium w-7 text-right tabular-nums text-red-400">
                {Math.round(person.trauma_score)}
              </span>
            </div>
            {/* Age progress */}
            <StatBar
              label="Life Progress"
              value={Math.round((person.age / person.death_age) * 100)}
              showValue={false}
            />
          </div>

          {/* Identity attributes — 5 categories */}
          <div className="panel p-4 space-y-4">
            <h2 className="label text-gold/70">Identity Attributes</h2>
            {TRAIT_CATEGORIES.map(({ label, color, keys }) => (
              <div key={label}>
                <span className={`text-[10px] font-semibold uppercase tracking-widest ${color}`}>{label}</span>
                <div className="mt-2 space-y-1.5">
                  {keys.map(k => (
                    <StatBar key={k} label={k.replace(/_/g, ' ')} value={traits[k] ?? 0} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* World forces (only if data exists) */}
          {Object.keys(globalScores).length > 0 && (
            <div className="panel p-4 space-y-4">
              <h2 className="label text-gold/70">World Force Resonance</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {FORCE_CONFIG.map(({ key, label, textColor }) => {
                  const forceDef = (GLOBAL_TRAITS as Record<string, { children: Record<string, { min: number; max: number }> }>)[key];
                  const children = Object.entries(forceDef?.children ?? {});
                  return (
                    <div key={key}>
                      <p className={`text-xs font-semibold mb-2 uppercase tracking-widest ${textColor}`}>{label}</p>
                      <div className="space-y-1.5">
                        {children.map(([child]) => {
                          const val  = globalScores[`${key}.${child}`] ?? 0;
                          const norm = normalizeChild(key, child, val);
                          return (
                            <div key={child} className="flex items-center gap-2">
                              <span className="text-[10px] text-muted w-36 shrink-0 capitalize">
                                {child.replace(/_/g, ' ')}
                              </span>
                              <div className="flex-1">
                                <StatBar label="" value={norm} showValue={false} />
                              </div>
                              <span className="text-[10px] text-zinc-500 w-8 text-right tabular-nums">
                                {val > 0 ? `+${val}` : val}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Criminal record */}
          {person.criminal_record.length > 0 && (
            <div className="panel p-4 space-y-3">
              <h2 className="label text-gold/70">Criminal Record</h2>
              {(person.criminal_record as CriminalRecord[]).map((r, i) => (
                <div key={i} className="text-xs grid grid-cols-[1fr_auto] gap-2 border-b border-border pb-2 last:border-0 last:pb-0">
                  <div>
                    <span className="text-gray-200 font-medium">{r.offense}</span>
                    {r.notes && <p className="text-muted mt-0.5">{r.notes}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`tag ${r.status === 'convicted' ? 'bg-blood/20 text-red-400 border border-blood/40' : r.status === 'pending' ? 'bg-amber-900/30 text-amber-400 border border-amber-700/40' : 'bg-surface text-muted border border-border'}`}>
                      {r.status}
                    </span>
                    <p className="text-[10px] text-muted mt-1">{r.date} · {r.severity}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* RIGHT — memory feed (2/5) */}
        <div className="lg:col-span-2 space-y-4">

          {/* Lineage — compact */}
          {lineage && (lineage.parents.length > 0 || lineage.children.length > 0) && (
            <div className="panel p-4 space-y-3">
              <h2 className="label text-gold/70">
                Lineage
                <span className="text-gold-dim ml-2">
                  ({(lineage?.parents.length ?? 0) + (lineage?.children.length ?? 0)})
                </span>
              </h2>
              {lineage.parents.length > 0 && (
                <div>
                  <p className="label mb-1">Parents</p>
                  <div className="space-y-1">
                    {lineage.parents.map(p => (
                      <Link key={p.id} to={`/characters/${p.id}`}
                            className="flex justify-between text-xs hover:text-gold transition-colors">
                        <span className="text-gray-300">{p.name}</span>
                        <span className="text-muted tabular-nums">{p.age} yrs</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {lineage.children.length > 0 && (
                <div>
                  <p className="label mb-1">Children ({lineage.children.length})</p>
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {lineage.children.map(c => (
                      <Link key={c.id} to={`/characters/${c.id}`}
                            className="flex justify-between text-xs hover:text-gold transition-colors">
                        <span className="text-gray-300">{c.name}</span>
                        <span className="text-muted tabular-nums">{c.age} yrs</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Memory feed */}
          <div className="panel p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="label text-gold/70">
                Chronicle
                <span className="text-gold-dim ml-2">
                  ({person.memory_bank?.length ?? 0})
                </span>
              </h2>
            </div>
            <div className="max-h-[600px] overflow-y-auto pr-1 space-y-2">
              <MemoryBankPanel entries={person.memory_bank ?? []} />
            </div>
          </div>
        </div>
      </div>

      {/* ── God Mode section — tabbed ── */}
      <div className="space-y-0">
        <div className="divider">
          <span className="divider-text">⚡ God Mode</span>
        </div>
        <div className="panel-warm rounded-lg overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            {([
              { id: 'stats',       label: '⚡ Edit Stats'     },
              { id: 'interaction', label: '⚔ Force Interaction' },
              { id: 'event',       label: '✍ Write Event'     },
              { id: 'record',      label: '⚖ Criminal Record' },
            ] as { id: GodTab; label: string }[]).map(t => (
              <button
                key={t.id}
                onClick={() => setGodTab(t.id)}
                className={`flex-1 px-3 py-2.5 text-[11px] tracking-wide transition-colors
                  ${godTab === t.id
                    ? 'text-gold border-b-2 border-gold bg-gold-dim/10'
                    : 'text-muted hover:text-gray-300 border-b-2 border-transparent'
                  }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* Tab content */}
          <div className="p-4">
            {godTab === 'stats'       && <EditStatsPanel        personId={person.id} />}
            {godTab === 'interaction' && <ForceInteractionTab   subjectId={person.id} subjectName={person.name} />}
            {godTab === 'event'       && <WriteEventTab         personId={person.id} />}
            {godTab === 'record'      && <CriminalRecordTab     personId={person.id} />}
          </div>
        </div>
      </div>

      {/* ── Relationship graph ── */}
      {relationships && relationships.length > 0 && (
        <div className="space-y-0">
          <div className="divider">
            <span className="divider-text">◈ Bonds  ·  {relationships.length}</span>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Visual graph */}
            <div className="panel p-4">
              <RelationshipGraph
                relationships={relationships}
                subjectName={person.name}
              />
              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3 justify-center">
                {Object.entries(RELATION_META).map(([type, meta]) => (
                  <div key={type} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: meta.nodeColor, opacity: 0.7 }} />
                    <span className="text-[9px] text-muted">{meta.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* List */}
            <div className="panel p-4 space-y-2 max-h-80 overflow-y-auto">
              {relationships.map(r => {
                const meta   = RELATION_META[r.relation_type];
                const isWarm = r.bond_strength >= 50;
                const pct    = Math.round(Math.abs(r.bond_strength - 50) * 2);
                return (
                  <div key={r.id} className="border-b border-border pb-2 last:border-0 last:pb-0 space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <Link
                        to={`/characters/${r.target_id}`}
                        className={`font-medium truncate ${r.target_alive ? 'text-gray-200 hover:text-gold' : 'text-zinc-600 line-through'}`}
                      >
                        {r.target_name}
                      </Link>
                      <span className={`tag shrink-0 ${meta.tag}`}>{meta.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded overflow-hidden bg-surface">
                        <div
                          className={`h-full ${isWarm ? 'bg-emerald-500/60' : 'bg-red-500/60'}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted tabular-nums w-6 text-right">
                        {r.bond_strength}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
