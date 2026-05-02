// Factions hub — leaderboard view across all factions in a world.
// Tabs sort by biggest / richest / oldest / newest / most-competitive /
// most-rewarding. God-mode controls: summon a founder soul + faction (forced
// `ambitious` tag), dissolve any existing.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PERSONALITY_TAGS,
  PERSON_TYPES,
  type PersonalityTag,
  type PersonType,
} from '@claude-god/shared';
import { api } from '../lib/api';
import { useWorld } from '../hooks/useWorld';
import type { GroupRow } from '../hooks/useGroup';

type Metric =
  | 'biggest'
  | 'richest'
  | 'oldest'
  | 'newest'
  | 'most_competitive'
  | 'most_rewarding';

interface MetricCfg {
  key: Metric;
  label: string;
  column: string;
  format: (g: GroupRow) => string;
  compare: (a: GroupRow, b: GroupRow) => number;
}

function topShare(g: GroupRow): number {
  if (!g.prize_shares || g.prize_shares.length === 0) return 0;
  return g.prize_shares[0];
}

function expectedPerMember(g: GroupRow): number {
  return g.treasury / Math.max(1, g.member_count_cached);
}

const METRICS: MetricCfg[] = [
  {
    key: 'biggest',
    label: 'Biggest',
    column: 'Members',
    format: (g) => g.member_count_cached.toLocaleString(),
    compare: (a, b) => b.member_count_cached - a.member_count_cached,
  },
  {
    key: 'richest',
    label: 'Richest',
    column: 'Treasury',
    format: (g) => g.treasury.toLocaleString(),
    compare: (a, b) => b.treasury - a.treasury,
  },
  {
    key: 'oldest',
    label: 'Oldest',
    column: 'Founded',
    format: (g) => `yr ${g.founded_year}`,
    compare: (a, b) => a.founded_year - b.founded_year,
  },
  {
    key: 'newest',
    label: 'Newest',
    column: 'Founded',
    format: (g) => `yr ${g.founded_year}`,
    compare: (a, b) => b.founded_year - a.founded_year,
  },
  {
    key: 'most_competitive',
    label: 'Most competitive',
    column: 'Top prize',
    format: (g) =>
      g.prize_shares && g.prize_shares.length > 0
        ? `${(topShare(g) * 100).toFixed(0)}%`
        : '—',
    compare: (a, b) => topShare(b) - topShare(a),
  },
  {
    key: 'most_rewarding',
    label: 'Most rewarding',
    column: 'Avg / member',
    format: (g) => Math.floor(expectedPerMember(g)).toLocaleString(),
    compare: (a, b) => expectedPerMember(b) - expectedPerMember(a),
  },
];

