// Group detail (Phase 11f). Faction or religion.
// God-mode editing: toggle edit mode to revise name, doctrine, dues, etc.

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PersonPickerModal } from '../components/PersonPickerModal';
import {
  PERSONALITY_TAGS,
  PERSON_TYPES,
  type PersonalityTag,
  type PersonType,
} from '@claude-god/shared';
import {
  useGroup,
  useDissolveGroup,
  useUpdateGroup,
  useGroupMembers,
  useKickMember,
  useConvertMember,
  type FactionAwardEntry,
  type GroupDetail as GroupDetailData,
  type GroupRow,
  type MemberRow,
  type UpdateGroupBody,
} from '../hooks/useGroup';
import { useWorld } from '../hooks/useWorld';

export function GroupDetail() {
  const { groupId, worldId } = useParams<{ groupId: string; worldId: string }>();
  const q = useGroup(groupId);
  const worldQ = useWorld(worldId);
  const dissolve = useDissolveGroup(groupId);
  const [editing, setEditing] = useState(false);

  if (q.isLoading) return <Centered>Loading group…</Centered>;
  if (q.error) return <Centered tone="bad">Failed to load group.</Centered>;
  if (!q.data) return <Centered>Group not found.</Centered>;

  const detail = q.data;
  const { group, member_count_real } = detail;
  const currentYear = worldQ.data?.world.current_year ?? 0;
  const atWar = group.kind === 'faction' && group.at_war_with.length > 0;
  const yearsSinceSchism =
    group.last_schism_year == null ? Infinity : currentYear - group.last_schism_year;
  const schismRisk =
    group.is_active && group.member_count_cached >= 100 && yearsSinceSchism >= 10;

  return (
    <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-6">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="font-display text-3xl text-gold-bright">{group.name}</h1>
          <p className="text-muted text-xs uppercase tracking-widest mt-1">
            {group.kind} · founded year {group.founded_year}
            {!group.is_active && (
              <span className="text-blood">
                {' '}
                · DISSOLVED yr {group.dissolved_year ?? '?'}
              </span>
            )}
          </p>
          <div className="flex gap-2 mt-2">
            {atWar && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-blood text-blood bg-blood/10">
                At war
              </span>
            )}
            {schismRisk && (
              <span className="text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border border-amber-500 text-amber-300 bg-amber-500/10">
                Schism risk
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {group.is_active && (
            <button
              className={
                'px-3 py-1.5 rounded border text-sm transition ' +
                (editing
                  ? 'border-amber-400 text-amber-300 bg-amber-400/10'
                  : 'border-border-warm text-muted hover:text-amber-300 hover:border-amber-400')
              }
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'Done' : 'Edit'}
            </button>
          )}
          {group.is_active && (
            <button
              className="px-3 py-1.5 rounded bg-red-700 hover:bg-red-600 text-white text-sm"
              onClick={() => {
                if (confirm(`Dissolve "${group.name}" at year ${currentYear}?`)) {
                  dissolve.mutate(currentYear);
                }
              }}
              disabled={dissolve.isPending}
            >
              {dissolve.isPending ? 'Dissolving…' : 'Dissolve'}
            </button>
          )}
        </div>
      </header>

      {dissolve.error && (
        <div className="text-blood text-sm">{dissolve.error.message}</div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Members (real)" value={member_count_real.toLocaleString()} />
        <Stat label="Members (total)" value={group.member_count_cached.toLocaleString()} />
        <Stat label="Treasury" value={group.treasury.toLocaleString()} />
        <Stat
          label="Dues/year"
          value={
            group.kind === 'religion'
              ? `${((group.cost_pct_of_wealth ?? 0) * 100).toFixed(1)}% of wealth`
              : group.cost_per_year.toLocaleString()
          }
        />
        {group.kind === 'faction' && (
          <>
            <Stat label="Tax rate" value={group.tax_rate != null ? `${group.tax_rate}%` : '—'} />
            <Stat label="Army" value={group.army_size.toLocaleString()} />
            <Stat label="Territories" value={`${group.territory_cities.length}`} />
            <Stat label="At war" value={`${group.at_war_with.length}`} />
          </>
        )}
      </div>

      {group.member_count_history.length > 1 && (
        <MembershipChart history={group.member_count_history} />
      )}

      {editing ? (
        <EditPanel
          detail={detail}
          worldId={worldId!}
          onDone={() => setEditing(false)}
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DetailPanel detail={detail} worldId={worldId!} />
          <AffinitiesPanel group={group} />
        </div>
      )}

      {group.is_active && (
        <MembersPanel group={group} worldId={worldId!} />
      )}

      {group.kind === 'faction' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <LatestAwardsPanel group={group} worldId={worldId!} />
          <HallOfFamePanel group={group} worldId={worldId!} />
        </div>
      )}
    </div>
  );
}

// ─── Faction awards panels (Phase 6) ─────────────────────────────────────

function LatestAwardsPanel({
  group,
  worldId,
}: {
  group: GroupRow;
  worldId: string;
}) {
  const history = group.award_history ?? [];
  // Most recent first.
  const ordered = [...history].sort((a, b) => b.year - a.year);

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Latest awards</h2>
        <p className="text-muted text-[10px] uppercase tracking-widest mt-0.5">
          last {ordered.length} year{ordered.length === 1 ? '' : 's'} of payouts
        </p>
      </header>
      {ordered.length === 0 ? (
        <div className="px-4 py-6 text-muted text-sm italic">
          No awards yet — dues haven't been paid out.
        </div>
      ) : (
        <ol className="divide-y divide-border-warm">
          {ordered.map((entry) => (
            <AwardEntryRow
              key={`${entry.year}-${entry.total_paid}`}
              entry={entry}
              worldId={worldId}
              leaderId={group.leader_id}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function AwardEntryRow({
  entry,
  worldId,
  leaderId,
}: {
  entry: FactionAwardEntry;
  worldId: string;
  leaderId: string | null;
}) {
  return (
    <li className="px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-display text-gold-bright">Year {entry.year}</span>
        <span className="text-muted tabular-nums">
          treasury {entry.treasury_in_year.toLocaleString()} · paid{' '}
          <span className="text-gold">{entry.total_paid.toLocaleString()}</span>
        </span>
      </div>
      {entry.leader_id && entry.leader_cut > 0 && (
        <div className="flex items-baseline justify-between text-xs">
          <span className="text-muted uppercase tracking-wider text-[10px]">
            Leader cut
          </span>
          <span className="font-mono tabular-nums">
            <Link
              to={`/world/${worldId}/person/${entry.leader_id}`}
              className="text-gold-bright hover:underline"
            >
              {entry.leader_id === leaderId ? 'current leader' : 'past leader'}
            </Link>
            {' '}
            +{entry.leader_cut.toLocaleString()}
          </span>
        </div>
      )}
      {entry.ranks.length > 0 && (
        <ol className="space-y-1">
          {entry.ranks.map((r) => (
            <li
              key={`${r.person_id}-${r.rank}`}
              className="flex items-baseline justify-between text-xs"
            >
              <span className="text-muted">
                #{r.rank}{' '}
                <Link
                  to={`/world/${worldId}/person/${r.person_id}`}
                  className="text-gold-bright hover:underline"
                >
                  {r.person_id.slice(0, 8)}…
                </Link>
              </span>
              <span className="font-mono tabular-nums">
                income {r.income_this_year.toLocaleString()} · prize{' '}
                <span className="text-gold">+{r.prize.toLocaleString()}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function HallOfFamePanel({
  group,
  worldId,
}: {
  group: GroupRow;
  worldId: string;
}) {
  const top = useGroupMembers(group.id, undefined, 8, 'wins');

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Hall of fame</h2>
        <p className="text-muted text-[10px] uppercase tracking-widest mt-0.5">
          top by wins · current members only
        </p>
      </header>
      {top.isLoading ? (
        <div className="px-4 py-6 text-muted text-sm">Loading…</div>
      ) : top.error ? (
        <div className="px-4 py-6 text-blood text-sm">Failed to load.</div>
      ) : !top.data || top.data.rows.length === 0 ? (
        <div className="px-4 py-6 text-muted text-sm italic">
          No members yet.
        </div>
      ) : (
        <ol className="divide-y divide-border-warm">
          {top.data.rows.map((m, i) => (
            <li
              key={m.id}
              className="px-4 py-2 flex items-baseline justify-between gap-3 text-sm"
            >
              <div className="flex items-baseline gap-3 min-w-0">
                <span className="text-muted text-xs tabular-nums w-4 text-right">
                  {i + 1}
                </span>
                <Link
                  to={`/world/${worldId}/person/${m.id}`}
                  className="text-gold-bright hover:underline truncate"
                >
                  {m.name ?? (
                    <span className="font-mono">{m.id.slice(0, 8)}…</span>
                  )}
                </Link>
              </div>
              <div className="flex gap-2 text-[10px] uppercase tracking-widest text-muted shrink-0">
                <span title="first-place wins" className="text-amber-300">
                  ★ {m.faction_wins}
                </span>
                <span title="years as leader" className="text-rune">
                  {m.faction_leadership_years}y
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function MembershipChart({
  history,
}: {
  history: Array<{ year: number; count: number }>;
}) {
  const w = 600;
  const h = 120;
  const padX = 32;
  const padY = 12;
  const maxCount = Math.max(1, ...history.map((p) => p.count));
  const minYear = history[0].year;
  const maxYear = history[history.length - 1].year;
  const xRange = Math.max(1, maxYear - minYear);

  const points = history
    .map((p) => {
      const x = padX + ((p.year - minYear) / xRange) * (w - 2 * padX);
      const y = h - padY - (p.count / maxCount) * (h - 2 * padY);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">Membership over time</h2>
        <span className="text-muted text-xs">
          year {minYear} → {maxYear} · peak {maxCount.toLocaleString()}
        </span>
      </header>
      <div className="px-4 py-3">
        <svg
          viewBox={`0 0 ${w} ${h}`}
          className="w-full h-32"
          preserveAspectRatio="none"
        >
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            points={points}
            className="text-gold-bright"
          />
        </svg>
      </div>
    </section>
  );
}

function DetailPanel({
  detail,
  worldId,
}: {
  detail: GroupDetailData;
  worldId: string;
}) {
  const { group, founder_name, founder_alive, leader_name, leader_alive } = detail;
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Charter</h2>
      </header>
      <div className="px-4 py-3 space-y-3 text-sm">
        <Row
          k="Founder"
          v={
            group.founder_id ? (
              <PersonRef
                worldId={worldId}
                id={group.founder_id}
                name={founder_name}
                alive={founder_alive}
              />
            ) : (
              <span className="text-muted italic">unknown</span>
            )
          }
        />
        <Row
          k="Leader"
          v={
            group.leader_id ? (
              <PersonRef
                worldId={worldId}
                id={group.leader_id}
                name={leader_name}
                alive={leader_alive}
              />
            ) : (
              <span className="text-muted italic">vacant</span>
            )
          }
        />
        <Row
          k="Wanted tags"
          v={
            <div className="flex flex-wrap gap-1">
              {group.wanted_tags.map((t) => (
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
          k="Stat floors"
          v={
            Object.keys(group.stat_floors).length === 0 ? (
              <span className="text-muted italic">none</span>
            ) : (
              <div className="text-xs font-mono text-gray-200">
                {Object.entries(group.stat_floors)
                  .map(([k, v]) => `${k}≥${v}`)
                  .join(' · ')}
              </div>
            )
          }
        />
        {group.last_schism_year != null && (
          <Row k="Last schism" v={`year ${group.last_schism_year}`} />
        )}
        {group.low_membership_years > 0 && (
          <Row
            k="Low-member years"
            v={
              <span className="text-blood text-xs">
                {group.low_membership_years} (dissolution clock)
              </span>
            }
          />
        )}
      </div>
    </section>
  );
}

function PersonRef({
  worldId,
  id,
  name,
  alive,
}: {
  worldId: string;
  id: string;
  name: string | null;
  alive: boolean;
}) {
  return (
    <Link
      to={`/world/${worldId}/person/${id}`}
      className="text-gold-bright hover:underline"
    >
      {name ?? <span className="font-mono">{id.slice(0, 8)}…</span>}
      {!alive && (
        <span className="ml-2 text-muted text-[10px] uppercase tracking-widest">
          deceased
        </span>
      )}
    </Link>
  );
}

function MembersPanel({
  group,
  worldId,
}: {
  group: GroupRow;
  worldId: string;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Light debounce so typing doesn't slam the server.
  useDebouncedEffect(() => setDebounced(search.trim()), [search], 250);

  const membersQ = useGroupMembers(group.id, debounced || undefined, 50);
  const kick = useKickMember(group.id);
  const convert = useConvertMember(group.id);

  const verb = group.kind === 'religion' ? 'Excommunicate' : 'Cast out';
  const convertVerb = group.kind === 'religion' ? 'Convert' : 'Recruit';

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-lg text-gold-bright">Members</h2>
          <p className="text-muted text-[10px] uppercase tracking-widest mt-0.5">
            real persons only · bucket members are aggregate
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="filter by name…"
            className="bg-surface border border-border-warm rounded px-2 py-1 text-xs w-44 focus:outline-none focus:border-gold-dim"
          />
          {membersQ.data && (
            <span className="text-muted text-[10px] uppercase tracking-widest">
              {membersQ.data.rows.length} / {membersQ.data.total}
            </span>
          )}
        </div>
      </header>

      <div className="px-4 py-3 border-b border-border-warm flex flex-wrap items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider text-muted">
          {convertVerb} a soul
        </span>
        <button
          onClick={() => setPickerOpen(true)}
          disabled={convert.isPending}
          className="px-3 py-1 text-xs rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
        >
          {convert.isPending ? `${convertVerb}ing…` : `Pick someone to ${convertVerb.toLowerCase()}…`}
        </button>
        {convert.error && (
          <span className="text-blood text-xs basis-full">
            {convert.error.message}
          </span>
        )}
        <PersonPickerModal
          worldId={worldId}
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={(row) => convert.mutate(row.id)}
          title={`${convertVerb} a soul to "${group.name}"`}
          selectLabel={convertVerb}
        />
      </div>

      <div className="max-h-96 overflow-y-auto">
        {membersQ.isLoading ? (
          <div className="px-4 py-6 text-muted text-sm">Loading…</div>
        ) : membersQ.error ? (
          <div className="px-4 py-6 text-blood text-sm">
            Failed to load members.
          </div>
        ) : !membersQ.data || membersQ.data.rows.length === 0 ? (
          <div className="px-4 py-6 text-muted text-sm italic">
            No real-person members{debounced ? ' match that filter' : ''}.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-widest text-muted">
              <tr className="border-b border-border-warm">
                <th className="text-left px-4 py-2">Name</th>
                <th className="text-left px-2 py-2">Type</th>
                <th className="text-right px-2 py-2">Age</th>
                <th className="text-right px-2 py-2">Int</th>
                <th className="text-right px-2 py-2">Cmb</th>
                <th className="text-right px-2 py-2">Wealth</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {membersQ.data.rows.map((m) => (
                <MemberRowView
                  key={m.id}
                  member={m}
                  worldId={worldId}
                  isLeader={group.leader_id === m.id}
                  verb={verb}
                  onKick={() => {
                    if (
                      confirm(
                        `${verb} ${m.name ?? m.id.slice(0, 8)} from "${group.name}"?`,
                      )
                    ) {
                      kick.mutate(m.id);
                    }
                  }}
                  pending={kick.isPending}
                />
              ))}
            </tbody>
          </table>
        )}
        {kick.error && (
          <div className="px-4 py-2 text-blood text-xs">{kick.error.message}</div>
        )}
      </div>
    </section>
  );
}

function MemberRowView({
  member,
  worldId,
  isLeader,
  verb,
  onKick,
  pending,
}: {
  member: MemberRow;
  worldId: string;
  isLeader: boolean;
  verb: string;
  onKick: () => void;
  pending: boolean;
}) {
  return (
    <tr className="border-b border-border-warm/40 hover:bg-panel/40">
      <td className="px-4 py-2">
        <Link
          to={`/world/${worldId}/person/${member.id}`}
          className="text-gold-bright hover:underline"
        >
          {member.name ?? (
            <span className="font-mono">{member.id.slice(0, 8)}…</span>
          )}
        </Link>
        {isLeader && (
          <span className="ml-2 text-[10px] uppercase tracking-widest text-rune">
            leader
          </span>
        )}
        {member.is_pinned && (
          <span className="ml-2 text-[10px] uppercase tracking-widest text-muted">
            pinned
          </span>
        )}
      </td>
      <td className="px-2 py-2 text-muted text-xs">{member.type}</td>
      <td className="px-2 py-2 text-right tabular-nums">{member.age}</td>
      <td className="px-2 py-2 text-right tabular-nums">{member.intelligence}</td>
      <td className="px-2 py-2 text-right tabular-nums">{member.combat}</td>
      <td className="px-2 py-2 text-right tabular-nums">
        {member.wealth.toLocaleString()}
      </td>
      <td className="px-2 py-2 text-right">
        <button
          onClick={onKick}
          disabled={pending}
          className="px-2 py-0.5 text-[10px] uppercase tracking-widest rounded bg-red-700 hover:bg-red-600 text-white disabled:opacity-40"
        >
          {verb}
        </button>
      </td>
    </tr>
  );
}

function AffinitiesPanel({ group }: { group: GroupRow }) {
  const entries = Object.entries(group.type_affinities).sort((a, b) => b[1] - a[1]);
  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm">
        <h2 className="font-display text-lg text-gold-bright">Type affinities</h2>
      </header>
      {entries.length === 0 ? (
        <div className="px-4 py-3 text-muted text-sm italic">No affinities set.</div>
      ) : (
        <div className="px-4 py-3 space-y-2">
          {entries.map(([type, weight]) => (
            <div key={type} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-gold-bright font-display">{type}</span>
                <span className="text-muted tabular-nums">{weight.toFixed(2)}</span>
              </div>
              <div className="h-2 bg-surface rounded overflow-hidden border border-border-warm">
                <div
                  className="h-full bg-gold-dim"
                  style={{ width: `${Math.min(100, weight * 10)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Edit panel ───────────────────────────────────────────────────────────

interface EditDraft {
  name: string;
  wanted_tags: PersonalityTag[];
  cost_pct_of_wealth: number; // religion
  cost_per_year: number;
  tax_rate: number; // faction
  army_size: number; // faction
  stat_floors: {
    intelligence_min: number | null;
    combat_min: number | null;
    wealth_min: number | null;
    age_min: number | null;
  };
  type_affinities: Record<string, number>;
  leader_id: string;
}

function buildDraft(g: GroupRow): EditDraft {
  return {
    name: g.name,
    wanted_tags: [...g.wanted_tags],
    cost_pct_of_wealth: g.cost_pct_of_wealth ?? 0,
    cost_per_year: g.cost_per_year,
    tax_rate: g.tax_rate ?? 0,
    army_size: g.army_size,
    stat_floors: {
      intelligence_min: g.stat_floors?.intelligence_min ?? null,
      combat_min: g.stat_floors?.combat_min ?? null,
      wealth_min: g.stat_floors?.wealth_min ?? null,
      age_min: g.stat_floors?.age_min ?? null,
    },
    type_affinities: { ...g.type_affinities },
    leader_id: g.leader_id ?? '',
  };
}

function EditPanel({
  detail,
  worldId,
  onDone,
}: {
  detail: GroupDetailData;
  worldId: string;
  onDone: () => void;
}) {
  const { group } = detail;
  const update = useUpdateGroup(group.id);
  const [draft, setDraft] = useState<EditDraft>(() => buildDraft(group));
  const [leaderPickerOpen, setLeaderPickerOpen] = useState(false);
  const [leaderPickedName, setLeaderPickedName] = useState<string | null>(null);

  const toggleTag = (t: PersonalityTag) => {
    setDraft((d) => ({
      ...d,
      wanted_tags: d.wanted_tags.includes(t)
        ? d.wanted_tags.filter((x) => x !== t)
        : [...d.wanted_tags, t].slice(0, 8),
    }));
  };

  const setFloor = (
    k: keyof EditDraft['stat_floors'],
    v: number | null,
  ) => {
    setDraft((d) => ({ ...d, stat_floors: { ...d.stat_floors, [k]: v } }));
  };

  const setAffinity = (t: PersonType, v: number | null) => {
    setDraft((d) => {
      const next = { ...d.type_affinities };
      if (v == null || v <= 0) {
        delete next[t];
      } else {
        next[t] = v;
      }
      return { ...d, type_affinities: next };
    });
  };

  const submit = () => {
    const body: UpdateGroupBody = {};
    if (draft.name.trim() && draft.name.trim() !== group.name) {
      body.name = draft.name.trim();
    }
    if (
      draft.wanted_tags.length >= 1 &&
      !sameArray(draft.wanted_tags, group.wanted_tags)
    ) {
      body.wanted_tags = draft.wanted_tags;
    }

    const floors: UpdateGroupBody['stat_floors'] = {};
    for (const [k, v] of Object.entries(draft.stat_floors)) {
      if (v != null && v >= 0) (floors as Record<string, number>)[k] = v;
    }
    if (!sameRecord(floors as Record<string, number>, group.stat_floors)) {
      body.stat_floors = floors;
    }

    if (!sameRecord(draft.type_affinities, group.type_affinities)) {
      body.type_affinities = draft.type_affinities as UpdateGroupBody['type_affinities'];
    }

    if (group.kind === 'religion') {
      const next = round3(draft.cost_pct_of_wealth);
      const cur = round3(group.cost_pct_of_wealth ?? 0);
      if (next !== cur) body.cost_pct_of_wealth = next;
    } else {
      if (draft.cost_per_year !== group.cost_per_year) {
        body.cost_per_year = draft.cost_per_year;
      }
      if (draft.tax_rate !== (group.tax_rate ?? 0)) {
        body.tax_rate = draft.tax_rate;
      }
      if (draft.army_size !== group.army_size) {
        body.army_size = draft.army_size;
      }
    }

    const trimmedLeader = draft.leader_id.trim();
    const curLeader = group.leader_id ?? '';
    if (trimmedLeader !== curLeader) {
      body.leader_id = trimmedLeader === '' ? null : trimmedLeader;
    }

    if (Object.keys(body).length === 0) {
      onDone();
      return;
    }
    update.mutate(body, { onSuccess: onDone });
  };

  return (
    <section className="border border-border-warm rounded bg-panel-warm">
      <header className="px-4 py-3 border-b border-border-warm flex items-baseline justify-between">
        <h2 className="font-display text-lg text-gold-bright">Edit charter</h2>
        <span className="text-muted text-[10px] uppercase tracking-widest">
          god-mode
        </span>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border-warm">
        {/* Left column: identity + doctrine */}
        <div className="px-4 py-3 space-y-3 text-sm">
          <SectionHeading>Identity & doctrine</SectionHeading>
          <FieldRow label="Name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              maxLength={120}
              className="w-full bg-surface border border-border-warm rounded px-2 py-1 focus:outline-none focus:border-gold-dim"
            />
          </FieldRow>
          <FieldRow label="Founder">
            {group.founder_id ? (
              <PersonRef
                worldId={worldId}
                id={group.founder_id}
                name={detail.founder_name}
                alive={detail.founder_alive}
              />
            ) : (
              <span className="text-muted italic">unknown</span>
            )}
            <div className="text-muted text-[10px] mt-0.5">immutable</div>
          </FieldRow>
          <FieldRow label="Leader" align="start">
            <div className="space-y-1.5 w-full">
              {group.leader_id && (
                <div className="text-xs">
                  current:{' '}
                  <PersonRef
                    worldId={worldId}
                    id={group.leader_id}
                    name={detail.leader_name}
                    alive={detail.leader_alive}
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2 items-center">
                <button
                  type="button"
                  onClick={() => setLeaderPickerOpen(true)}
                  className="px-3 py-1 text-xs rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10"
                >
                  Pick leader…
                </button>
                {draft.leader_id && (
                  <>
                    <span className="text-xs text-muted">
                      pending:{' '}
                      <span className="text-gold-bright">
                        {leaderPickedName ?? draft.leader_id.slice(0, 8) + '…'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({ ...draft, leader_id: '' });
                        setLeaderPickedName(null);
                      }}
                      className="text-[10px] uppercase tracking-widest text-muted hover:text-blood"
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
              <PersonPickerModal
                worldId={worldId}
                open={leaderPickerOpen}
                onClose={() => setLeaderPickerOpen(false)}
                onSelect={(row) => {
                  setDraft({ ...draft, leader_id: row.id });
                  setLeaderPickedName(row.name);
                }}
                selectedId={draft.leader_id || null}
                title={`Choose leader for "${group.name}"`}
                selectLabel="Set leader"
              />
            </div>
          </FieldRow>
          <FieldRow label="Wanted tags" align="start">
            <div className="flex flex-wrap gap-1.5">
              {PERSONALITY_TAGS.map((t) => {
                const on = draft.wanted_tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
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
          <FieldRow label="Stat floors" align="start">
            <div className="space-y-1.5 w-full">
              <FloorRow
                label="intelligence_min"
                value={draft.stat_floors.intelligence_min}
                max={100}
                onChange={(v) => setFloor('intelligence_min', v)}
              />
              <FloorRow
                label="combat_min"
                value={draft.stat_floors.combat_min}
                max={100}
                onChange={(v) => setFloor('combat_min', v)}
              />
              <FloorRow
                label="wealth_min"
                value={draft.stat_floors.wealth_min}
                max={1_000_000}
                onChange={(v) => setFloor('wealth_min', v)}
              />
              <FloorRow
                label="age_min"
                value={draft.stat_floors.age_min}
                max={120}
                onChange={(v) => setFloor('age_min', v)}
              />
            </div>
          </FieldRow>
        </div>

        {/* Right column: economics + affinities */}
        <div className="px-4 py-3 space-y-3 text-sm">
          <SectionHeading>Economics</SectionHeading>
          {group.kind === 'religion' ? (
            <div>
              <div className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-muted">
                <span>Tithe</span>
                <span className="font-mono text-gold tabular-nums">
                  {(draft.cost_pct_of_wealth * 100).toFixed(1)}% / yr
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                step={1}
                value={Math.round(draft.cost_pct_of_wealth * 100)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    cost_pct_of_wealth:
                      Number.parseInt(e.target.value, 10) / 100,
                  })
                }
                className="w-full accent-gold-dim mt-1"
              />
            </div>
          ) : (
            <>
              <FieldRow label="Cost / year">
                <input
                  type="number"
                  min={0}
                  max={100_000}
                  value={draft.cost_per_year}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      cost_per_year:
                        Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full bg-surface border border-border-warm rounded px-2 py-1 font-mono focus:outline-none focus:border-gold-dim"
                />
              </FieldRow>
              <FieldRow label="Tax rate">
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={draft.tax_rate}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      tax_rate: Math.max(
                        0,
                        Math.min(50, Number.parseInt(e.target.value, 10) || 0),
                      ),
                    })
                  }
                  className="w-full bg-surface border border-border-warm rounded px-2 py-1 font-mono focus:outline-none focus:border-gold-dim"
                />
              </FieldRow>
              <FieldRow label="Army size">
                <input
                  type="number"
                  min={0}
                  value={draft.army_size}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      army_size:
                        Math.max(0, Number.parseInt(e.target.value, 10) || 0),
                    })
                  }
                  className="w-full bg-surface border border-border-warm rounded px-2 py-1 font-mono focus:outline-none focus:border-gold-dim"
                />
              </FieldRow>
            </>
          )}

          <SectionHeading>Type affinities</SectionHeading>
          <div className="space-y-1.5">
            {PERSON_TYPES.map((t) => {
              const cur = draft.type_affinities[t] ?? 0;
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
                      setAffinity(
                        t,
                        Number.parseInt(e.target.value, 10) / 10 || 0,
                      )
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
      </div>
      <div className="px-4 py-3 border-t border-border-warm flex items-center justify-between gap-3">
        {update.error && (
          <div className="text-blood text-xs">{update.error.message}</div>
        )}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={onDone}
            className="px-3 py-2 text-sm rounded border border-border-warm text-muted hover:text-amber-300"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={update.isPending}
            className="px-3 py-2 text-sm rounded border border-amber-400 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40"
          >
            {update.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </section>
  );
}

function FloorRow({
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
        'grid grid-cols-[7rem_1fr] gap-3 ' +
        (align === 'start' ? 'items-start' : 'items-center')
      }
    >
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div>{children}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border-warm rounded p-3 bg-panel">
      <div className="text-muted text-[10px] uppercase tracking-wider">{label}</div>
      <div className="font-display text-gold-bright text-lg tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-3 items-baseline">
      <div className="text-muted text-[10px] uppercase tracking-wider">{k}</div>
      <div className="text-gray-200">{v}</div>
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

// ─── Diff helpers ─────────────────────────────────────────────────────────

function sameArray<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x === b[i]);
}

function sameRecord(
  a: Record<string, number>,
  b: Record<string, number>,
): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => a[k] === b[k]);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function useDebouncedEffect(
  effect: () => void,
  deps: React.DependencyList,
  delay: number,
) {
  useEffect(() => {
    const id = setTimeout(effect, delay);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay]);
}
