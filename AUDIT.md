# AI GOD — Codebase Audit

Read this file at the start of every session. It describes exactly what is built, how it works, and where the gaps are. `DESIGN.md` is the companion — it covers vision and roadmap.

---

## Stack & Structure

**Monorepo** under `packages/`:
- `packages/backend` — Express + Prisma + PostgreSQL + Anthropic SDK
- `packages/frontend` — React 18 + React Router 6 + TanStack Query + Tailwind CSS
- `packages/shared` — shared types/constants imported by both

**Dev**: `ts-node-dev` (backend), Vite (frontend). Both typecheck with `tsc --noEmit`.
**DB**: PostgreSQL via Prisma. Schema changes propagate via `prisma db push` — there is intentionally no `migrations/` directory (per §0.5 redesign Phase 0). Resetting the dev DB is `prisma migrate reset --force` followed by `db push`.
**Async pipeline**: `pg-boss` (Postgres-backed job queue) drives the year-advance pipeline. Long Claude calls (headline generation) still use the older custom `TickJob` table.
**AI**: `claude-opus-4-6` via `@anthropic-ai/sdk`, used for headline generation and God Mode AI console.

---

## Database Schema

### World
Master container. Everything scoped by `world_id`.
- `current_year`, `year_count`, `total_deaths` — `year_count` increments once per year-end phase. The legacy `tick_count` column was dropped in Phase 7 cleanup.
- `bi_annual_index` (Int, 0|1) — which half of the current year the pipeline last completed. `effectiveTick = year_count * 2 + bi_annual_index` is the canonical comparison value for tick-domain timestamps (e.g. `Pregnancy.due_tick`).
- `year_phase` — `idle` | `bi_annual_a` | `bi_annual_b` | `year_end`. Set by the pipeline as it walks each phase.
- Three-market columns: `market_index/_trend/_volatility` (standard), `market_stable_*`, `market_volatile_*`.
- `market_history` — rolling JSON, written each phase by `world_snapshots`.
- `market_highlights` — last-year top gainers/losers JSON.
- `global_traits` — current world force scores (JSONB).
- `global_trait_multipliers` — per-force effect multipliers (JSONB).
- `active_trait_categories` — which 5 categories surface in UI.
- `population_tier` — `intimate` | `town` | `civilization`.
- `is_active`, `archived_at` — only one `is_active=true` row at a time. Archived worlds are soft-deleted.
- Relations: Person, Religion, Faction, DeceasedPerson, YearlyHeadline, WorldMemory, TickJob, YearlyReport, Pregnancy, City, **WorldEvent**, **EventHistory**, **WorldSnapshot**, **YearRun**.

### WorldSnapshot
One per world (`@@unique(world_id)`). Denormalized JSON view written at every pipeline phase by `services/snapshot.service.ts`.
- `payload` — `{ year, bi_annual_index, population, total_deaths, recent_deaths_year, averages, markets, religions, factions, active_events, updated_at }`
- `/api/world` reads exclusively from this table; live aggregation is no longer done on read.

### YearRun
One row per advance-year invocation. Drives the SSE pipeline UI.
- `id` (UUID — referenced by `/api/pipeline/sse?run_id=…`)
- `phase`, `status` (`pending` | `running` | `succeeded` | `failed`), `error`, `started_at`, `finished_at`

### WorldEvent / EventHistory
Player-activated world events (war, plague, etc., capped at 6 active per world).
- `WorldEvent`: live row with `event_def_id`, `params`, `started_tick`, `started_year`, `duration_years`, `years_remaining`, `is_active`. Capacity-checked + uniqueness-checked on `POST /api/events`.
- `EventHistory`: archive row written by `endEventAndArchive()` with `end_reason` (`manual` | `expired` | `world_archived`).

### City
One per world (`@@unique(world_id)`). Placeholder for future multi-city support.
- `name`, `description`, `founded_year`

