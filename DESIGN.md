# AI GOD — Game Design

Read this file at the start of every session. It covers vision, design principles, and the roadmap for what gets built next. `AUDIT.md` is the companion — it describes exactly what is currently implemented.

---

## North Star

**Full control + unforeseen repercussions.**

The player is omnipotent — every lever is exposed, every person is editable, every world rule is swappable. But the simulation must be chaotic enough to surprise its creator. Every deliberate action should produce at least one second-order effect the player didn't explicitly request.

This is a private toy. No audience. No monetization. A personal AI story engine disguised as a civilization sim.

---

## What It Feels Like

- **Dramatic arcs.** Child prodigy becomes moon contractor becomes meth addict in a ditch. Rival families locked in a 200-year blood feud. A religion swallows half the world and then collapses when its prophet is assassinated.
- **Emergent, not scripted.** Every story comes from system interaction — traits + forces + relationships + memory — surfaced as narrative.
- **The director, not the writer.** The player sets the stage, edits the rules, meddles in specific lives, and lets it run. Claude writes the prose.

---

## Core Design Principles

These govern every decision about what to build and how to build it.

1. **The simulation owns the facts. Claude owns the prose.** Game logic computes who lives, who dies, who joins what group, who inherits wealth. Claude's only job is to narrate what the simulation already decided.

2. **Every action must have a ripple.** If a player action has zero second-order effects, it is not finished. Edit a trait → they found a religion → it infects 30 people you weren't watching → a schism forms → a faction starts a war. That chain is the game.

3. **Data-driven engine.** No stat names hardcoded in application logic. The ruleset JSON is the engine. Missing stats = silent no-op. This lets the player swap entire systems per world without breaking anything.

4. **Ticks are player-triggered.** Time does not advance on its own. Run 1 tick, mess around, run 10 more, dive into a character, run 100 more. The player controls pacing.

5. **The content ceiling is unflinching.** Overdose, assassination, abuse, sexual violence — rendered directly when the narrative calls for it. No gratuitous horror but no squeamish euphemism.

6. **Scale is a dial, not a bet.** Each world picks its tier. Intimate (100–500 people): every person trackable. Town (500–5k): paginated, personal but noisy. Civilization (5k–50k): macro view, dive via filters. Build for intimate first, scale later.

---

## What Is Built (Summary)

See `AUDIT.md` for full detail. High level:

- **Core tick engine** — interaction resolution, scoring, outcome bands, trait deltas, memory writes, group joins, pregnancy queueing. All in one `$transaction` per year.
- **Person model** — 25 identity attributes, 24 global force scores, demographics, trauma score, criminal record, inner circle links, market bucket.
- **Groups** — religions and factions. Viral membership via trait-matching virus profiles. Emergent founding (capability gate + dramatic event). Founder-death dissolution. Faction splits under sustained dissident pressure.
- **Memory system** — per-person narrative log with weight-based decade compression. Trauma scar tissue. Grudge reweighting for future antagonizer pairings.
- **Births** — conception interaction → pregnancy → child creation with 50/50 trait inheritance, family links.
- **Agentic actions** — year-boundary autonomous decisions: befriend, betray, marry, murder, attempt_conception.
- **Three-market economy** — stable/standard/volatile buckets. Crash/boom/bubble/depression events. Trait-modulated wealth sensitivity.
- **Narrative** — tone-routed Claude headlines (tabloid/literary/epic/reportage). Annual + decade summaries. Postgres-as-queue for async generation.
- **God Mode** — single-target delta, bulk filter+delta, force-specific interaction, manual event authoring, AI console.
- **World designer** — multi-world support, ruleset library, world creation with population tier.

---

## What Is Not Built (Prioritized Roadmap)

These are design targets. Work through them based on what most improves the moment-to-moment experience of playing. Sam decides order each session.

---

### 0. Character Model Redesign ← implement first

