// Outer layout shell: header bar, content area, floating control panel.

import { Link, Outlet, useParams } from 'react-router-dom';
import { ControlPanel } from './ControlPanel';
import { SearchBar } from './SearchBar';

export function Layout() {
  const { worldId } = useParams();
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border-warm bg-panel-warm/80 backdrop-blur">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-6">
          <Link to="/" className="font-display text-gold text-lg tracking-wider">
            CLAUDE GOD
          </Link>
          {worldId && (
            <Link
              to={`/world/${worldId}`}
              className="text-muted hover:text-gold-bright text-sm"
            >
              World map
            </Link>
          )}
          {worldId && (
            <Link
              to={`/world/${worldId}/people`}
              className="text-muted hover:text-gold-bright text-sm"
            >
              People
            </Link>
          )}
          {worldId && (
            <Link
              to={`/world/${worldId}/religions`}
              className="text-muted hover:text-gold-bright text-sm"
            >
              Religions
            </Link>
          )}
          {worldId && (
            <Link
              to={`/world/${worldId}/factions`}
              className="text-muted hover:text-gold-bright text-sm"
            >
              Factions
            </Link>
          )}
          {worldId && (
            <Link
              to={`/world/${worldId}/market`}
              className="text-muted hover:text-gold-bright text-sm"
            >
              Market
            </Link>
          )}
          {worldId && (
            <Link
              to={`/world/${worldId}/god`}
              className="text-muted hover:text-gold-bright text-sm"
            >
              God Mode
            </Link>
          )}
          <span className="flex-1" />
          {worldId && <SearchBar worldId={worldId} />}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      {worldId && <ControlPanel worldId={worldId} />}
    </div>
  );
}