### Person
Living NPC.
- **Demographics**: age, death_age (rolled 60–95 at birth), race, gender, sexuality, occupation, relationship_status, religion (label)
- **Combat stats** *(derived each tick from BODY traits + MIND amplifier)*: `max_health` (0–100), `current_health` (0–100), `attack` (0–100), `defense` (0–100), `speed` (0–100)
- **Vitals**: trauma_score (0–100)
- **Economy**: `money` (Int, unclamped), `money_invested` (Int). `market_bucket`: `stable` | `standard` | `volatile`
- **Status**: `moral_score` (−100–100)
- **Traits**: JSONB with 16 meta-traits across 4 categories (0–100 each, neutral = 50): `body` (strength, endurance, agility, resilience), `mind` (intelligence, willpower, intuition, creativity), `heart` (charisma, empathy, loyalty, jealousy), `drive` (ambition, courage, discipline, cunning)
- **global_scores**: JSONB map of personal global force scores (e.g. `"war.morale": 45`)
- **criminal_record**: JSONB array of offense objects
- **Genealogy**: `parent_a_id`, `parent_b_id` (null for seed/injected people)
- Relations: MemoryBank, LifeDecadeSummary, InnerCircleLink, ReligionMembership, FactionMembership, Pregnancy

### Pregnancy
- Links `parent_a`, `parent_b`, world
- `started_tick`, `due_tick` (resolution point = started + PREGNANCY_DURATION_TICKS)
- `resolved` bool, `child_id` (populated on birth)
- Cascade-deletes if a parent dies

### InnerCircleLink
Directed relationship edge. `@@unique([owner_id, target_id, relation_type])`.
- `relation_type`: `parent` | `child` | `sibling` | `spouse` | `lover` | `close_friend` | `rival` | `enemy`
- `bond_strength` (0–100) — drives antagonizer pick weight, agentic action gates, grudge bonus

### MemoryBank
Per-person narrative log. Never deleted until decade compression runs.
- `event_summary`, `emotional_impact` (traumatic/negative/neutral/positive/euphoric)
- `delta_applied` — JSONB snapshot of stat changes that caused this memory
- `magnitude` (0.0–1.0) — drives trauma strength and decay tier
- `counterparty_id` — optional antagonist (used for grudge reweighting)
- `tone` — tabloid/literary/epic/reportage/neutral
- `weight` (0–100) — computed at write time, used to rank on compression
- `decade_of_life` (floor(age/10)) — for decade-scoped queries
- Indexes: `(person_id, weight)`, `(person_id, decade_of_life)`

### LifeDecadeSummary
Compressed memory archive. One row per decade per person.
- `decade_end_age`, `decade_of_life`, `world_year_start`, `world_year_end`
- `top_memories` — JSONB array of top-N MemoryBank entries by weight (intimate=10, town=5, civilization=3)
- `aggregates` — JSONB: `{ interaction_count, avg_magnitude, peak_positive, peak_negative, stat_deltas }`
- `prior_summary_id` — chains to previous decade so narration can walk a full life

### GroupMemory
Write-once group event log. Never decays.
- Polymorphic: `group_type` (`religion` | `faction`) + `group_id`
- `event_kind`: founded, first_member, schism, leader_death, war, …
- `tone` always epic. `weight` (0–100) for ranking.

### WorldMemory
World-scoped canonical events (~0–5 per year, never decay).
- Indexed by `world_year` and `weight`.

### Ruleset
JSONB blob containing full `RulesetDef`. One marked `is_active` per world.
- `rules`: interaction_types, outcome_bands, passive_drifts, capability_gates

### YearlyHeadline
AI-generated narrative entries.
- `year`, `type` (ANNUAL | DECADE), `category` (10 values), `headline`, `story`, `tone`
- `@@unique([world_id, year, type, category])` — idempotent generation

### DeceasedPerson
RIP archive. Person rows remain for genealogy traceability.
- `age_at_death`, `world_year`, `cause` (interaction | old_age | health)
- `final_health`, `final_wealth`, `peak_positive_outcome`, `peak_negative_outcome`