**Problem:** The current 25-trait JSONB system is flat and undifferentiated. Traits don't map cleanly to game mechanics. Combat, economy, and social behavior all pull from the same unstructured pool. Core stats like health, attack, defense, and speed don't exist as first-class fields.

**New Core Character Sheet — hard fields on Person:**

| Category | Fields |
|----------|--------|
| Identity | `name`, `age`, `gender`, `race`, `occupation` |
| Combat *(derived, recalculated each tick)* | `max_health` (0–100), `current_health` (0–100 pool), `attack` (0–100), `defense` (0–100), `speed` (0–100) |
| Economy | `money` (Int, rename from `wealth`), `money_invested` (Int, new) |
| Status | `faction_id`, `religion_id`, `moral_score` (−100–100), `trauma_score`, `criminal_record` |

**4 Meta Trait Categories — JSONB, 0–100 each, neutral = 50:**

Each trait pushes its target hard stat every tick. Above 50 = positive drift. Below 50 = negative drift. Magnitude scales with distance from 50.

**BODY** → feeds combat stats
- `strength` → pushes `attack`
- `endurance` → pushes `max_health` + `defense` blend
- `agility` → pushes `speed`
- `resilience` → pushes `current_health` recovery rate

**MIND** → amplifier on all trait pushes (scales how fast other traits move their targets)
- `intelligence` — scales BODY push magnitude
- `willpower` — resistance to trauma, forced `moral_score` changes
- `intuition` — outcome band weighting in ambiguous interactions
- `creativity` — group founding gate, occupation performance modifier

**HEART** → relationship and group interactions
- `charisma` — interaction scoring, group attraction rate
- `empathy` — biases interactions toward peaceful outcomes
- `loyalty` — faction/religion retention, betrayal resistance
- `jealousy` — aggression trigger toward high-wealth/bond peers

**DRIVE** → agentic action selection + economic behavior
- `ambition` — agentic action frequency, leadership candidacy
- `courage` — combat willingness, revenge action gate
- `discipline` — money growth rate, occupation income modifier
- `cunning` — theft success rate, manipulation interaction weight

**Migration:**
- ✅ Drop the 5-category 25-trait JSONB system from `Person.traits` — replaced in-place with 4-category 16-trait JSONB
- ✅ Add the 5 hard combat stat columns to Person schema (`max_health`, `current_health`, `attack`, `defense`, `speed`)
- ✅ Replace `wealth` field with `money`, add `money_invested`, add `moral_score`
- ✅ Update shared types: `IDENTITY_ATTRIBUTES` replaced with new 4-category structure; `Person`, `DeceasedPerson`, `CharacterListItem`, `PeopleListItem` all updated
- ✅ Update all backend services, routes, and frontend components to new field names
- ✅ Update `character-gen.service.ts` to seed new trait structure (TRAIT_BIASES remapped to 16 new traits)
- ✅ Add tick-phase step: after interaction resolution, derive combat stats from BODY traits + MIND amplifier (`tick/derive-stats.ts`)
- ✅ Update all ruleset `trait_weights` references to new trait names (DEFAULT_RULESET v6, all services using `ambition`/`loyalty` instead of `leadership`/`honesty`)

**Ripple test:** Raise `strength` → `attack` climbs over ticks → character wins more altercations → more traumatic outcomes for others → faction morale drops → schism pressure rises.

---

### 0.5 Tick → Year Architecture ← implement next

**Problem:** Current tick is synchronous, blocks the request, and touches every person every call. At 1000 people a tick takes ~5s. Scaling target is 50k–100k–1M. Linear scan patterns (per-person UPDATEs, per-death `prisma.$transaction` loops, full-population happiness drift, full link load every tick) make this unreachable. Player also has no visibility into what's happening inside a tick.

