// Full-page person browser. Same component as the inline picker, but row
// clicks navigate to the person detail page instead of firing a callback.

import { useNavigate, useParams } from 'react-router-dom';
import { PersonPicker } from '../components/PersonPicker';

export function People() {
  const { worldId } = useParams<{ worldId: string }>();
  const navigate = useNavigate();
  if (!worldId) return null;

  return (
    <div className="max-w-screen-2xl mx-auto px-2 py-4">
      <header className="px-4 pb-3">
        <h1 className="font-display text-3xl text-gold-bright">People</h1>
        <p className="text-muted text-xs uppercase tracking-widest mt-1">
          Filter every soul in the world.
        </p>
      </header>
      <div className="border border-border-warm rounded bg-panel-warm h-[calc(100vh-10rem)]">
        <PersonPicker
          worldId={worldId}
          onSelect={(row) =>
            navigate(`/world/${worldId}/person/${row.id}`)
          }
          selectLabel="Open"
        />
      </div>
    </div>
  );
}
