// ============================================================
// NavBar — persistent navigation shell on every page.
// Grimoire aesthetic: warm dark bg, gold accents, no emojis.
// ============================================================

import { NavLink, Link } from 'react-router-dom';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { WorldListItem } from '@civ-sim/shared';

const NAV_ITEMS = [
  { to: '/',          label: 'World View', glyph: '⊕' },
  { to: '/souls',     label: 'Souls',      glyph: '⚉' },
  { to: '/groups',    label: 'Groups',     glyph: '⬡' },
  { to: '/chronicle', label: 'Chronicle',  glyph: '◉' },
  { to: '/exchange',  label: 'Exchange',   glyph: '◈' },
  { to: '/fallen',    label: 'The Fallen', glyph: '✝' },
];

export default function NavBar() {
  const [designerOpen, setDesignerOpen] = useState(false);

  const { data: worlds } = useQuery({
    queryKey: ['worlds'],
    queryFn:  api.worlds.list,
    staleTime: 30_000,
  });
  const activeWorld = worlds?.find((w: WorldListItem) => w.is_active) ?? null;

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 h-11 flex items-stretch border-b border-border bg-panel/95 backdrop-blur-sm">
        {/* Brand */}
        <Link
          to="/"
          className="flex items-center gap-2 px-4 border-r border-border shrink-0 group"
        >
          <span className="font-display text-gold text-sm tracking-[0.2em] group-hover:text-gold-bright transition-colors">
            AI GOD
          </span>
          {activeWorld && (
            <span className="hidden sm:block text-[10px] text-muted border-l border-border/60 pl-2 ml-1 tracking-wide">
              {activeWorld.name}
              <span className="text-gold-dim ml-1">yr {activeWorld.current_year}</span>
            </span>
          )}
        </Link>

        {/* Nav links — horizontal scroll on small screens */}
        <div className="flex items-stretch flex-1 overflow-x-auto scrollbar-none">
          {NAV_ITEMS.map(({ to, label, glyph }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-4 text-[11px] tracking-wider whitespace-nowrap
                 border-b-2 transition-colors duration-150 shrink-0
                 ${isActive
                   ? 'text-gold border-gold bg-gold-dim/10'
                   : 'text-muted border-transparent hover:text-gray-300 hover:border-border-warm'
                 }`
              }
            >
              <span className="text-[10px] opacity-60">{glyph}</span>
              {label}
            </NavLink>
          ))}
        </div>

        {/* Designer mode toggle — far right */}
        <div className="relative flex items-center px-3 border-l border-border shrink-0">
          <button
            onClick={() => setDesignerOpen(o => !o)}
            title="Designer Mode"
            className={`text-sm transition-colors ${
              designerOpen ? 'text-gold' : 'text-muted hover:text-gray-300'
            }`}
          >
            ⚙
          </button>

          {designerOpen && (
            <>
              {/* Backdrop */}
              <div
                className="fixed inset-0 z-40"
                onClick={() => setDesignerOpen(false)}
              />
              {/* Dropdown */}
              <div className="absolute right-0 top-full mt-1 w-44 panel z-50 py-1 shadow-2xl">
                <p className="label px-3 py-2 border-b border-border">Designer Mode</p>
                <NavLink
                  to="/worlds"
                  onClick={() => setDesignerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 text-xs transition-colors
                     ${isActive ? 'text-gold' : 'text-muted hover:text-gray-200'}`
                  }
                >
                  ◈ World Designer
                </NavLink>
                <NavLink
                  to="/rules"
                  onClick={() => setDesignerOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3 py-2 text-xs transition-colors
                     ${isActive ? 'text-gold' : 'text-muted hover:text-gray-200'}`
                  }
                >
                  ◆ Rule Library
                </NavLink>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* Spacer so page content clears the fixed nav */}
      <div className="h-11" />
    </>
  );
}