**Reframe:** Replace "Advance Tick" with **"Advance Year"**. One year = 2 bi-annual sub-phases + 1 year-end phase, all run inside a single async pipeline driven by **pg-boss**. Player triggers it, button blocks until done, but the work streams progress to the frontend via SSE so the player has a live heartbeat.

**Cadences:**
- **Bi-annual** (runs twice per year): interactions, events tick, deaths, births, market update, happiness drift, snapshot write
- **Year-end** (runs once per year): aging, agentic turn, religion conversions, faction splits, memory decay, occupation income, leader extraction, group treasury funding

**Player-direct actions** (`/steal`, `/gift`, `/force`) stay synchronous and immediate — they do not wait for the year pipeline.

---

#### Phase 0 — Foundation
- Local Postgres (Postgres.app or `brew install postgresql@16`) — Sam needs walkthrough
- `npm i pg-boss` in `packages/backend`
- `prisma migrate reset --force` (DB wipe is approved)
- pg-boss bootstrap creates its own `pgboss` schema on first run

#### Phase 1 — Schema migration

New tables:
- `year_runs` — pipeline status `(id, world_id, year, phase, progress_pct, started_at, completed_at, error, message)`
- `world_snapshots` — denormalized world view payload, 1 row per world, upserted per bi-annual
- `event_history` — completed/manually-ended events `(event_def_id, params, started_year, ended_year, end_reason: 'expired'|'manual'|'condition_met', duration_actual)`

New columns:
- `Person.happiness_base` (Int), `Person.happiness_set_tick` (Int) — for lazy drift
- `Person.trauma_set_tick` (Int) — for lazy decay
- `WorldEvent.duration_years` (Int, nullable — null = indefinite), `WorldEvent.years_remaining` (Float)
- `Religion.disbanded_at` (DateTime, nullable), `Faction.disbanded_at` (DateTime, nullable) — soft-delete
- `World.year_count` (replaces `tick_count`), `World.bi_annual_index` (Int 0|1)

#### Phase 2 — Async year pipeline
- New endpoint `POST /api/years/advance` enqueues a pg-boss job, returns `{ year_id }` in <200ms
- New worker `processYearJob(yearId)`:
  1. Bi-annual A → snapshot write
  2. Bi-annual B → snapshot write
  3. Year-end → snapshot write
- SSE endpoint `GET /api/years/:id/stream` streams phase progress (`year_runs` row updates emit messages)
- Tick lock replaced by job-state lock keyed off `year_runs.status`
- Frontend Advance Year button disabled until `year_runs.status = completed`

#### Phase 3 — Performance wins (the 100× lift)
1. **Sample interactions** — `K = 500` pairs per bi-annual regardless of population. Constant lives in `shared/`.
2. **Bulk death pass** — single INSERT into `deceased_persons`, single batched `distributeInheritance`, single DELETE. No more per-person `prisma.$transaction` loop.
3. **Lazy happiness/trauma** — store `(base, set_tick)`, compute on read via `effectiveHappiness(person, currentTick)` helper. Eliminates the per-person UPDATE pass entirely.
4. **Targeted event queries** — Plague: `WHERE id IN (infected_ids)`. War: SQL join on `faction_membership`. Stop loading whole population and filtering in JS.
5. **Drop full-population `deriveHardStats`** — only re-derive when traits actively changed (already tracked in `bulkUpdates`).

**Acceptance:** 1000 people → year completes in <500ms. 10k → <5s. Profile via `timings_ms`.

#### Phase 4 — Events updates
- Add `duration_years` + `years_remaining` to event activation params
- Bi-annual decrements `years_remaining` by 0.5
- When ≤0: write `event_history` row (`end_reason: 'expired'`), set `is_active=false`, emit heartbeat
- DELETE endpoint = manual end (`end_reason: 'manual'`) — player can end anytime
- Plague/War keep internal end conditions → `end_reason: 'condition_met'`
- New endpoint `GET /api/events/history` for completed events
- Player can extend an event by reactivating with new duration (no auto-extend)