export function Factions() {
  const { worldId } = useParams<{ worldId: string }>();
  const [active, setActive] = useState<Metric>('biggest');
  const [includeDissolved, setIncludeDissolved] = useState(false);
  const worldQ = useWorld(worldId);

  const q = useQuery<{ rows: GroupRow[] }>({
    queryKey: ['factions', worldId, includeDissolved],
    queryFn: () =>
      api(
        `/api/groups?world_id=${worldId}&kind=faction${
          includeDissolved ? '' : '&active=true'
        }`,
      ),
    enabled: !!worldId,
  });

  const cfg = METRICS.find((m) => m.key === active) ?? METRICS[0];
  const rows = useMemo(() => {
    if (!q.data) return [];
    return [...q.data.rows].sort(cfg.compare);
  }, [q.data, cfg]);

  const currentYear = worldQ.data?.world.current_year ?? 0;
  const cityId = worldQ.data?.city?.id ?? null;
  const cityName = worldQ.data?.city?.name ?? '—';

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
      <header>
        <h1 className="font-display text-3xl text-gold-bright">Factions</h1>
        <p className="text-muted text-xs uppercase tracking-widest mt-1">
          {q.data
            ? `${q.data.rows.length} ${includeDissolved ? 'total' : 'active'}`
            : '—'}
        </p>
      </header>

      {worldId && (
        <SummonFactionPanel
          worldId={worldId}
          cityId={cityId}
          cityName={cityName}
          foundedYear={currentYear}
        />
      )}

      <section className="border border-border-warm rounded bg-panel-warm">
        <header className="px-3 py-3 border-b border-border-warm flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1">
            {METRICS.map((m) => (
              <button
                key={m.key}
                onClick={() => setActive(m.key)}
                className={
                  'px-3 py-1.5 text-xs uppercase tracking-wider rounded transition ' +
                  (m.key === active
                    ? 'bg-emerald-700 text-white'
                    : 'text-muted hover:text-amber-300 hover:bg-amber-400/10')
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeDissolved}
              onChange={(e) => setIncludeDissolved(e.target.checked)}
            />
            Include dissolved
          </label>
        </header>

        <div className="px-2 pb-2 pt-2">
          {q.isLoading && (
            <div className="px-4 py-6 text-muted text-sm">Loading…</div>
          )}
          {q.error && (
            <div className="px-4 py-6 text-blood text-sm">Failed to load factions.</div>
          )}
          {q.data && rows.length === 0 && (
            <div className="px-4 py-6 text-muted text-sm italic">No factions yet.</div>
          )}
          {rows.length > 0 && (
            <>
              <div className="px-3 pb-2 grid grid-cols-[2rem_1fr_auto_auto] gap-3 text-[10px] uppercase tracking-widest text-muted">
                <span className="text-right">#</span>
                <span>Faction</span>
                <span className="text-right">{cfg.column}</span>
                <span className="w-6" />
              </div>
              <ol className="divide-y divide-border-warm">
                {rows.map((g, i) => (
                  <FactionRowView
                    key={g.id}
                    g={g}
                    rank={i + 1}
                    cfg={cfg}
                    worldId={worldId!}
                    currentYear={currentYear}
                  />
                ))}
              </ol>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Row ──────────────────────────────────────────────────────────────────

function FactionRowView({
  g,
  rank,
  cfg,
  worldId,
  currentYear,
}: {
  g: GroupRow;
  rank: number;
  cfg: MetricCfg;
  worldId: string;
  currentYear: number;
}) {
  const dissolve = useDissolveFaction(worldId);

  const handleDissolve = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (
      confirm(
        `Dissolve "${g.name}" at year ${currentYear}? Members will be released.`,
      )
    ) {
      dissolve.mutate({ id: g.id, year: currentYear });
    }
  };

  return (
    <li className="grid grid-cols-[2rem_1fr_auto_auto] gap-3 items-center px-3 py-2 hover:bg-panel transition">
      <Link to={`/world/${worldId}/group/${g.id}`} className="contents">
        <span className="text-muted text-xs tabular-nums text-right">{rank}</span>
        <span className="min-w-0">
          <span className="font-display text-gold-bright truncate">{g.name}</span>
          {!g.is_active && (
            <span className="ml-2 text-blood text-[10px] uppercase tracking-widest">
              Dissolved yr {g.dissolved_year ?? '?'}
            </span>
          )}
          <div className="text-muted text-xs mt-0.5">
            {g.member_count_cached.toLocaleString()} members ·{' '}
            {Math.max(0, currentYear - g.founded_year)}y old · treasury{' '}
            {g.treasury.toLocaleString()}
            {g.intelligence_target != null && (
              <> · intel target {g.intelligence_target}</>
            )}
          </div>
        </span>
        <span className="font-mono text-sm text-gold tabular-nums text-right">
          {cfg.format(g)}
        </span>
      </Link>
      {g.is_active ? (
        <button
          onClick={handleDissolve}
          disabled={dissolve.isPending}
          title="Dissolve faction"
          className="w-7 h-7 flex items-center justify-center rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-40 text-sm"
        >
          {dissolve.isPending ? '…' : '×'}
        </button>
      ) : (
        <span className="w-7" />
      )}
    </li>
  );
}

// ─── Summon panel ─────────────────────────────────────────────────────────

interface FounderDraft {
  type: PersonType;
  name: string;
  gender: 'male' | 'female';
  age: number;
  intelligence: number;
  combat: number;
  happiness: number;
  wealth: number;
  personality_tags: PersonalityTag[];
}

interface FactionDraft {
  name: string;
  wanted_tags: PersonalityTag[];
  cost_per_year: number;
  leader_dues_cut: number; // 0-0.5
  prize_shares: number[]; // up to 5, fractions of post-leader-cut treasury
  intelligence_target: number | null; // 0-100 or null = off
  stat_floors: {
    intelligence_min: number | null;
    combat_min: number | null;
    wealth_min: number | null;
    age_min: number | null;
  };
  type_affinities: Partial<Record<PersonType, number>>;
}

const DEFAULT_FOUNDER: FounderDraft = {
  type: 'Soldier',
  name: '',
  gender: 'male',
  age: 30,
  intelligence: 60,
  combat: 70,
  happiness: 60,
  wealth: 500,
  personality_tags: ['ambitious', 'charismatic'],
};

const DEFAULT_FACTION: FactionDraft = {
  name: '',
  wanted_tags: ['ambitious'],
  cost_per_year: 50,
  leader_dues_cut: 0.10,
  prize_shares: [0.5, 0.3, 0.2],
  intelligence_target: null,
  stat_floors: {
    intelligence_min: null,
    combat_min: null,
    wealth_min: null,
    age_min: null,
  },
  type_affinities: {},
};

function SummonFactionPanel({
  worldId,
  cityId,
  cityName,
  foundedYear,
}: {
  worldId: string;
  cityId: string | null;
  cityName: string;
  foundedYear: number;
}) {
  const [open, setOpen] = useState(false);
  const [founder, setFounder] = useState<FounderDraft>(DEFAULT_FOUNDER);
  const [faction, setFaction] = useState<FactionDraft>(DEFAULT_FACTION);
  const [lastSummary, setLastSummary] = useState<string | null>(null);
  const create = useSummonFaction(worldId);

  const toggleFounderTag = (t: PersonalityTag) => {
    setFounder((f) => {
      // ambitious is locked on for the founder so faction-fit gates pass.
      if (t === 'ambitious') return f;
      return {
        ...f,
        personality_tags: f.personality_tags.includes(t)
          ? f.personality_tags.filter((x) => x !== t)
          : [...f.personality_tags, t].slice(0, 8),
      };
    });
  };
  const toggleFactionTag = (t: PersonalityTag) => {
    setFaction((r) => ({
      ...r,
      wanted_tags: r.wanted_tags.includes(t)
        ? r.wanted_tags.filter((x) => x !== t)
        : [...r.wanted_tags, t].slice(0, 8),
    }));
  };

  const trimmedName = faction.name.trim();
  const sharesSum = faction.prize_shares.reduce((s, x) => s + x, 0);
  const sharesValid = faction.prize_shares.length === 0 || sharesSum <= 1.0001;
  const leaderCutValid = faction.leader_dues_cut >= 0 && faction.leader_dues_cut <= 0.5;
  const canSubmit =
    !!cityId &&
    !!trimmedName &&
    faction.wanted_tags.length >= 1 &&
    sharesValid &&
    leaderCutValid &&
    !create.isPending;

  const submit = () => {
    if (!canSubmit || !cityId) return;
    const stat_floors: Record<string, number> = {};
    for (const [k, v] of Object.entries(faction.stat_floors)) {
      if (v != null && v >= 0) stat_floors[k] = v;
    }
    create.mutate(
      {
        world_id: worldId,
        city_id: cityId,
        founder: {
          type: founder.type,
          name: founder.name.trim() || undefined,
          gender: founder.gender,
          age: founder.age,
          intelligence: founder.intelligence,
          combat: founder.combat,
          happiness: founder.happiness,
          wealth: founder.wealth,
          personality_tags: founder.personality_tags,
        },
        faction: {
          name: trimmedName,
          wanted_tags: faction.wanted_tags,
          cost_per_year: faction.cost_per_year,
          leader_dues_cut: faction.leader_dues_cut,
          prize_shares: faction.prize_shares.filter((x) => x > 0),
          intelligence_target: faction.intelligence_target ?? undefined,
          stat_floors,
          type_affinities: faction.type_affinities,
        },
      },
      {
        onSuccess: (r) => {
          setLastSummary(`"${r.group.name}" founded by ${r.founder.name}`);
          setFounder(DEFAULT_FOUNDER);
          setFaction(DEFAULT_FACTION);
        },
      },
    );
  };

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header
        className="px-4 py-3 flex items-center justify-between cursor-pointer select-none"
        onClick={() => setOpen((o) => !o)}
      >
        <div>
          <h2 className="font-display text-lg text-gold-bright">Summon faction</h2>
          {open && (
            <p className="text-muted text-[10px] uppercase tracking-widest mt-0.5">
              Forge a real, pinned founder · year {foundedYear} · {cityName}
            </p>
          )}
        </div>
        <span className="text-muted text-xs">{open ? '▲' : '▼'}</span>
      </header>
      {open && (
        <>
          <div className="border-t border-border-warm grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border-warm">
            <FounderForm
              founder={founder}
              onChange={setFounder}
              onToggleTag={toggleFounderTag}
            />
            <FactionForm
              faction={faction}
              onChange={setFaction}
              onToggleTag={toggleFactionTag}
            />
          </div>
          <div className="px-4 py-3 border-t border-border-warm space-y-2">
            {!cityId && (
              <div className="text-blood text-xs">No city in this world.</div>
            )}
            {!sharesValid && (
              <div className="text-blood text-xs">
                Prize shares must sum to ≤ 1.0 (currently {sharesSum.toFixed(2)}).
              </div>
            )}
            {create.error && (
              <div className="text-blood text-xs">{create.error.message}</div>
            )}
            {lastSummary && !create.isPending && !create.error && (
              <div className="text-gold-dim text-xs">{lastSummary}</div>
            )}
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="w-full px-3 py-2 rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >
              {create.isPending ? 'Summoning…' : 'Summon founder + faction'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ─── Founder sub-form ─────────────────────────────────────────────────────

function FounderForm({
  founder,
  onChange,
  onToggleTag,
}: {
  founder: FounderDraft;
  onChange: (f: FounderDraft) => void;
  onToggleTag: (t: PersonalityTag) => void;
}) {
  return (
    <div className="px-4 py-3 space-y-3 text-sm">
      <SectionHeading>Founder soul</SectionHeading>
      <FieldRow label="Name">
        <input
          value={founder.name}
          onChange={(e) => onChange({ ...founder, name: e.target.value })}
          placeholder="(auto if blank)"
          maxLength={80}
          className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
        />
      </FieldRow>
      <FieldRow label="Type">
        <select
          value={founder.type}
          onChange={(e) =>
            onChange({ ...founder, type: e.target.value as PersonType })
          }
          className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
        >
          {PERSON_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow label="Gender">
        <div className="flex gap-2">
          {(['male', 'female'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => onChange({ ...founder, gender: g })}
              className={
                'flex-1 px-2 py-1 text-xs uppercase tracking-wider rounded border transition ' +
                (founder.gender === g
                  ? 'bg-emerald-700 text-white border-emerald-600'
                  : 'text-muted border-border-warm hover:text-gold-bright')
              }
            >
              {g}
            </button>
          ))}
        </div>
      </FieldRow>
      <Slider
        label="Age"
        value={founder.age}
        min={16}
        max={90}
        onChange={(v) => onChange({ ...founder, age: v })}
        suffix="y"
      />
      <Slider
        label="Intelligence"
        value={founder.intelligence}
        min={0}
        max={100}
        onChange={(v) => onChange({ ...founder, intelligence: v })}
      />
      <Slider
        label="Combat"
        value={founder.combat}
        min={0}
        max={100}
        onChange={(v) => onChange({ ...founder, combat: v })}
      />
      <Slider
        label="Happiness"
        value={founder.happiness}
        min={0}
        max={100}
        onChange={(v) => onChange({ ...founder, happiness: v })}
      />
      <FieldRow label="Wealth">
        <input
          type="number"
          min={0}
          max={1_000_000}
          value={founder.wealth}
          onChange={(e) =>
            onChange({
              ...founder,
              wealth: Math.max(0, Number.parseInt(e.target.value, 10) || 0),
            })
          }
          className="w-full bg-surface border border-border-warm rounded px-2 py-1 font-mono focus:outline-none focus:border-gold-dim"
        />
      </FieldRow>
      <FieldRow label="Tags" align="start">
        <div className="flex flex-wrap gap-1.5">
          {PERSONALITY_TAGS.map((t) => {
            const on = founder.personality_tags.includes(t);
            const locked = t === 'ambitious';
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTag(t)}
                disabled={locked}
                title={locked ? 'ambitious is required for faction founders' : undefined}
                className={
                  'px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border transition ' +
                  (on
                    ? 'bg-emerald-700 text-white border-emerald-600'
                    : 'text-muted border-border-warm hover:text-amber-300 hover:border-amber-400') +
                  (locked ? ' cursor-not-allowed opacity-90' : '')
                }
              >
                {t}
                {locked && ' ✓'}
              </button>
            );
          })}
        </div>
      </FieldRow>
    </div>
  );
}

// ─── Faction sub-form ─────────────────────────────────────────────────────

function FactionForm({
  faction,
  onChange,
  onToggleTag,
}: {
  faction: FactionDraft;
  onChange: (r: FactionDraft) => void;
  onToggleTag: (t: PersonalityTag) => void;
}) {
  const setFloor = (
    k: keyof FactionDraft['stat_floors'],
    v: number | null,
  ) => {
    onChange({
      ...faction,
      stat_floors: { ...faction.stat_floors, [k]: v },
    });
  };

  const setAffinity = (t: PersonType, v: number) => {
    const next = { ...faction.type_affinities };
    if (v <= 0) {
      delete next[t];
    } else {
      next[t] = v;
    }
    onChange({ ...faction, type_affinities: next });
  };

  const setShare = (idx: number, v: number) => {
    const next = [...faction.prize_shares];
    next[idx] = v;
    onChange({ ...faction, prize_shares: next });
  };

  const addShare = () => {
    if (faction.prize_shares.length >= 5) return;
    onChange({
      ...faction,
      prize_shares: [...faction.prize_shares, 0.1],
    });
  };
  const removeShare = (idx: number) => {
    onChange({
      ...faction,
      prize_shares: faction.prize_shares.filter((_, i) => i !== idx),
    });
  };

  const sharesSum = faction.prize_shares.reduce((s, x) => s + x, 0);

  return (
    <div className="px-4 py-3 space-y-3 text-sm">
      <SectionHeading>Faction charter</SectionHeading>
      <FieldRow label="Name">
        <div className="flex gap-1.5">
          <input
            value={faction.name}
            onChange={(e) => onChange({ ...faction, name: e.target.value })}
            placeholder="The Iron Legion"
            maxLength={120}
            className="flex-1 min-w-0 bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          />
          <button
            type="button"
            onClick={() => onChange({ ...faction, name: generateFactionName() })}
            title="Generate a random name"
            className="px-2 py-1 text-xs rounded border border-border-warm text-muted hover:text-gold-bright hover:border-gold-dim transition shrink-0"
          >
            ✦
          </button>
        </div>
      </FieldRow>
      <FieldRow label="Wanted tags" align="start">
        <div className="flex flex-wrap gap-1.5">
          {PERSONALITY_TAGS.map((t) => {
            const on = faction.wanted_tags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTag(t)}
                className={
                  'px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border transition ' +
                  (on
                    ? 'bg-emerald-700 text-white border-emerald-600'
                    : 'text-muted border-border-warm hover:text-amber-300 hover:border-amber-400')
                }
              >
                {t}
              </button>
            );
          })}
        </div>
      </FieldRow>
      <div className="text-muted text-xs">
        {faction.wanted_tags.length} of 8 tags ·{' '}
        {faction.wanted_tags.join(', ') || 'select at least one'}
      </div>

      <SectionHeading>Dues & competition</SectionHeading>
      <FieldRow label="Dues / yr">
        <input
          type="number"
          min={0}
          max={100_000}
          value={faction.cost_per_year}
          onChange={(e) =>
            onChange({
              ...faction,
              cost_per_year: Math.max(
                0,
                Math.min(100_000, Number.parseInt(e.target.value, 10) || 0),
              ),
            })
          }
          className="w-full bg-surface border border-border-warm rounded px-2 py-1 font-mono focus:outline-none focus:border-gold-dim"
        />
      </FieldRow>
      <div>
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>Leader cut</span>
          <span className="font-mono text-gold tabular-nums">
            {(faction.leader_dues_cut * 100).toFixed(1)}% of treasury
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={Math.round(faction.leader_dues_cut * 100)}
          onChange={(e) =>
            onChange({
              ...faction,
              leader_dues_cut: Number.parseInt(e.target.value, 10) / 100,
            })
          }
          className="w-full accent-gold-dim mt-1"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>Prize shares (top {faction.prize_shares.length})</span>
          <span className="font-mono text-gold tabular-nums">
            sum {sharesSum.toFixed(2)} / 1.00
          </span>
        </div>
        {faction.prize_shares.map((v, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted w-10">
              #{idx + 1}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(v * 100)}
              onChange={(e) =>
                setShare(idx, Number.parseInt(e.target.value, 10) / 100)
              }
              className="flex-1 accent-gold-dim"
            />
            <span className="font-mono text-gold tabular-nums text-xs w-12 text-right">
              {(v * 100).toFixed(0)}%
            </span>
            <button
              type="button"
              onClick={() => removeShare(idx)}
              className="text-[10px] uppercase tracking-widest text-muted hover:text-blood"
            >
              ×
            </button>
          </div>
        ))}
        {faction.prize_shares.length < 5 && (
          <button
            type="button"
            onClick={addShare}
            className="text-[10px] uppercase tracking-widest text-muted hover:text-amber-300"
          >
            + add rank
          </button>
        )}
      </div>

      <div>
        <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={faction.intelligence_target != null}
              onChange={(e) =>
                onChange({
                  ...faction,
                  intelligence_target: e.target.checked ? 70 : null,
                })
              }
            />
            <span>Intelligence target</span>
          </label>
          <span className="font-mono text-gold tabular-nums">
            {faction.intelligence_target ?? '—'}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          disabled={faction.intelligence_target == null}
          value={faction.intelligence_target ?? 0}
          onChange={(e) =>
            onChange({
              ...faction,
              intelligence_target: Number.parseInt(e.target.value, 10),
            })
          }
          className="w-full accent-gold-dim mt-1 disabled:opacity-40"
        />
      </div>

      <SectionHeading>Stat floors</SectionHeading>
      <div className="space-y-1.5">
        <FactionFloorRow
          label="intelligence_min"
          value={faction.stat_floors.intelligence_min}
          max={100}
          onChange={(v) => setFloor('intelligence_min', v)}
        />
        <FactionFloorRow
          label="combat_min"
          value={faction.stat_floors.combat_min}
          max={100}
          onChange={(v) => setFloor('combat_min', v)}
        />
        <FactionFloorRow
          label="wealth_min"
          value={faction.stat_floors.wealth_min}
          max={1_000_000}
          onChange={(v) => setFloor('wealth_min', v)}
        />
        <FactionFloorRow
          label="age_min"
          value={faction.stat_floors.age_min}
          max={120}
          onChange={(v) => setFloor('age_min', v)}
        />
      </div>

      <SectionHeading>Type affinities</SectionHeading>
      <div className="space-y-1.5">
        {PERSON_TYPES.map((t) => {
          const cur = faction.type_affinities[t] ?? 0;
          return (
            <div key={t} className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-muted w-20">
                {t}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(cur * 10)}
                onChange={(e) =>
                  setAffinity(t, Number.parseInt(e.target.value, 10) / 10)
                }
                className="flex-1 accent-gold-dim"
              />
              <span className="font-mono text-gold tabular-nums text-xs w-10 text-right">
                {cur.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function FactionFloorRow({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
}) {
  const enabled = value != null;
  return (
    <div className="flex items-center gap-2">
      <label className="flex items-center gap-2 text-xs text-muted w-32">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onChange(e.target.checked ? 0 : null)}
        />
        <span className="font-mono">{label}</span>
      </label>
      <input
        type="number"
        min={0}
        max={max}
        disabled={!enabled}
        value={value ?? 0}
        onChange={(e) =>
          onChange(
            Math.max(0, Math.min(max, Number.parseInt(e.target.value, 10) || 0)),
          )
        }
        className="flex-1 bg-surface border border-border-warm rounded px-2 py-1 font-mono text-xs focus:outline-none focus:border-gold-dim disabled:opacity-40"
      />
    </div>
  );
}

// ─── Form primitives ──────────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-display text-gold uppercase tracking-widest text-xs border-b border-border-warm pb-2">
      {children}
    </div>
  );
}

function FieldRow({
  label,
  align = 'center',
  children,
}: {
  label: string;
  align?: 'center' | 'start';
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        'grid grid-cols-[6rem_1fr] gap-3 ' +
        (align === 'start' ? 'items-start' : 'items-center')
      }
    >
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  suffix?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted">
        <span>{label}</span>
        <span className="font-mono text-gold tabular-nums">
          {value}
          {suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
        className="w-full accent-gold-dim mt-1"
      />
    </div>
  );
}

// ─── Faction name generator ───────────────────────────────────────────────

const GEN_STRUCTURE = [
  'The {adj} {noun}',
  'The {noun} of {adj} {subject}',
  'The {noun} of the {adj} {subject}',
  '{noun} of {subject}',
  'The {adj} {noun} of {subject}',
];

const GEN_ADJ_F = [
  'Iron', 'Crimson', 'Golden', 'Ashen', 'Silent', 'Hollow', 'Broken',
  'Sovereign', 'Forsaken', 'Undying', 'Veiled', 'Hidden', 'Eternal',
  'Pale', 'Burning', 'Scarred', 'Exalted', 'Risen', 'Fallen', 'Bound',
  'Bloodied', 'Shattered', 'Relentless', 'Sunken', 'Ancient', 'Ruthless',
];

const GEN_NOUN_F = [
  'Legion', 'Order', 'Compact', 'Brotherhood', 'Circle', 'Vanguard',
  'Covenant', 'Syndicate', 'Council', 'Hand', 'Pact', 'Court', 'House',
  'Guild', 'Tribunal', 'Band', 'Conclave', 'Alliance', 'Union', 'Blade',
];

const GEN_SUBJECT_F = [
  'Wolves', 'Ravens', 'Crows', 'Serpents', 'Hawks', 'Bears', 'Lions',
  'Thorns', 'Ash', 'Stone', 'Blood', 'Steel', 'Fire', 'Shadow', 'Bone',
  'Dust', 'Salt', 'Rust', 'Thunder', 'Iron', 'Smoke', 'Ruin', 'Night',
  'Dawn', 'Dusk', 'Teeth', 'Nails', 'Chains', 'Crowns', 'Scars',
];

function pickF<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFactionName(): string {
  const template = pickF(GEN_STRUCTURE);
  return template
    .replace('{adj}', pickF(GEN_ADJ_F))
    .replace('{noun}', pickF(GEN_NOUN_F))
    .replace('{subject}', pickF(GEN_SUBJECT_F));
}

// ─── Mutations ────────────────────────────────────────────────────────────

interface SummonFactionBody {
  world_id: string;
  city_id: string;
  founder: {
    type: PersonType;
    name?: string;
    gender?: 'male' | 'female';
    age?: number;
    intelligence?: number;
    combat?: number;
    happiness?: number;
    wealth?: number;
    personality_tags?: PersonalityTag[];
  };
  faction: {
    name: string;
    wanted_tags: PersonalityTag[];
    cost_per_year?: number;
    leader_dues_cut?: number;
    prize_shares?: number[];
    competition_metric?: string;
    intelligence_target?: number;
    stat_floors?: Record<string, number>;
    type_affinities?: Partial<Record<PersonType, number>>;
  };
}

interface SummonFactionResult {
  group: GroupRow;
  founder: { id: string; name: string };
}

function useSummonFaction(worldId: string) {
  const qc = useQueryClient();
  return useMutation<SummonFactionResult, Error, SummonFactionBody>({
    mutationFn: (body) =>
      api('/api/groups/summon-faction', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['factions', worldId] });
    },
  });
}

function useDissolveFaction(worldId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { id: string; year: number }>({
    mutationFn: ({ id, year }) =>
      api(`/api/groups/${id}/dissolve`, {
        method: 'POST',
        body: JSON.stringify({ year }),
      }),
    onSuccess: (_data, { id }) => {
      qc.invalidateQueries({ queryKey: ['factions', worldId] });
      qc.invalidateQueries({ queryKey: ['group', id] });
    },
  });
}
