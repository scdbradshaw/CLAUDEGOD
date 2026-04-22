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

## Round 3 — Trauma modifier

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

## Round 4 — Faction succession

**Goal:** when a faction leader dies, succession resolves without orphaning the
faction.

Scope:
- On leader death, pick heir from inner circle → highest leadership/charisma
  composite; tiebreak on bond.
- Fallback to faction dissolution if no viable heir.
- Narrative headline on succession (epic voice).
- Same pattern extended to religion founder death.

---

## Round 5 — Engine atomization

**Goal:** split the monolithic tick into named, individually-testable phases so
we can profile, skip, or reorder without surgery.

Scope:
- Break `advanceTime` into ordered phases: `applyDrifts → resolveInteractions →
  runAgenticTurn → processBirths → processDeaths → updateMarket →
  generateHeadlines → ensureDecadeSummaries`.
- Each phase is a function with a typed `TickContext` in / `TickContext` out.
- Per-phase timing logged behind a debug flag.

---

## Round 6 — God Mode SSE improvements

**Goal:** tighten the streaming UX of the `/api/ai` route.

Scope:
- Structured event types (`text`, `tool`, `tool_done`, `done`, `error`) are
  already in place — add `thinking` for Claude planning blocks if available,
  `progress` for multi-tool sequences.
- Client-side reconciliation: after `done`, re-fetch affected character(s) so
  the UI shows the new state without a page refresh.
- Error surface: user sees a toast with the error message; input isn't lost.

---

## Round 7 — UX polish

**Goal:** close the loop on the major pages.

Scope:
- Filter-first People page (per DESIGN §14): search, filter by trait ranges,
  sort by composite signals.
- Chronicle: collapsible year cards, decade summaries pinned.
- Character Detail: memory bank rendered with per-memory tone styling.
- RIP Archive: cause-of-death filter, peak-outcome callouts.

---

## Round 8 — Economy depth + narrative polish

**Goal:** make the market feel like a force, not a ticker.

Scope:
- Market events: crashes, booms, bubbles — triggered by force composites
  crossing thresholds; each produces a reportage-voice headline.
- Personal wealth ticks: wealth gain/loss per person driven by market_index
  movement weighted by trait.craftsmanship / trait.cunning.
- Narrative polish: voice reference block shared between headlines service and
  god-mode route (already partially done).
- Decade summary: include economic arc explicitly.

---

## Notes
- Rounds 2–8 assume Round 1's unified `traitDeltas` plumbing.
- Each round's commit should be small enough to revert independently.
- Any schema change in Rounds 2–5 requires a Prisma migration, not just a
  client regen.
