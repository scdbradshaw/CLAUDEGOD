/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Grimoire dark palette ──────────────────────────────
        surface:       '#080b0f',   // near-black base
        panel:         '#0e1117',   // card background
        'panel-warm':  '#100f0c',   // warm-tinted card (god mode, special sections)
        border:        '#252010',   // warm dark border
        'border-warm': '#3a2e14',   // brighter warm border (hover/active)
        muted:         '#7a7060',   // warm muted text
        // ── Gold / illuminated ─────────────────────────────────
        gold:          '#c9a432',   // primary accent
        'gold-bright': '#e0bc50',   // hover / highlight gold
        'gold-dim':    '#5e4a18',   // subtle gold tint
        // ── Arcane / atmospheric ───────────────────────────────
        rune:          '#8b6fd4',   // arcane violet (memories, chronicles)
        blood:         '#8b1a1a',   // dark crimson (danger, death)
        parchment:     '#b8956a',   // aged tan (body text accents)
        ember:         '#c46020',   // fire orange (warnings, bulk actions)
        ash:           '#3d3850',   // blue-grey shadow
      },
      fontFamily: {
        mono:    ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        display: ['Cinzel', 'Georgia', 'serif'],
      },
      backgroundImage: {
        // Subtle grain texture via SVG noise pattern
        'grain': "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E\")",
      },
      keyframes: {
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.85' },
        },
      },
      animation: {
        flicker: 'flicker 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