### Religion & Faction
Shared group entities.
- `founder_id`, `leader_id` (Faction only — Religion gets leader_id via Round 4 succession)
- `virus_profile` — JSONB trait/global-score thresholds (e.g. `{ "charisma": { "min": 60 } }`)
- `tolerance` (0–100) — band width around threshold matching
- `cost_per_tick` — wealth deducted per member per tick
- `trait_minimums` — hard attribute floors for membership
- `founded_year`, `is_active`, `dissolved_year`, `dissolved_reason`
- Faction-specific: `split_from_id` (parent faction if born from schism)
- Memberships: `ReligionMembership` / `FactionMembership` track `joined_year`, `alignment` (0–1), `split_pressure_ticks`

### TickJob
Postgres-as-queue for long-running tasks (headline generation).
- `kind`, `status` (pending/running/done/failed), `payload`, `result`
- `lock_key` (BigInt) for `pg_try_advisory_lock` single-worker claim
- `attempts`, `max_attempts`, `started_at`, `finished_at`

### YearlyReport
Deterministic numeric world summary per year.
- Population start/end, births, deaths, deaths_by_cause
- Market start/end index
- `top_swings` — JSONB top-10 stat deltas by magnitude
- `group_events`, `bulk_actions`, `force_scores`

---

## Shared Types & Constants

**Location**: `packages/shared/src/types.ts`

### Identity Attributes (16 total, 4 categories × 4)
```
body:  strength, endurance, agility, resilience    → pushes combat stats each tick
mind:  intelligence, willpower, intuition, creativity  → amplifier on all push magnitudes
heart: charisma, empathy, loyalty, jealousy         → relationship / group outcomes
drive: ambition, courage, discipline, cunning       → agentic action + economic behavior
```
All stored in `Person.traits` JSONB as 0–100 values (neutral = 50).
Hard combat stat columns (`max_health`, `current_health`, `attack`, `defense`, `speed`) derived from BODY + MIND each tick — tick derivation phase not yet built (see DESIGN.md §0).

### Global Trait System (6 forces × 4 children = 24 values)
```
scarcity:  food_supply (-100→100), water_access (-100→100), material_wealth (0→100), hoarding_pressure (-100→0)
war:       military_strength (0→100), civilian_casualties (-100→0), territorial_control (-100→100), morale (-100→100)
faith:     devotion (0→100), spiritual_comfort (0→100), zealotry (-100→0), religious_control (-100→100)
plague:    infection_rate (-100→0), mortality_rate (-100→0), medical_response (0→100), fear_contagion (-100→0)
tyranny:   oppression (-100→0), surveillance (-100→0), stability (0→100), resistance (-100→100)
discovery: technological_advancement (0→100), knowledge_spread (0→100), cultural_disruption (-100→100), scientific_heresy (-100→100)
```
Stored as `World.global_traits` (current snapshot) and `Person.global_scores` (personal resonance, seeded from world ±25).

### Ruleset Types
- **InteractionTypeDef**: `id`, `label`, `weight`, `trait_weights`, `global_amplifiers`, `can_conceive`
- **OutcomeBand**: `label`, `min_score`, `magnitude`, `subject_effect`, `antagonist_effect`, `can_die`, `creates_memory`, `creates_headline`, `tone`, `creates_group`, `creates_pregnancy`
- **EffectPacket**: `stat_delta [min,max]`, `affects_stats`, `trait_deltas` (permanent ±1–3 tweaks)
- **PassiveDriftRule**: `stat`, `base`, `inputs`, `min/max`
- **CapabilityGates**: found_religion, found_faction, agentic_murder, agentic_marry, agentic_betray, agentic_befriend, agentic_conceive

### Trauma Constants
```
TRAUMA_IMPACT_MULTIPLIER: traumatic=25, negative=6, neutral=0, positive=-3, euphoric=-10
TRAUMA_RESILIENCE_RELIEF: 0.005
TRAUMA_SCORE_PENALTY:     0.5 (subtracted from interaction score)
TRAUMA_ANNUAL_DECAY:      0.93 (7% fade per year-boundary)
TRAUMA_SCORE_MAX:         100
```

