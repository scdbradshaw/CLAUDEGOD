// "/" redirector. If exactly one world exists, jump straight to its map.
// Otherwise fall through to the WorldSetup picker.

import { Navigate } from 'react-router-dom';
import { useWorlds } from '../hooks/useWorld';
import { WorldSetup } from './WorldSetup';

export function IndexPage() {
  const q = useWorlds();
  if (q.isLoading) {
    return <div className="px-6 py-12 text-muted">Loading…</div>;
  }
  const worlds = q.data?.worlds ?? [];
  if (worlds.length === 1) {
    return <Navigate to={`/world/${worlds[0].id}`} replace />;
  }
  return <WorldSetup />;
}
