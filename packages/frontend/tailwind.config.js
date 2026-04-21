/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Civilization dark-UI palette
        surface:  '#0d1117',
        panel:    '#161b22',
        border:   '#30363d',
        muted:    '#8b949e',
        gold:     '#c9a432',
      },
      fontFamily: {
        mono:    ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
        display: ['Cinzel', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