#### Phase 5 — Leader extraction + disband

New `services/leadership.service.ts`:
- `extractLeaderCuts(prisma, worldId)` — annual. Per group: `extraction = (leader.greed / 100) × 0.20 × group.balance` → leader.money increases, group.balance decreases. Members never notice (no memories, no happiness hit).
- `checkSmallGroupDisbands(prisma, worldId)` — bi-annual. For groups with `<20` members:
  ```
  disband_chance = (20 - member_count) × 0.015
  ```
  | Members | Per bi-annual | Per year |
  |---|---|---|
  | 19 | 1.5% | 3.0% |
  | 10 | 15% | 28% |
  | 5 | 22.5% | 40% |
  | 1 | 28.5% | 49% |
  Constant `SMALL_GROUP_DISBAND_RATE = 0.015` in `shared/`. On disband: leader receives full balance, members released, group soft-deleted (`disbanded_at`).
- `promoteSuccessor(prisma, groupId)` — picks highest-alignment member, sets as leader. Called from `handlePersonDeath` for any leader death — there is **always** a leader as long as the group has members.

#### Phase 6 — World snapshot + frontend

`world_snapshots.payload` (JSONB):
```ts
{
  year, bi_annual_index, population, total_deaths, recent_deaths_year,
  averages: { health, happiness, money },
  markets: { stable, standard, volatile, trends, top_event },
  religions: {
    top_by_count:    { id, name, value },  // member count
    top_by_balance:  { id, name, value },  // group treasury
    richest_leader:  { id, name, leader_name, leader_money }
  },
  factions: { ... same shape ... },
  active_events: [{ id, def_id, name, years_remaining, stats: {...} }],
  updated_at
}
```

Frontend:
- `/world` reads from snapshot — single SELECT, no aggregation
- New `/events` route: catalog grid (activate) + active list (view/end) + history list
- Heartbeat component subscribes to SSE, shows phase progress bar with per-phase status
- World View polls snapshot every 2s while pipeline running, otherwise refreshes on Advance click

#### Phase 7 — Cleanup
- Delete `/api/interactions/tick` endpoint
- Delete obsolete per-tick passes (full-population happiness UPDATE, full-population hard-stat derive)
- Rename `tick_count` → `year_count` everywhere it appears
- Update `AUDIT.md` to reflect new architecture

#### Execution order

`0 → 1 → 2 → 3 → 5 → 4 → 6 → 7`

Phase 5 before Phase 4 because leader extraction reuses the year-end pipeline slot — want it stable before adding event-timer logic on top. Phase 6 last so the frontend isn't a moving target during backend work. Each phase ships separately, gets tested at small population, then move on.

#### Decisions locked in (do not re-litigate)
- 2 bi-annuals + 1 year-end per Advance Year click
- Single year only — no "advance N years" / auto-play
- Block Advance Year button until pipeline completes
- Snapshot refresh **per bi-annual** (3× per year-advance)
- Player-direct actions (steal/gift/force) stay immediate
- Saves are out of scope for this phase
- Greed-based extraction: `(greed / 100) × 0.20`, members never notice
- Always a leader; leader = highest-alignment surviving member
- Small-group disband formula: `(20 - members) × 0.015` per bi-annual
- pg-boss for queue (Postgres-backed, no Redis)
- SSE for heartbeat (local backend, no WebSocket needed)
- DB wipe approved; no data preservation needed

**Ripple test:** Player activates a Plague with `duration=4` → year 1 bi-annual A: 12 people infected, snapshot updates → bi-annual B: 8 more infected, 2 dead, snapshot updates → year-end: aging + leader extraction (greedy religion leader skims 18% of balance into personal money) → year 2 starts, player watches plague counts climb in heartbeat → year 4 ends, plague auto-expires with `event_history` row. Player never blocks longer than ~500ms per phase.

---

### 1. Economy — Real Income Model