### Birth Constants
```
PREGNANCY_DURATION_TICKS: 2 (1 world year)
BIRTH_TRAIT_VARIANCE:     8 (mean of parents ± random(-8,8), clamped 0–100)
MIXED_RACE_LABEL:         'Mixed'
```

### Market Constants
```
MARKET_CEILING:        10.0
MARKET_FLOOR:          0.1
MARKET_MEAN_REVERSION: 0.005
MARKET_CRASH_RETURN:   -0.08
MARKET_BOOM_RETURN:     0.08
MARKET_BUBBLE_INDEX:    1.6
MARKET_DEPRESSION_INDEX: 0.5
```

---

## Backend Services

### simulation.service.ts
Single mutation dispatcher for all character changes.
- `applyDelta(opts)` — atomic person update + memory entry. Enforces sim rules (health clamp 0–100, age floor, wealth floor) unless `force=true`. Merges trait_overrides into JSONB.
- `applyBulkFilter(req)` — mass mutation via filter match. Separates scalar/JSONB deltas, batches by 200, clamps per-person, writes memory per person. Returns `{matched, affected, memory_entries_created}`.
- `addCriminalRecord()` — appends to criminal_record array + negative-impact memory.

### character-gen.service.ts
Procedural character generation.
- `generateCharacter(archetype?, worldGlobalTraits?)` — rolls demographics, death_age (60–95), 16 meta traits (base 20–70 + archetype TRAIT_BIASES), money per archetype range, market_bucket assignment. 10 archetypes: noble, merchant, soldier, criminal, scholar, priest, farmer, wanderer, artisan, elder. Combat stats seeded at neutral defaults (max_health=100, attack/defense/speed=50) until derivation tick phase is built.
- `generateChildCharacter(parentA, parentB, religion, worldGlobalTraits)` — 50/50 trait inheritance ±BIRTH_TRAIT_VARIANCE; Mixed race if parents differ; religion picked by virus_profile scoring.
- Name pools: 10 races × {male, female, surnames}. Mix of modern/cultural/anglicised names.

### births.service.ts
Resolves due pregnancies at tick boundaries.
- `processBirths()` — finds due pregnancies, loads both parents (skips if either dead), creates child via `generateChildCharacter`, auto-creates four InnerCircleLink family edges (bond_strength=85), writes literary-tone euphoric memories on both parents, marks pregnancy resolved. Each birth in its own `$transaction`.

### memory.service.ts
All memory-system operations (person, group, world scopes).
- `writeMemory()` / `writeMemoriesBatch()` — create MemoryBank entries, compute weight, call `applyTraumaFromMemories`.
- `computeWeight()` — 0–100: base 10 + magnitude×40 + min(30,|Δ|) + 20 if group-lifecycle + 15 if counterparty high-profile + 20 floor for death/birth/marriage/group_founded.
- `applyTraumaFromMemories()` — per-memory trauma delta = multiplier × magnitude. Aggregate per person, resilience-dampen negative only, clamp 0–100, batch UPDATE.
- `compressLifeDecade()` — on birthday where age % 10 === 0: rank memories by weight, keep top-N (intimate=10, town=5, civilization=3), create LifeDecadeSummary, delete raw rows. Chains via `prior_summary_id`.

### headlines.service.ts
Claude-powered narrative generation.
- `generateHeadlinesForYear(year, worldId)` — builds world context (active characters, notable deaths, extremes), single Claude call (opus-4-6, max 4096 tokens), parses JSON, stamps tones server-side, persists YearlyHeadline rows.
- `buildDecadeSummary()` — epic-voice decade arc from annual headlines.
- `ensureDecadeSummaries()` — walks elapsed decades, skips already-done, creates LifeDecadeSummary + YearlyHeadline[DECADE].
- Voice routing: each tone has a 2–3 sentence descriptor injected into the Claude prompt.

