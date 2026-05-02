/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Arcane Sovereign" palette — deep navy-indigo shells, blue-violet
        // primary accent, neon fuchsia rune secondary. Blue lives in the
        // backgrounds + bright accent; violet anchors the primary; fuchsia
        // provides warm contrast. Token names unchanged.
        surface:       '#1a3a6e',  // friendly deep blue
        panel:         '#1f4080',  // medium blue panel
        'panel-warm':  '#244888',  // lighter blue panel
        border:        '#21274e',  // blue-purple border
        'border-warm': '#303878',  // brighter blue border
        muted:         '#8890c4',  // periwinkle — blue-grey readable muted
        gold:          '#a78bfa',  // primary accent — violet-400 (blue-leaning)
        'gold-bright': '#818cf8',  // electric periwinkle — indigo-400
        'gold-dim':    '#4338ca',  // deep blue-violet — indigo-700 (buttons)
        rune:          '#e879f9',  // neon fuchsia (warm contrast anchor)
        blood:         '#f43f5e',  // rose-crimson
        parchment:     '#d4d8f8',  // cool blue-white text
        ember:         '#fb923c',  // warm orange contrast
        ash:           '#3d4270',  // blue-slate
      },
      fontFamily: {
        mono:    ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        display: ['Cinzel', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
