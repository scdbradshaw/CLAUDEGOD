// Reusable person picker (god-mode).
//
// Two-pane: filter panel (left) + results table (right). Used by:
//   - PersonPickerModal for inline selection (replaces "paste UUID" inputs)
//   - /world/:worldId/people for full-page browsing
//
// Single-select today. Multi-select can extend `selection` to a Set later.

import { useEffect, useMemo, useState } from 'react';
import {
  PERSONALITY_TAGS,
  PERSON_TYPES,
  RACES,
  type PersonalityTag,
  type PersonType,
} from '@claude-god/shared';
import {
  usePersonSearch,
  useCitiesMini,
  useGroupsMini,
  type GroupFilterValue,
  type PersonSearchFilter,
  type PersonSearchRow,
} from '../hooks/usePersonSearch';

const GENDERS = ['male', 'female', 'nonbinary'] as const;
type Gender = (typeof GENDERS)[number];

type SortBy = NonNullable<PersonSearchFilter['sort_by']>;
type SortDir = NonNullable<PersonSearchFilter['sort_dir']>;

export interface PersonPickerProps {
  worldId: string;
  /** Called when the user clicks a row. If omitted, the picker is read-only. */
  onSelect?: (row: PersonSearchRow) => void;
  /** Disable the picked row visually (e.g., the current leader). */
  selectedId?: string | null;
  /** Show the action button label per row. */
  selectLabel?: string;
}

interface DraftFilter {
  q: string;
  race: Set<string>;
  gender: Set<Gender>;
  city_ids: Set<string>;
  types: Set<PersonType>;
  faction_ids: Set<GroupFilterValue>;
  religion_ids: Set<GroupFilterValue>;
  personality_tags: Set<PersonalityTag>;
  personality_mode: 'any' | 'all';
  alive: 'alive' | 'dead' | 'either';
  pinned: 'any' | 'pinned' | 'unpinned';
  age_min: number | null;
  age_max: number | null;
  wealth_min: number | null;
  wealth_max: number | null;
  intelligence_min: number | null;
  intelligence_max: number | null;
  combat_min: number | null;
  combat_max: number | null;
  happiness_min: number | null;
  happiness_max: number | null;
  health_min: number | null;
  health_max: number | null;
  sort_by: SortBy;
  sort_dir: SortDir;
}

function emptyDraft(): DraftFilter {
  return {
    q: '',
    race: new Set(),
    gender: new Set(),
    city_ids: new Set(),
    types: new Set(),
    faction_ids: new Set(),
    religion_ids: new Set(),
    personality_tags: new Set(),
    personality_mode: 'any',
    alive: 'alive', // default per design spec
    pinned: 'any',
    age_min: null,
    age_max: null,
    wealth_min: null,
    wealth_max: null,
    intelligence_min: null,
    intelligence_max: null,
    combat_min: null,
    combat_max: null,
    happiness_min: null,
    happiness_max: null,
    health_min: null,
    health_max: null,
    sort_by: 'name',
    sort_dir: 'asc',
  };
}

const PAGE_SIZE = 50;