### time.service.ts
Active-world helper + manual rewind only. Year advancement was extracted into `year.service.ts` in §0.5 Phase 1; the legacy synchronous `advanceTime()` was removed in Phase 7 cleanup.
- `getActiveWorld()` — returns the single `is_active: true` World row, throws if none.
- `rewindTime(years)` — deletes all records from target year forward. Full rollback, dangerous.

### year.service.ts
Async year-advance pipeline (the canonical engine post §0.5). Driven by `pg-boss`. Each year is split into three phases queued sequentially:
1. **bi_annual_a** — first half-year tick: `resolveInteractionsPhase` → flush deltas → `deriveHardStats` → critical-health mortality → births → market step → snapshot write.
2. **bi_annual_b** — second half-year tick: same shape as A.
3. **year_end** — annual rollups: ageing, natural deaths, trauma decay, agentic turn, faction splits, religion conversion, market highlights, `createYearlyReport`, optional headline-job enqueue. Increments `current_year` and `year_count`; resets `bi_annual_index` to 0.
Failure of any phase marks the YearRun `failed` and aborts subsequent phases. Phase progress streams over SSE via `/api/pipeline/sse?run_id=…`. Players see a sticky heartbeat bar (`PipelineHeartbeat`).

### agentic.service.ts
Year-boundary autonomous character actions.
- `selectAgents(living, linksOf, k)` — rank by leadership + honesty_extremeness + max_bond_extremeness. Top k = min(100, 2% of population). Age gate: ≥14.
- `runAgenticActions()` — per agent, picks one edge by relation_type + bond thresholds:
  - befriend (bond 55–74): upgrade to close_friend
  - betray (bond ≥75): flip to rival/enemy
  - marry (bond ≥80): convert to spouse
  - murder (bond ≤15, morality ≤25): kill target, inherit wealth, trigger group succession
  - attempt_conception (bond ≥60, gated by ruleset): create Pregnancy row
- Writes memories + relationship deltas for every action. Returns `AgenticRunResult`.

### group-lifecycle.service.ts
Leader death, succession, splits.
- `handlePersonDeath(tx, deadId, worldId)` — for every active religion/faction the dead person led: pick heir (composite = leadership + charisma + bond_to_dead). Below `MIN_HEIR_COMPOSITE (100)` → dissolve, write traumatic faith-lost memories to all members.
- `detectAndExecuteSplits()` — year-boundary: per faction, check each member's alignment vs leader's. Sustained lead > `SPLIT_LEAD_BUFFER` for `SPLIT_PRESSURE_THRESHOLD (10)` ticks → members found new faction (`split_from_id` set), write schism group memory.

### membership.service.ts
Virus profile matching.
- `computeAlignment(personTraits, profile, tolerance)` — fraction of profile rules satisfied within tolerance band. Range [0,1].
- `viralJoinsForPair()` — on each interaction pair, check if either matches any active group's virus_profile. Return join candidates.

### group-formation.service.ts
Emergent and event-driven group spawning.
- `tryEmergentSpawn()` — when outcome band has `creates_group`, spawn religion/faction if protagonist passes capability gates.
- `deriveVirusProfile()` — snapshot founder's standout traits (≥75 or ≤25) as the virus profile.
- `generateGroupName()` — prefix + founder name or epithet.

### economy-occupation.service.ts
Wealth distribution.
- `applyMarketReturns()` — base income 20k/tick + 4k invested in person's market_bucket. Wealth Δ = 16k + 4k×(1+R). **Note: 20k base is a placeholder.**
- `distributeInheritance()` — on death, distribute wealth to children/spouse or fallback heir. Writes economic memory.

### tone.service.ts
Voice routing for Claude prompts.
- `toneForOutcomeBand()` — outcome band overrides tone; else routes by interaction type.
- `toneForHeadlineCategory()` — category → tone mapping.
- `getVoicePrompt(tone)` — returns 2–3 sentence voice descriptor injected into Claude system prompt.