**Problem:** Wealth is currently meaningless as a lever. Base income is a hardcoded 20k/tick placeholder. Occupation does nothing after character creation.

**Design:**
- Replace flat 20k with occupation-derived income. Each archetype has a base income range (farmer earns little; merchant earns market-sensitive; noble earns from faction/land holdings). Scale by relevant traits (craftsmanship for artisan, cunning for merchant, leadership for noble).
- **Faction taxation.** If a faction has `cost_per_tick`, deduct wealth from all members each tick. Route that wealth to the faction treasury. Faction treasury funds faction actions (war, propaganda).
- **Theft.** High-cunning + high-street_smarts people can rob others as an interaction type. Creates crime record, wealth transfer, grudge memory.
- **Gifting/tribute.** Agentic action: high-empathy people gift wealth to struggling inner-circle members. High-ambition people demand tribute from subordinates.
- **Inheritance.** Already built. Ensure it surfaces correctly in the Chronicle.

**Ripple test:** Raise tyranny → faction dues increase → members go broke → they auto-leave the faction → faction loses membership → schism threshold drops → faction collapses.

---

### 2. Catastrophic World Events

**Problem:** War, plague, famine exist as global trait children (sliders) but nothing fires automatically. God Mode is the only way to trigger them. There are no player-instigated macro-scale events with mechanical weight.

**Design:**
- **Player-dropped events (God Mode panel).** New buttons: Drop Plague, Declare War, Trigger Famine, Nuke. Each one applies a preset delta to global traits + queues reportage-voice headlines + optionally kills N% of the population.
- **Cascade thresholds.** When a global trait child crosses a threshold, the engine auto-fires a WorldMemory entry and a reportage headline. E.g., `plague.infection_rate < -70` → "Great Plague sweeps the land" → next tick mortality rate rises automatically.
- **War between factions.** Two active factions with low alignment and high military_strength + territorial_control can enter a "war state." War ticks produce more violent interaction outcomes between opposing members. Victory condition: one faction's membership drops to 0 or one leader dies and no heir qualifies.
- **Ripple test:** Player drops a plague → mortality rate spikes → key religion founder dies → religion dissolves → members lose faith → faith.devotion drops → spiritual_comfort drops → more desperate interactions → crime surge.

---

### 3. Revenge & Legal Consequences

**Problem:** Murders create a crime record and a grudge memory in the victim's family, but nothing mechanically acts on it. There are no legal consequences beyond the crime record entry.

**Design:**
- **Revenge action.** Agentic action: if person has a grudge memory against a murderer (counterparty_id = killer), and their combat + cunning + courage clear a threshold, they attempt revenge. Revenge attempt is a forced interaction (combat-heavy outcome bands). Can kill the original murderer or fail and create a new grudge in the other direction.
- **Legal action.** If the world has a faction with `stability` role, a murder can trigger a "trial" interaction between the murderer and a faction leader. Outcome bands: execution (death), imprisonment (wealth drain + memory), acquittal (morality debuff to faction). Gate: faction must have membership > 20 and tyranny.stability > 50.
- **Blood feud.** If a family member revenge-kills, and the original murderer's family has a grudge back, flag the relationship pair as BLOOD_FEUD. Both families get interaction weight toward each other boosted. The feud can persist across generations.
- **Ripple test:** Person A murders Person B → B's child has grudge memory (weight 100) → agentic action selects revenge attempt → B's child succeeds and kills A → A's spouse now has revenge memory → blood feud flagged.

---

### 4. Chronicle & Biography Mode

**Problem:** The chronicle surfaces yearly headline cards. There's no way to read a *character's* full life story, or to see the history of a world as a flowing narrative.