export function PersonPicker({
  worldId,
  onSelect,
  selectedId,
  selectLabel = 'Select',
}: PersonPickerProps) {
  const [draft, setDraft] = useState<DraftFilter>(() => emptyDraft());
  const [debounced, setDebounced] = useState<DraftFilter>(() => emptyDraft());
  const [page, setPage] = useState(0);

  // Debounce filter changes by 250ms so sliders/typing don't slam the API.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(draft);
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [draft]);

  const filter = useMemo<PersonSearchFilter>(
    () => buildFilter(worldId, debounced, page),
    [worldId, debounced, page],
  );

  const search = usePersonSearch(filter);
  const cities = useCitiesMini(worldId);
  const factions = useGroupsMini(worldId, 'faction', true);
  const religions = useGroupsMini(worldId, 'religion', true);

  const total = search.data?.total ?? 0;
  const rows = search.data?.rows ?? [];
  const pageMax = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[18rem_1fr] gap-0 h-full">
      {/* ─── Filter panel ─── */}
      <aside className="border-r border-border-warm overflow-y-auto p-4 space-y-4 text-sm">
        <FilterGroup title="Identity">
          <input
            value={draft.q}
            onChange={(e) => setDraft({ ...draft, q: e.target.value })}
            placeholder="Name…"
            className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
          />
          <ChipMulti<string>
            label="Race"
            options={RACES as readonly string[]}
            selected={draft.race}
            onToggle={(v) => setDraft({ ...draft, race: toggle(draft.race, v) })}
          />
          <ChipMulti<Gender>
            label="Gender"
            options={GENDERS}
            selected={draft.gender}
            onToggle={(v) => setDraft({ ...draft, gender: toggle(draft.gender, v) })}
          />
        </FilterGroup>

        <FilterGroup title="Status">
          <RadioRow
            label="Alive"
            value={draft.alive}
            options={[
              { v: 'alive', label: 'Alive' },
              { v: 'dead', label: 'Dead' },
              { v: 'either', label: 'Either' },
            ]}
            onChange={(v) => setDraft({ ...draft, alive: v as DraftFilter['alive'] })}
          />
          <RadioRow
            label="Pinned"
            value={draft.pinned}
            options={[
              { v: 'any', label: 'Any' },
              { v: 'pinned', label: 'Pinned' },
              { v: 'unpinned', label: 'Unpinned' },
            ]}
            onChange={(v) => setDraft({ ...draft, pinned: v as DraftFilter['pinned'] })}
          />
        </FilterGroup>

        <FilterGroup title="Location">
          <ChipMulti<string>
            label="City"
            options={(cities.data?.cities ?? []).map((c) => c.id)}
            labelFor={(id) =>
              cities.data?.cities.find((c) => c.id === id)?.name ?? id.slice(0, 8)
            }
            selected={draft.city_ids}
            onToggle={(v) => setDraft({ ...draft, city_ids: toggle(draft.city_ids, v) })}
          />
        </FilterGroup>

        <FilterGroup title="Profession">
          <ChipMulti<PersonType>
            label="Type"
            options={PERSON_TYPES}
            selected={draft.types}
            onToggle={(v) => setDraft({ ...draft, types: toggle(draft.types, v) })}
          />
        </FilterGroup>

        <FilterGroup title="Allegiance">
          <ChipMulti<GroupFilterValue>
            label="Faction"
            options={[
              'none',
              ...((factions.data?.groups ?? []).map((g) => g.id)),
            ]}
            labelFor={(v) =>
              v === 'none'
                ? '— none —'
                : factions.data?.groups.find((g) => g.id === v)?.name ??
                  v.slice(0, 8)
            }
            selected={draft.faction_ids}
            onToggle={(v) =>
              setDraft({ ...draft, faction_ids: toggle(draft.faction_ids, v) })
            }
          />
          <ChipMulti<GroupFilterValue>
            label="Religion"
            options={[
              'none',
              ...((religions.data?.groups ?? []).map((g) => g.id)),
            ]}
            labelFor={(v) =>
              v === 'none'
                ? '— none —'
                : religions.data?.groups.find((g) => g.id === v)?.name ??
                  v.slice(0, 8)
            }
            selected={draft.religion_ids}
            onToggle={(v) =>
              setDraft({ ...draft, religion_ids: toggle(draft.religion_ids, v) })
            }
          />
        </FilterGroup>

        <FilterGroup title="Personality">
          <ChipMulti<PersonalityTag>
            label="Tags"
            options={PERSONALITY_TAGS}
            selected={draft.personality_tags}
            onToggle={(v) =>
              setDraft({
                ...draft,
                personality_tags: toggle(draft.personality_tags, v),
              })
            }
          />
          <RadioRow
            label="Match"
            value={draft.personality_mode}
            options={[
              { v: 'any', label: 'Any of' },
              { v: 'all', label: 'All of' },
            ]}
            onChange={(v) =>
              setDraft({ ...draft, personality_mode: v as 'any' | 'all' })
            }
          />
        </FilterGroup>

        <FilterGroup title="Stats">
          <RangeRow
            label="Age"
            min={0}
            max={120}
            from={draft.age_min}
            to={draft.age_max}
            onChange={(a, b) => setDraft({ ...draft, age_min: a, age_max: b })}
          />
          <RangeRow
            label="Wealth"
            min={0}
            max={1_000_000}
            step={100}
            from={draft.wealth_min}
            to={draft.wealth_max}
            onChange={(a, b) =>
              setDraft({ ...draft, wealth_min: a, wealth_max: b })
            }
          />
          <RangeRow
            label="Int"
            min={0}
            max={100}
            from={draft.intelligence_min}
            to={draft.intelligence_max}
            onChange={(a, b) =>
              setDraft({ ...draft, intelligence_min: a, intelligence_max: b })
            }
          />
          <RangeRow
            label="Combat"
            min={0}
            max={100}
            from={draft.combat_min}
            to={draft.combat_max}
            onChange={(a, b) =>
              setDraft({ ...draft, combat_min: a, combat_max: b })
            }
          />
          <RangeRow
            label="Happy"
            min={0}
            max={100}
            from={draft.happiness_min}
            to={draft.happiness_max}
            onChange={(a, b) =>
              setDraft({ ...draft, happiness_min: a, happiness_max: b })
            }
          />
          <RangeRow
            label="Health"
            min={0}
            max={100}
            from={draft.health_min}
            to={draft.health_max}
            onChange={(a, b) =>
              setDraft({ ...draft, health_min: a, health_max: b })
            }
          />
        </FilterGroup>

        <button
          onClick={() => setDraft(emptyDraft())}
          className="w-full py-1.5 rounded border border-amber-400/50 text-amber-300/70 text-xs uppercase tracking-widest hover:text-amber-300 hover:border-amber-400"
        >
          Clear all filters
        </button>
      </aside>

      {/* ─── Results ─── */}
      <section className="overflow-y-auto">
        <header className="sticky top-0 z-10 bg-panel-warm border-b border-border-warm px-4 py-2 flex flex-wrap items-center justify-between gap-3">
          <div className="text-muted text-xs uppercase tracking-widest">
            {search.isLoading
              ? 'Searching…'
              : `${rows.length.toLocaleString()} of ${total.toLocaleString()} souls`}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="text-muted uppercase tracking-wider">Sort</label>
            <select
              value={draft.sort_by}
              onChange={(e) =>
                setDraft({ ...draft, sort_by: e.target.value as SortBy })
              }
              className="bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
            >
              <option value="name">Name</option>
              <option value="age">Age</option>
              <option value="wealth">Wealth</option>
              <option value="intelligence">Intelligence</option>
              <option value="combat">Combat</option>
              <option value="happiness">Happiness</option>
              <option value="created_year">Birth year</option>
            </select>
            <button
              onClick={() =>
                setDraft({
                  ...draft,
                  sort_dir: draft.sort_dir === 'asc' ? 'desc' : 'asc',
                })
              }
              className="px-2 py-1 border border-border-warm rounded text-gold-bright hover:bg-panel"
              title={draft.sort_dir === 'asc' ? 'Ascending' : 'Descending'}
            >
              {draft.sort_dir === 'asc' ? '↑' : '↓'}
            </button>
          </div>
        </header>

        {search.error && (
          <div className="px-4 py-3 text-blood text-sm">
            Search failed: {(search.error as Error).message}
          </div>
        )}

        {!search.isLoading && rows.length === 0 ? (
          <div className="px-4 py-12 text-muted text-center text-sm italic">
            No souls match. Loosen a filter.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted sticky top-[2.6rem] bg-panel-warm">
              <tr className="border-b border-border-warm">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-2 py-2">Type</th>
                <th className="text-right px-2 py-2">Age</th>
                <th className="text-left px-2 py-2">City</th>
                <th className="text-left px-2 py-2">Religion</th>
                <th className="text-left px-2 py-2">Faction</th>
                <th className="text-right px-2 py-2">Int</th>
                <th className="text-right px-2 py-2">Cmb</th>
                <th className="text-right px-2 py-2">Wealth</th>
                <th className="text-left px-2 py-2">Tags</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <PickerRow
                  key={r.id}
                  row={r}
                  onSelect={onSelect}
                  selectedId={selectedId ?? null}
                  selectLabel={selectLabel}
                />
              ))}
            </tbody>
          </table>
        )}

        {pageMax > 0 && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs">
            <button
              disabled={page === 0}
              onClick={() => setPage(0)}
              className="px-2 py-1 border border-amber-400/50 rounded text-amber-300/70 hover:text-amber-300 hover:border-amber-400 disabled:opacity-30"
            >
              «
            </button>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="px-2 py-1 border border-amber-400/50 rounded text-amber-300/70 hover:text-amber-300 hover:border-amber-400 disabled:opacity-30"
            >
              ‹ Prev
            </button>
            <span className="text-muted tabular-nums">
              page {page + 1} / {pageMax + 1}
            </span>
            <button
              disabled={page >= pageMax}
              onClick={() => setPage((p) => Math.min(pageMax, p + 1))}
              className="px-2 py-1 border border-amber-400/50 rounded text-amber-300/70 hover:text-amber-300 hover:border-amber-400 disabled:opacity-30"
            >
              Next ›
            </button>
            <button
              disabled={page >= pageMax}
              onClick={() => setPage(pageMax)}
              className="px-2 py-1 border border-amber-400/50 rounded text-amber-300/70 hover:text-amber-300 hover:border-amber-400 disabled:opacity-30"
            >
              »
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────

function PickerRow({
  row,
  onSelect,
  selectedId,
  selectLabel,
}: {
  row: PersonSearchRow;
  onSelect?: (r: PersonSearchRow) => void;
  selectedId: string | null;
  selectLabel: string;
}) {
  const isSelected = selectedId === row.id;
  return (
    <tr
      className={
        'border-b border-border-warm/40 ' +
        (isSelected ? 'bg-panel/60' : 'hover:bg-panel/40')
      }
    >
      <td className="px-4 py-2">
        <span className="text-gold-bright">{row.name}</span>
        {row.is_pinned && (
          <span className="ml-2 text-[10px] uppercase tracking-widest text-muted">
            pin
          </span>
        )}
        {!row.is_alive && (
          <span className="ml-2 text-[10px] uppercase tracking-widest text-blood">
            ✝ {row.death_year ?? '?'}
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-muted text-xs">{row.type}</td>
      <td className="px-2 py-2 text-right tabular-nums">{row.age}</td>
      <td className="px-2 py-2 text-muted text-xs truncate max-w-[8rem]">
        {row.city_name ?? '—'}
      </td>
      <td className="px-2 py-2 text-muted text-xs truncate max-w-[10rem]">
        {row.religion_name ?? '—'}
      </td>
      <td className="px-2 py-2 text-muted text-xs truncate max-w-[10rem]">
        {row.faction_name ?? '—'}
      </td>
      <td className="px-2 py-2 text-right tabular-nums">{row.intelligence}</td>
      <td className="px-2 py-2 text-right tabular-nums">{row.combat}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {row.wealth.toLocaleString()}
      </td>
      <td className="px-2 py-2">
        <div className="flex flex-wrap gap-0.5">
          {row.personality_tags.map((t) => (
            <span
              key={t}
              className="text-[9px] uppercase tracking-wider px-1 py-0.5 border border-border-warm rounded text-gold"
            >
              {t}
            </span>
          ))}
        </div>
      </td>
      <td className="px-2 py-2 text-right">
        {onSelect ? (
          <button
            onClick={() => onSelect(row)}
            disabled={isSelected}
            className="px-2 py-0.5 text-[10px] uppercase tracking-widest rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
          >
            {isSelected ? 'Selected' : selectLabel}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────────

function FilterGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase tracking-widest text-gold border-b border-border-warm pb-1">
        {title}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ChipMulti<T extends string>({
  label,
  options,
  selected,
  onToggle,
  labelFor,
}: {
  label?: string;
  options: readonly T[];
  selected: Set<T>;
  onToggle: (v: T) => void;
  labelFor?: (v: T) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div>
      {label && (
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
          {label}
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {options.map((v) => {
          const on = selected.has(v);
          return (
            <button
              key={v}
              type="button"
              onClick={() => onToggle(v)}
              className={
                'px-2 py-0.5 text-[10px] uppercase tracking-wider rounded border transition ' +
                (on
                  ? 'bg-emerald-700 text-white border-emerald-600'
                  : 'text-muted border-border-warm hover:text-amber-300 hover:border-amber-400')
              }
            >
              {labelFor ? labelFor(v) : v}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function RadioRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { v: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted mb-1">
        {label}
      </div>
      <div className="flex gap-1">
        {options.map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={
              'flex-1 px-2 py-1 text-[10px] uppercase tracking-wider rounded border transition ' +
              (value === o.v
                ? 'bg-emerald-700 text-white border-emerald-600'
                : 'text-muted border-border-warm hover:text-amber-300 hover:border-amber-400')
            }
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RangeRow({
  label,
  min,
  max,
  step = 1,
  from,
  to,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step?: number;
  from: number | null;
  to: number | null;
  onChange: (from: number | null, to: number | null) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted w-14">
        {label}
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder="min"
        value={from ?? ''}
        onChange={(e) =>
          onChange(
            e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
            to,
          )
        }
        className="flex-1 min-w-0 bg-surface border border-border-warm rounded px-1 py-0.5 font-mono text-xs focus:outline-none focus:border-gold-dim"
      />
      <span className="text-muted">–</span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        placeholder="max"
        value={to ?? ''}
        onChange={(e) =>
          onChange(
            from,
            e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
          )
        }
        className="flex-1 min-w-0 bg-surface border border-border-warm rounded px-1 py-0.5 font-mono text-xs focus:outline-none focus:border-gold-dim"
      />
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function buildFilter(
  worldId: string,
  d: DraftFilter,
  page: number,
): PersonSearchFilter {
  const f: PersonSearchFilter = {
    world_id: worldId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    sort_by: d.sort_by,
    sort_dir: d.sort_dir,
  };
  if (d.q.trim()) f.q = d.q.trim();
  if (d.race.size > 0) f.race = [...d.race];
  if (d.gender.size > 0) f.gender = [...d.gender];
  if (d.city_ids.size > 0) f.city_ids = [...d.city_ids];
  if (d.types.size > 0) f.types = [...d.types];
  if (d.faction_ids.size > 0) f.faction_ids = [...d.faction_ids];
  if (d.religion_ids.size > 0) f.religion_ids = [...d.religion_ids];
  if (d.personality_tags.size > 0) {
    f.personality_tags = [...d.personality_tags];
    f.personality_mode = d.personality_mode;
  }
  if (d.alive === 'alive') f.is_alive = true;
  else if (d.alive === 'dead') f.is_alive = false;
  if (d.pinned === 'pinned') f.is_pinned = true;
  else if (d.pinned === 'unpinned') f.is_pinned = false;
  if (d.age_min != null) f.age_min = d.age_min;
  if (d.age_max != null) f.age_max = d.age_max;
  if (d.wealth_min != null) f.wealth_min = d.wealth_min;
  if (d.wealth_max != null) f.wealth_max = d.wealth_max;
  if (d.intelligence_min != null) f.intelligence_min = d.intelligence_min;
  if (d.intelligence_max != null) f.intelligence_max = d.intelligence_max;
  if (d.combat_min != null) f.combat_min = d.combat_min;
  if (d.combat_max != null) f.combat_max = d.combat_max;
  if (d.happiness_min != null) f.happiness_min = d.happiness_min;
  if (d.happiness_max != null) f.happiness_max = d.happiness_max;
  if (d.health_min != null) f.health_min = d.health_min;
  if (d.health_max != null) f.health_max = d.health_max;
  return f;
}