### jobs.service.ts
Postgres-as-queue pattern.
- `startJobWorker()` — infinite loop claiming pending TickJobs via `pg_try_advisory_lock`. Handles retries up to `max_attempts`.
- `enqueueJob()` / `getJob()` — create/query jobs.

### cities.service.ts
Phase 7 placeholder. One City per world (enforced by `@@unique(world_id)`).
- `ensureCityForWorld()` / `getCityWithStats()`.

### relationships.service.ts
InnerCircleLink CRUD + bond updates.

### religion-dynamics.service.ts
Per-tick religion membership churn. Auto-join when alignment improves; auto-leave when it drops.

---

## Tick Phase Modules (`packages/backend/src/tick/`)

### resolve-interactions.ts
Per-protagonist interaction loop. Pure computation — no DB writes.
1. Shuffle all living persons
2. Per protagonist: pick antagonist (60% bond-weighted inner circle, 40% random)
3. Pick interaction type by weight
4. Compute score: `Σ(trait_weights × traits) + Σ(global_amplifiers × globalTraits) + grudge_bonus - trauma_penalty`
5. Find outcome band (first match, highest `min_score` wins)
6. Apply effect packets to both sides (protagonist + antagonist trait deltas)
7. Queue PendingMemory intents, Pregnancy intents, viral join candidates
8. Return accumulated intents → persistence phase flushes in one `$transaction`

### market.ts
Three-bucket market (stable / standard / volatile).
- Each tick per bucket: `noise = rand ± volatility`, `pull = (1.0 - index) × 0.005`, `return = trend + noise + pull`, `newIndex = clamp(index × (1+return), FLOOR, CEILING)`.
- Detect events: crash (return ≤ −8%), boom (return ≥ 8%), bubble (index > 1.6), depression (index < 0.5). Return-based thresholds take priority over level-based.
- Wealth application: base 20k + 4k invested in person's bucket.
- Person wealth sensitivity = `0.5 + craftsmanship/200 + cunning/200` (range 0.5–1.5).

### scoring.ts
Pure helpers: `computeScore`, `findBand`, `getEffects`, `applyEffectPacket`, `pickInteractionType`, `computeGrudgeBonus`, `emotionalImpactForMagnitude`, `invertImpact`.

---

## Backend Routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/characters` | GET, POST | List living / create one |
| `/api/characters/search` | GET | Filter-first listing (status, age, race, religion, faction, name, sort) |
| `/api/characters/:id` | GET | Full person + relationships + memberships + memories |
| `/api/characters/:id/delta` | POST | Apply PersonDelta + memory entry |
| `/api/characters/:id/criminal-record` | POST | Append crime |
| `/api/characters/bulk` | POST | Bulk summon (count + archetype) |
| `/api/world` | GET | Aggregated world snapshot (reads `WorldSnapshot.payload`; falls back to bootstrap shape if no snapshot exists). Includes flat legacy fields for back-compat. |
| `/api/time` | GET | World state + recent headlines |
| `/api/time/rewind` | POST | Delete years (dangerous rollback) |
| `/api/time/headlines` | GET | Query headlines (type, category, year range) |
| `/api/time/headlines/generate` | POST | Enqueue headline job |
| `/api/time/jobs/:id` | GET | Poll job status |
| `/api/time/reports` | GET | List YearlyReports |
| `/api/years/advance` | POST | Enqueue an async year-advance run. Returns `{ year_run_id }` for SSE attachment. |
| `/api/pipeline/sse?run_id=…` | GET (EventSource) | Server-sent stream of phase transitions for a YearRun. |
| `/api/god-mode/:id` | POST | Single-target force delta (bypasses sim rules) |
| `/api/god-mode/bulk` | POST | Bulk filter + delta |
| `/api/interactions/force` | POST | Player-direct interaction (synchronous) |
| `/api/interactions/steal` | POST | Direct theft (synchronous) |
| `/api/interactions/gift` | POST | Direct gift (synchronous) |
| `/api/religions` | CRUD | Religion management |
| `/api/factions` | CRUD | Faction management |
| `/api/worlds` | GET, POST | List / create worlds |
| `/api/worlds/:id` | GET, PATCH, DELETE | Single world ops (delete blocked while active) |
| `/api/worlds/:id/activate` | POST | Set active world (deactivates all others) |
| `/api/worlds/:id/archive` | POST | Soft-archive (blocked while active) |
| `/api/worlds/:id/unarchive` | POST | Clear `archived_at` |
| `/api/worlds/new-game` | POST | One-shot: create + activate + (optional) delete old + bulk-summon souls |
| `/api/events` | GET, POST | Active world events (cap = 6, no duplicate event_def_id) |
| `/api/events/history` | GET | Completed events |
| `/api/events/:id` | DELETE | Manual end (archives with `end_reason: 'manual'`) |
| `/api/economy` | GET | Market state + member counts per bucket |
| `/api/economy/push` | POST | Nudge market trend ±0.5% |
| `/api/economy/volatility` | PATCH | Direct set [0, 0.15] |
| `/api/economy/market/:bucket` | PATCH | Per-bucket trend / volatility / index (stable\|standard\|volatile) |
| `/api/economy/multipliers` | PATCH | Per-force effect multipliers (clamped 0–10) |
| `/api/economy/global-traits` | PATCH | Mid-game global trait child values (clamped to definition ranges) |
| `/api/rulesets` | CRUD | Ruleset management |
| `/api/rip` | GET | Deceased persons archive |