**Design:**
- **Life biography.** A button on CharacterDetail (or deceased person card) that calls Claude with the character's full LifeDecadeSummary chain + significant memories. Claude returns a 3–5 paragraph narrative biography in literary voice. Cached in DB so it only generates once per character.
- **World history page.** A page that renders YearlyReports + WorldMemory entries + GroupMemory events as a flowing timeline. Decade summaries anchor each 10-year section. Filter by: force, group, person, year range.
- **Family tree.** On CharacterDetail, render a basic 3-generation tree using `parent_a_id`, `parent_b_id`, and inner-circle `child` links. Clickable to navigate to each ancestor/descendant.
- **Ripple test:** Player reads a 200-year-old character's biography. Claude threads decade summaries into a coherent arc. The reader sees how this person's trauma at age 30 shaped their later radicalization.

---

### 5. Scale — Town & Civilization Tiers

**Problem:** Tick runs synchronously in the request cycle. Works fine at intimate scale (100–500 people). At town (500–5k) it becomes slow. At civilization (5k–50k) it blocks the server.

**Design:**
- **Background tick job.** Add a `tick` job kind to the TickJob queue (same Postgres-as-queue pattern already used for headlines). POST `/api/time/advance` enqueues the tick instead of executing it synchronously. Frontend polls the job status.
- **Batched DB writes.** Replace per-person UPDATE loops with JSONB bulk SQL updates where possible. Prisma's `updateMany` where applicable; raw SQL for trait JSONB merges.
- **Per-interaction Claude calls capped.** At town/civilization scale, no per-interaction narrative. Claude calls are aggregate-only (year headlines, decade summaries). Per-interaction narrative only at intimate scale.
- **Filter-first UI.** At town/civilization scale, no scrolling card grid. People page becomes search-first: player types a name, applies filters, results surface. Dashboard shows aggregate stats, not individual cards.
- **Population cap enforcement.** 1 group per 100 people enforced server-side. Warn player when approaching tier limits.

---

### 6. Occupation as a Living System

**Problem:** Occupation is a demographic label set at character creation and never changes. It has no mechanical effect after birth.

**Design:**
- **Occupation drift.** Each tick, characters can change occupation based on trait alignment. High intelligence + curiosity → scholar drift. High combat + strength → soldier drift. High charisma + ambition → noble or faction leader track.
- **Occupation gates.** Certain interactions only available to specific occupations (priests can found religions, soldiers can commit war crimes, merchants can do trade interactions).
- **Occupation income tiers.** Noble > merchant > scholar/priest > artisan > farmer/wanderer. Modulated by world forces (Scarcity drops farmer income, War boosts soldier income).

---

### 7. Multi-City Geography

**Problem:** City schema exists (one per world) but geography has zero mechanical effect. All interactions are world-flat.

**Design:**
- This is a later-stage feature. Only build it if intimate/town-tier experience feels lacking a geography dimension.
- When built: each person belongs to a city. Antagonizer selection weights same-city people more heavily. War between factions is city-scoped. Plagues spread city-to-city.
- Pre-req: drop `@@unique(world_id)` on City, add `city_id` FK on Person.

---

## Design Rules for New Code

These apply to every new feature, every session:

- **Shared types first.** If it crosses the wire, it lives in `packages/shared/src/types.ts` before backend or frontend.
- **Verify the path.** Multiple worktrees exist. Confirm you're in `just for fun/AI GOD/packages/...` before any edit.
- **No hardcoded stat names in logic.** All effects reference stats by string from the ruleset. Missing stat = silent no-op.
- **Typecheck before done.** Both packages must pass `tsc --noEmit` before any work is declared complete.
- **Every feature needs a ripple.** If a new mechanic has no second-order effect, it is not finished.
- **Match existing patterns.** Routes → services → shared types. Don't invent new conventions. Check how an existing service does it and mirror.
- **`world_id` on everything.** Every per-world entity is scoped by `world_id`. Never leak across worlds.
- **Plan before code.** Show the implementation plan for each step before writing files. Wait for approval.
- **Don't commit** unless Sam explicitly asks.
