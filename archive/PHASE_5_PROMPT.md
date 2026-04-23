# AI GOD — Phase 5 Handoff Prompt

Paste this entire file into a new Claude Code session to begin Phase 5.

---

## Context briefing

You are continuing work on **AI GOD**, a personal civ/god-game at `/Users/sam/Desktop/Coding Portfolio/just for fun/AI GOD/`.

- Stack: React + TypeScript + Vite (frontend), Express + Prisma + PostgreSQL (backend), shared types package. Monorepo with `packages/frontend`, `packages/backend`, `packages/shared`.
- Treat the user (Sam) as Senior Lead Architect. Be concise. Verify file paths before editing.
- Source of truth for design is `DESIGN.md` in the project root. Phase breakdown is at the bottom of that file.

**Phases 0 → 4 are complete.** Phase 4 (World Designer) wrapped up with:
- Multi-world schema (`World` model, `world_id` FK on Person/Religion/Faction/DeceasedPerson/YearlyHeadline)
- `getActiveWorld()` / `getActiveWorldId()` helpers
- Rule library as first-class entity with clone/activate/delete
- Frontend: `RuleLibrary.tsx`, `WorldDesigner.tsx`, Dashboard showing active world name
- Both backend + frontend `tsc --noEmit` pass cleanly

---

## Phase 5 scope (from DESIGN.md)

### Phase 5 — Narrative upgrades

**Step 20. Tone-routed headline generation.** Each outcome band and event type carries a `tone` tag. The headline/memory prompts pick Claude's voice accordingly.

| Event type | Voice |
|---|---|
| Personal scandals, rises/falls, addictions, affairs | Tabloid |
| Deaths, births, quiet personal moments | Literary |
| Group events (religion founded, faction split, war) | Epic |
| Bulk-effect chaos (plague, nukes, crashes) | Reportage |
| Decade summaries | Epic |

**Step 21. Decade summaries per world.** Running narrative context that long-running worlds carry forward so Claude stays coherent across centuries.

Content ceiling is **fully unflinching** (DESIGN.md §11.2). No squeamish euphemism.

---

## Your task

Deliver Phase 5 end-to-end. Two discrete steps, shippable independently.

### Step 20 — Tone routing

1. **Read these files first**, in this order, to build a mental model:
   - `DESIGN.md` §11 (Tone & Narrative) and §6 (Interactions / outcome bands)
   - `packages/backend/src/services/headlines.service.ts` — current headline generator
   - `packages/backend/src/services/simulation.service.ts` — where per-interaction memory entries are written
   - `packages/shared/src/types.ts` — `RulesetDef`, outcome band shape
   - `packages/backend/prisma/schema.prisma` — `YearlyHeadline`, `MemoryBank`
2. **Design the tone tag taxonomy.** Propose 4–6 tone slugs (e.g. `tabloid`, `literary`, `epic`, `reportage`). Show Sam the list and get approval before wiring anything.
3. **Attach tone to event sources.** Outcome bands in the ruleset schema carry a `tone` field; group lifecycle events (religion founded, faction split, member joins, death of founder) carry a hardcoded tone; bulk God Mode actions carry a tone; decade summaries are always `epic`.
4. **Route tone in prompts.** One Claude-prompt module that takes `{ tone, context }` and returns the system-prompt prefix. Headline service + memory/narration sites import it. Do *not* duplicate prompt text — keep it in one place.
5. **Persist the tone** on `YearlyHeadline` and on memory entries so future Claude calls (decade summaries) can reason about narrative pacing.
6. **Typecheck both packages** (`packages/backend` and `packages/frontend`) before declaring Step 20 done.

### Step 21 — Decade summaries per world

1. **Confirm current state** — the codebase already has a `DECADE` `HeadlineType` in the Prisma schema and some decade handling in `headlines.service.ts`. Read before building. Do not duplicate existing logic.
2. **Trigger.** A decade summary is generated when `world.current_year` crosses a decade boundary (e.g. year % 10 === 0 and > 0). Wire this into the tick pipeline or a dedicated endpoint, whichever matches existing patterns in `time.service.ts` / `interactions.ts`.
3. **Context window.** The decade prompt must receive:
   - All `ANNUAL` headlines from that decade in this world
   - Active groups (religions + factions), their founders, member counts, alignment state
   - Notable deaths (top N by influence/wealth/morality extremes)
   - Global force composite scores at decade start and end, delta
   - Current world's population trend
4. **Output shape.** 3–6 decade headlines (not one giant blob) across the same `HeadlineCategory` enum, marked `HeadlineType.DECADE`, with `epic` tone.
5. **Per-world isolation.** Every query scoped by `world_id`. Never leak across worlds.
6. **Running context for future decades.** Store the decade summary body somewhere reachable by the *next* decade's prompt so Claude threads narrative forward (simplest: pass the previous 1–2 decades' summaries into the next prompt via `world.id` lookup).
7. **Frontend.** The Headlines page (`packages/frontend/src/pages/Headlines.tsx`) already renders headlines — add a clear visual separator for `DECADE` entries and surface them prominently. Consider a dedicated "Chronicle" sub-tab or filter pill.

---

## Working agreements

- **Verify paths before editing.** Multiple worktrees exist in Sam's tree. Confirm you're in `just for fun/AI GOD/packages/...` and not a stale sibling.
- **Start with a plan, not code.** Use the Plan subagent or ExitPlanMode. Show Sam the plan for each step before writing files.
- **Use existing patterns.** Follow the route/service/shared-types structure already in place. Don't invent new conventions.
- **`world_id` is required on all per-world entities.** When in doubt, grep for how an existing service scopes queries and mirror it.
- **Shared types first.** If you add fields that cross the wire, add them to `packages/shared/src/types.ts` before the backend/frontend.
- **Typecheck before handing back.** From the repo root: `node packages/backend/node_modules/.bin/tsc --noEmit --project packages/backend/tsconfig.json` and equivalent for frontend. No red.
- **Second-order effect rule (DESIGN.md §14).** If a new narrative feature has no ripple, it's not finished. Decade summaries aren't just flavor — they should be queryable context for later ticks.
- **Be concise in responses.** Status updates at milestones, not running commentary.
- **Don't commit.** Only commit if Sam explicitly asks.

---

## Suggested first move

Read `DESIGN.md` end-to-end, then `headlines.service.ts` and `simulation.service.ts`. Then come back with:

1. Your proposed tone taxonomy
2. The list of code sites that currently generate narrative (so we know everywhere tone needs to thread through)
3. A concrete ordered plan for Step 20 before touching any files

Wait for Sam to approve before writing code.
