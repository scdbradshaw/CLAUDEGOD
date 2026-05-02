// Top search bar (Phase 11g). Cross-entity name search; debounced.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

interface PersonHit {
  id: string;
  name: string;
  type: string;
  city_id: string;
  is_pinned: boolean;
}
interface GroupHit {
  id: string;
  name: string;
  kind: 'faction' | 'religion';
  member_count_cached: number;
}
interface CityHit {
  id: string;
  name: string;
  population_total: number;
  is_ruined: boolean;
}
interface SearchResult {
  persons: PersonHit[];
  groups: GroupHit[];
  cities: CityHit[];
}

interface Props {
  worldId: string;
}

export function SearchBar({ worldId }: Props) {
  const [raw, setRaw] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Debounce 200ms.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(raw.trim()), 200);
    return () => clearTimeout(t);
  }, [raw]);

  // Close dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, []);

  const q = useQuery<SearchResult>({
    queryKey: ['search', worldId, debounced],
    queryFn: () =>
      api(`/api/search?world_id=${worldId}&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });

  const goto = (path: string) => {
    setOpen(false);
    setRaw('');
    setDebounced('');
    navigate(path);
  };

  const data = q.data;
  const total =
    (data?.persons.length ?? 0) +
    (data?.groups.length ?? 0) +
    (data?.cities.length ?? 0);

  return (
    <div ref={containerRef} className="relative w-72">
      <input
        value={raw}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setRaw(e.target.value);
          setOpen(true);
        }}
        placeholder="Search…"
        className="w-full bg-surface border border-border-warm rounded px-3 py-1.5 text-sm focus:outline-none focus:border-gold-dim"
      />
      {open && debounced && (
        <div className="absolute right-0 mt-1 w-[24rem] max-h-[60vh] overflow-y-auto rounded border border-border-warm bg-panel-warm shadow-2xl shadow-black/50 z-40">
          {q.isLoading && (
            <div className="px-4 py-3 text-muted text-sm">Searching…</div>
          )}
          {q.error && (
            <div className="px-4 py-3 text-blood text-sm">Search failed.</div>
          )}
          {data && total === 0 && (
            <div className="px-4 py-3 text-muted text-sm italic">No matches.</div>
          )}
          {data && data.persons.length > 0 && (
            <Section label="People">
              {data.persons.map((p) => (
                <Hit
                  key={p.id}
                  onClick={() => goto(`/world/${worldId}/person/${p.id}`)}
                  primary={p.name}
                  secondary={`${p.type}${p.is_pinned ? ' · ★' : ''}`}
                />
              ))}
            </Section>
          )}
          {data && data.groups.length > 0 && (
            <Section label="Groups">
              {data.groups.map((g) => (
                <Hit
                  key={g.id}
                  onClick={() => goto(`/world/${worldId}/group/${g.id}`)}
                  primary={g.name}
                  secondary={`${g.kind} · ${g.member_count_cached} members`}
                />
              ))}
            </Section>
          )}
          {data && data.cities.length > 0 && (
            <Section label="Cities">
              {data.cities.map((c) => (
                <Hit
                  key={c.id}
                  onClick={() => goto(`/world/${worldId}/city/${c.id}`)}
                  primary={c.name}
                  secondary={`${c.population_total.toLocaleString()} souls${c.is_ruined ? ' · ruined' : ''}`}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border-warm last:border-b-0">
      <div className="px-4 pt-2 pb-1 text-muted text-[10px] uppercase tracking-widest">
        {label}
      </div>
      <ul>{children}</ul>
    </div>
  );
}

function Hit({
  onClick,
  primary,
  secondary,
}: {
  onClick: () => void;
  primary: string;
  secondary: string;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className="w-full text-left px-4 py-2 hover:bg-panel transition flex items-center gap-3"
      >
        <span className="font-display text-gold-bright flex-1 truncate">{primary}</span>
        <span className="text-muted text-xs truncate">{secondary}</span>
      </button>
    </li>
  );
}