---

## Frontend Pages

| Page | What it does |
|---|---|
| **WorldView** | Unified home: pulse stats, `<TimeControls />` (advance/rewind year), bulk summon, kill, force interaction, manual event, headline generator, AI Oracle, breaking news, quick nav |
| **Souls (People)** | Filter-first directory (status/age/race/religion/faction/name/sort) |
| **CharacterDetail** | Full bio, memory timeline, relationship graph, criminal record, group memberships, decade summaries |
| **Exchange (Economy)** | Three-market view, per-bucket index/trend/volatility, history chart, top gainer/loser |
| **Chronicle (Headlines)** | Annual + decade chronicle, filterable by category |
| **Groups / Religions / Factions** | List + detail for active/dissolved groups. Virus profile, membership count, alignment stats |
| **WorldDesigner** | Multi-world manager: create / activate / archive / delete; per-world stats display |
| **RuleLibrary** | Ruleset CRUD |
| **NewCharacter** | Manual character creation (archetype, demographics, wealth) |
| **Fallen (RIP)** | Deceased persons archive |

The legacy `Dashboard.tsx`, `DirectorsConsole.tsx`, `Observatory.tsx`, and `World.tsx` pages were removed in Phase 7 cleanup; `WorldView` consolidates their functionality. The Observatory's global-trait + multiplier controls now live inline on Exchange.

### Pipeline UI components
- **`PipelineProvider`** (in `App.tsx`) — single owner of the SSE subscription. Exposes `{ running, phase, attach(runId) }` via `usePipeline()`.
- **`PipelineHeartbeat`** — sticky top bar that renders current phase progress while a YearRun is in flight.
- **`TimeControls`** — fires `POST /api/years/advance`, calls `attach(year_run_id)`, then leaves heartbeat to display progress. Rewind stays synchronous.

---

## Key Architectural Patterns

### Postgres-as-Queue
TickJob table + `pg_try_advisory_lock`. Long Claude calls (headline gen) are enqueued, frontend polls `/api/time/jobs/:id`. Prevents request timeouts.

### Immutable Memory + Decade Compression
All memories written to MemoryBank, kept until birthday. On `age % 10 === 0`: top-N by weight promoted to LifeDecadeSummary, raw rows deleted. Chains via `prior_summary_id` for full-life arc without unbounded table growth.

### Accumulated-Then-Flushed Tick
`resolveInteractionsPhase()` is pure computation. Returns accumulated intents (trait deltas, memory intents, pregnancy intents, join candidates). Persistence phase flushes everything in one atomic `$transaction`. One failure rolls back the whole year.

