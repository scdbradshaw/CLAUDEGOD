// World setup landing page (Phase 11a).
// - Lists existing worlds (open) and offers a creation form (new).
// - On no-worlds, this is the implicit landing page from "/".

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { REGION_RESOURCES, type RegionResource } from '@claude-god/shared';
import { useWorlds } from '../hooks/useWorld';
import { api } from '../lib/api';

interface CreateWorldResponse {
  world: { id: string; name: string };
}

export function WorldSetup() {
  const worldsQuery = useWorlds();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState('');
  const [cityName, setCityName] = useState('');
  const [region, setRegion] = useState<RegionResource>('farmland');
  const [seedPop, setSeedPop] = useState(10_000);

  const createWorld = useMutation<CreateWorldResponse, Error>({
    mutationFn: () =>
      api<CreateWorldResponse>('/api/worlds', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          city_name: cityName.trim(),
          region_resource: region,
          seed_population: seedPop,
        }),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['worlds'] });
      navigate(`/world/${data.world.id}`);
    },
  });

  const canSubmit = name.trim().length > 0 && cityName.trim().length > 0 && !createWorld.isPending;

  return (
    <div className="max-w-screen-md mx-auto px-6 py-12 space-y-12">
      <header>
        <h1 className="font-display text-4xl text-gold-bright">World setup</h1>
        <p className="text-muted text-sm mt-2">
          Open an existing world or seed a new one.
        </p>
      </header>

      <section>
        <h2 className="font-display text-xl text-gold mb-3">Existing worlds</h2>
        {worldsQuery.isLoading && <div className="text-muted">Loading...</div>}
        {worldsQuery.error && (
          <div className="text-blood text-sm">Failed to load worlds.</div>
        )}
        {worldsQuery.data && worldsQuery.data.worlds.length === 0 && (
          <div className="text-muted text-sm italic">No worlds yet — create one below.</div>
        )}
        <ul className="divide-y divide-border-warm">
          {worldsQuery.data?.worlds.map((w) => (
            <li key={w.id}>
              <button
                className="w-full text-left py-3 hover:bg-panel transition flex justify-between items-center"
                onClick={() => navigate(`/world/${w.id}`)}
              >
                <span className="font-display text-gold-bright">{w.name}</span>
                <span className="text-muted text-xs">
                  Year {w.current_year} · market {w.market_index.toFixed(2)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-border-warm rounded p-6 bg-panel-warm">
        <h2 className="font-display text-xl text-gold mb-4">Forge a new world</h2>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) createWorld.mutate();
          }}
        >
          <Field label="World name">
            <input
              className="w-full bg-surface border border-border-warm rounded px-3 py-2 text-gray-100"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="Ealdwyrm"
            />
          </Field>
          <Field label="First city">
            <input
              className="w-full bg-surface border border-border-warm rounded px-3 py-2 text-gray-100"
              value={cityName}
              onChange={(e) => setCityName(e.target.value)}
              maxLength={100}
              placeholder="Hearthhold"
            />
          </Field>
          <Field label="Region">
            <select
              className="w-full bg-surface border border-border-warm rounded px-3 py-2 text-gray-100"
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionResource)}
            >
              {REGION_RESOURCES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Seed population: ${seedPop.toLocaleString()}`}>
            <input
              type="range"
              min={1000}
              max={50_000}
              step={1000}
              value={seedPop}
              onChange={(e) => setSeedPop(Number(e.target.value))}
              className="w-full"
            />
          </Field>
          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-display tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {createWorld.isPending ? 'Forging…' : 'Forge world'}
          </button>
          {createWorld.error && (
            <div className="text-blood text-sm">{createWorld.error.message}</div>
          )}
        </form>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-muted text-xs uppercase tracking-wider mb-1">{label}</span>
      {children}
    </label>
  );
}
