# AI GOD — Implementation Plan (Revision Pass 1)

This document captures the 8-round revision plan agreed on after the design
audit. It sits *on top of* `DESIGN.md` (which is the source of truth for the
end-state design) and replaces the earlier Phase 0–7 ordering in that doc with
tighter, engine-correctness-first rounds.

Each round is committed separately.

---

## Round 1 — Drop legacy 6-stat block, unify engine deltas ✅ (commit 45f4e19)

**Goal:** delete the legacy `morality / happiness / reputation / influence /
intelligence` columns; route every stat effect through a single `traitDeltas`
accumulator; fix the market engine; add capability gates to rulesets; rebuild
`linksOf` before the agentic turn; stop mutating snapshot objects.

Key changes:
- Schema: drop 5 legacy person columns + `final_happiness` from DeceasedPerson.
- Shared `RulesetDef`: add `CapabilityGates` (found_religion, found_faction,
  agentic_murder, agentic_marry, agentic_betray, agentic_befriend).
- Backend: `applyEffectPacket` consumes a unified `traitDeltas: Record<string,
  Record<string, number>>`; `affects_stats` targets trait keys directly; health
  column stays synced from `traits.health`.
- Market: `MARKET_CEILING = 10.0`, `MARKET_FLOOR = 0.1`,
  `MARKET_MEAN_REVERSION = 0.005`, pull = `(1 - market_index) * 0.005`.
- Agentic: rebuild `linksOf` from fresh DB query before `runAgenticTurn`; stop
  mutating snapshot `.relationship_status`.
- Frontend: CharacterDetail shows 5 trait categories (Physical, Mental, Social,
  Drive, Skills); People + NewCharacter cleaned up; `death_age` rolled 60–95
  uniform for v1.

---

## Round 2 — Full Births system (§9) ✅

**Goal:** implement interaction-driven conception → pregnancy tracked across
ticks → child creation with 50/50 trait inheritance.

Scope:
- **Schema:** add pregnancy state to Person (`pregnant_with_by_id: String?`,
  `pregnancy_started_tick: Int?`, `pregnancy_due_tick: Int?`). Parents both
  tracked for inner-circle link auto-creation.
- **Conception interaction:** new interaction type in the default ruleset;
  outcome bands set pregnancy state on the carrying parent.
- **Agentic action:** agents in a bonded relationship can choose
  `attempt_conception` as an agentic action (gated by capability config).
- **Tick handler:** on each tick, any person whose `pregnancy_due_tick <=
  current_tick` gives birth → `createChildFromParents` service.
- **Inheritance rules** (per §9.3):
  - Traits: mean of both parents ± variance, clamped 0–100.
  - Race: if parents differ, concatenate as `ParentA/ParentB` (or pick one;
    confirm with user).
  - Religion: inherit at birth; if parents differ, coin-flip (or null; confirm).
  - Inner-circle links: auto-create FAMILY/CHILD links to both parents.
- **Memory + narrative:** birth generates memory entries on both parents and a
  literary-voice headline entry.
- **No biological gating:** anyone can conceive with anyone at any age (§4.1).
- **No sim-seeded population backfill** — if pop dips, player injects manually.

---

## Round 3 — Trauma modifier ✅

**Goal:** persistent emotional scar tissue that modulates future interaction
outcomes, so a character's history actually shapes who they become.

Scope:
- `traumaScore: Float` (or derived) on Person, accumulated from memory entries
  weighted by `emotional_impact` (traumatic > negative > …).
- Trauma factors into interaction scoring (e.g. lowers resilience-gated
  outcomes, shifts criminal thresholds).
- Decay function so old trauma fades unless reinforced.
- Exposed on CharacterDetail as a visible bar or badge.

---

## Round 4 — Faction succession ✅

**Goal:** when a faction leader dies, succession resolves without orphaning the
faction.

Scope:
- On leader death, pick heir from membership → composite score =
  leadership + charisma + bond_to_dead; below `MIN_HEIR_COMPOSITE = 100`
  falls back to dissolution.
- Applies to both factions (existing `leader_id`) and religions (new
  `leader_id` column + migration + `onDelete: SetNull`).
- `handlePersonDeath` now returns a structured `GroupDeathOutcome` with
  religion/faction dissolves + successions.
- Succession writes a `leader_succession` group memory plus per-member
  `group_leader_death` memories (positive impact, epic tone, weight 90).
- Tick response surfaces `religion_successions`, `faction_successions`,
  and `factions_dissolved` alongside the existing `religions_dissolved`.

---

## Round 5 — Engine atomization ✅

**Goal:** split the monolithic tick into named, individually-testable phases so
we can profile, skip, or reorder without surgery.