### Three-Market Wealth System
People assigned to stable/standard/volatile at birth by intelligence+cunning. Per-tick returns applied per bucket. Wealth sensitivity modulated by craftsmanship + cunning traits (0.5–1.5×). Crash/boom/bubble/depression events surface to the UI.

### Virus Profile Membership
Religion/Faction has a `virus_profile` JSONB with trait thresholds. `computeAlignment()` scores each person against it. Auto-join when fit crosses threshold during an interaction with a member. Auto-leave when traits drift below threshold. Groups grow and shrink as the population shifts.

### 60/40 Antagonizer Selection
60% bond-weighted pick from inner circle (relation type + bond strength), 40% random wild card. Ensures familiar drama without closing off surprise.

### Tone-Routed Narrative
Every event carries a tone (tabloid/literary/epic/reportage/neutral). `tone.service` resolves it from outcome band → interaction type → event category. Claude receives a voice descriptor prefix so narration is consistent across all surfaces.

---

## Known Gaps & Placeholders

| Gap | Location | Notes |
|---|---|---|
| **Base income is a placeholder** | `economy-occupation.service.ts` | Hard-coded 20k/tick. Should derive from occupation, world state, faction taxes |
| **No occupation-based income** | `character-gen.service.ts` | Archetype sets wealth range at birth but no ongoing occupation income model |
| **No world-scale events** | Anywhere | War, plague, famine fire globally via God Mode only — no automatic cascade system |
| **City is inert** | `cities.service.ts` | Schema exists, one per world, but geography has zero mechanical effect |
| **No inter-person wealth transfer** | — | Inheritance ✅, but no taxation, theft, gift, faction dues mechanics |
| **No trial/execution mechanic** | `agentic.service.ts` | Murders create crime records but no legal consequences beyond that |
| **Scale ≥ town unoptimized** | `year.service.ts` | Async pipeline removes request-blocking, but per-phase work still scans the full population. Intimate tier fine; town/civ tiers untested. |
| **Lazy happiness/trauma helper not built** | `services/*` | Schema has `happiness_set_tick` / `trauma_set_tick` fields per the lazy-recompute design (DESIGN.md §0.5), but `effectiveHappiness()` is not implemented yet. The full-population happiness UPDATE in `applyHappinessDrift` is left intact so behaviour does not silently break — see DESIGN.md Phase 7 note. |
| **`EconomyTickResult` is misnamed** | `services/economy.service.ts` | Internal type still says "Tick"; produced once per bi-annual phase. Cosmetic — out of scope for Phase 7 cleanup. |
| **`MarketHistoryEntry.tick` field name** | `shared/types.ts` | Field is now an x-axis sequence (per bi-annual phase write). Not renamed because backend writers still treat it as a chronological index. |
| **Market history not queryable** | — | Stored as rolling JSON but no aggregate-over-time endpoint |
| **No inter-world comparison** | — | Worlds are siloed. No cross-world statistics or narrative |
| **Agentic murder has no revenge cycle** | `agentic.service.ts` | Writes grudge memory on victim's family but no mechanic acts on it |
| **Decade market arc deferred** | `PLAN.md` Round 8 note | Would require market_index history table |
| **Tests sparse** | `tick/__tests__/` | Only market.test.ts and scoring.test.ts. No integration tests for births, trauma, faction splits |
| **Combat stat derivation built, not yet tuned** | `tick/derive-stats.ts` | Hard combat stats derive from BODY traits + MIND amplifier each tick (step 5e in the tick pipeline). Tunable constants: `BASE_PUSH_RATE=0.10`, `MIND_AMP_MIN=0.5`, `MIND_AMP_MAX=1.5`, `RECOVERY_RATE_SCALE=0.6`. Tweak as gameplay requires. |
| **Ruleset trait_weights use old trait names** | All rulesets in DB | `trait_weights` keys in active rulesets still reference old names (e.g. `combat`, `honesty`, `leadership`). These are silent no-ops. Need remapping when rulesets are edited. |
