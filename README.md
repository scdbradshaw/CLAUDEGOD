# CLAUDE GOD

Personal AI civilization sim with personal-drama zoom-in. Reboot of `AI GOD` — see `DESIGN.md` for the full design.

## Stack

- **Backend** — Express + Prisma + PostgreSQL + pg-boss
- **Frontend** — React 18 + React Router 6 + TanStack Query + Tailwind + Vite
- **Shared** — TypeScript types/constants imported by both
- **AI** — Deferred. v1 generates structured scores only; story mode added later.

## Setup

```bash
# Install dependencies
npm install

# Set up Postgres (local — Postgres.app or `brew install postgresql@16`)
# Then create .env in packages/backend with DATABASE_URL

# Push schema (once schema is written)
npm run db:migrate
```

## Dev

```bash
npm run dev   # runs backend + frontend concurrently
```

Backend: http://localhost:3001
Frontend: http://localhost:5173

## Status

Scaffolding only. No game logic implemented yet. See `DESIGN.md` §18 for the build roadmap.