Scope:
- New `packages/backend/src/tick/` directory houses the phase modules:
  - `timing.ts` — `withTiming(timings, label, fn)` wraps any phase and records
    duration into a `PhaseTimings` map; logs to stderr + attaches to the tick
    response only when `DEBUG_TICK_TIMING=1`.
  - `scoring.ts` — pure helpers hoisted from the route handler: `computeScore`,
    `findBand`, `getEffects`, `applyEffectPacket`, `pickInteractionType`,
    `computeGrudgeBonus`, `emotionalImpactForMagnitude`, `invertImpact`,
    plus `MAX_GRUDGE_BONUS` / `GRUDGE_MEMORY_LIMIT` constants. Shared by the
    tick protagonist loop and the `/api/interactions/force` route.
  - `resolve-interactions.ts` — exports `resolveInteractionsPhase()`, the
    per-protagonist loop (antagonist pick → grudge+trauma scoring → effect
    packets → memory intents → viral joins → spawn intents → conception
    intents). Pure computation, no DB writes — returns accumulator maps for
    the persistence phase to flush.
- `/api/interactions/tick` route now delegates step 3 to
  `resolveInteractionsPhase` and wraps each numbered step in `withTiming`
  (`resolveInteractions`, `applyDrifts`, `persistInteractions`,
  `processInteractionDeaths`, `runAgenticTurn`, `processBirths`,
  `updateMarket`). Response includes `timings_ms` when the debug flag is set.
- `/api/interactions/force` updated to import the hoisted helpers and pass
  `prisma` to the new `computeGrudgeBonus` signature.

---

## Round 6 — God Mode SSE improvements ✅

**Goal:** tighten the streaming UX of the `/api/ai` route.

Scope:
- `/api/ai` now emits a `progress` event (`{current, total, name}`) before
  every tool call, so multi-tool turns can render a "step N / M" indicator.
- `executeTool()` returns a structured `{message, touched_ids, roster_changed}`
  outcome. The route accumulates every touched character id across the full
  agentic loop and attaches them to the terminal `done` event.
- AIConsole consumes `done.touched_ids` + `done.roster_changed` to invalidate
  per-character + roster-level React Query caches so CharacterDetail / People /
  Dashboard reconcile without a page refresh.
- AIConsole preserves user input on fetch errors (only clears after the SSE
  stream actually starts); retries don't lose the prompt.
- `progress` is only rendered when `total > 1` to avoid noise on single-tool
  turns.

---

## Round 7 — UX polish ✅

**Goal:** close the loop on the major pages.

Scope:
- People: filter-first layout already in place (search, race/religion/faction
  chips, status, age range, sort by updated_at/name/age/health/wealth).
- RIP Archive: cause-of-death filter + peak positive/negative outcome
  callouts already present on every card.
- Chronicle: year sections are now collapsible. The most recent year
  auto-expands; older years collapse until clicked, keeping the first
  screenfull focused on current events. Per-year headline counts are shown
  inline on the header row.
- Memory bank: `MemoryEntry.tone` added to the shared type; the panel now
  renders a tone pill next to the impact label using the same palette as
  the Chronicle's `TonePill`, so voice reads consistently across surfaces.

---

## Round 8 — Economy depth + narrative polish ✅

**Goal:** make the market feel like a force, not a ticker.

Scope:
- New `packages/backend/src/tick/market.ts` owns the market phase:
  - `updateMarketPhase()` runs drift/mean-reversion math, applies trait-
    weighted wealth drift in a single JSONB SQL update, and returns the
    post-update index, the tick's return, and any classified event.
  - Wealth sensitivity = `0.5 + craftsmanship/200 + cunning/200` → range
    [0.5, 1.5] around mean 1.0, so skilled/shrewd characters capture ~3x
    more upside *and* downside than sheltered ones. Gated by
    `abs(return) > 0.0005` to skip no-op writes.
  - `detectMarketEvent()` classifies into crash / boom / bubble /
    depression with return-based thresholds taking priority over level-
    based ones, so a recovering crash doesn't also fire a depression
    headline on the same tick. Tunables: `MARKET_CRASH_RETURN = -0.08`,
    `MARKET_BOOM_RETURN = 0.08`, `MARKET_BUBBLE_INDEX = 1.6`,
    `MARKET_DEPRESSION_INDEX = 0.5`.
- `/api/interactions/tick` now delegates the whole market step to the new
  phase and surfaces `market_event` on the tick response.
- Shared `TickResult` gained `market_event?: MarketEvent | null`, plus
  new `MarketEvent` / `MarketEventKind` types.
- Dashboard renders the event as a colour-coded reportage-voice callout
  under the Market row (red=crash, emerald=boom, amber=bubble,
  slate=depression).
- Decade economic-arc summary deferred — would require a market_index
  history table; out of scope for this round.

---

## Notes
- Rounds 2–8 assume Round 1's unified `traitDeltas` plumbing.
- Each round's commit should be small enough to revert independently.
- Any schema change in Rounds 2–5 requires a Prisma migration, not just a
  client regen.
