# CLAUDE GOD — Game Design

A from-scratch redesign of the personal AI civilization sim. The previous iteration (`AI GOD`) lives next to this one; this is a clean reboot.

Read this file at the start of every session. It is the canonical design contract — vision, architecture, schema, and roadmap. There is no `AUDIT.md` yet; one will be written after the first implementation phase ships.

---

## 1. North Star

**A macro civilization sim with personal-drama zoom-in.**

The player is omnipotent. The world contains **100,000+ people** as background population, with up to **6,000 fully simulated "real" individuals** who carry personality, memory, relationships, and biographies. The other 99,000+ live as aggregate `(city, type)` buckets — a number on a row, not a person. The 6,000 real slots churn as the engine surfaces drama: a Farmer wins a war, gets promoted, lives a named life, dies, gets archived. A Noble loses her faction, demotes back into the bucket she came from, leaves a biography behind.

The player follows the world from above on a **stylized map**. Drilling into a city or a real person is one click. Time advances in **player-triggered year-clicks** (1 / 5 / 10 / until-event). Between clicks the player can edit anything, drop events, pin individuals, redirect history.

This is a private toy. No audience, no monetization. **Story prose is deferred** — the v1 engine generates only structured scores, state, and events. A Claude-narrated story layer will be added later against the existing data substrate.

---

## 2. Core Design Principles

These govern every decision about what to build and how.

1. **The simulation owns the facts.** Every outcome — births, deaths, conversions, victories — is computed by the engine. Future Claude integration narrates only what the engine has already decided.
2. **Two tiers, one world.** Aggregate `(city, type)` buckets carry the masses; real Person rows carry the named cast. The two layers stay in sync at year-end.
3. **Promotion is dramatic.** A bucket-NPC becomes "real" when something happens to them or because of them. Demotion is just as natural — when a real person stops mattering, they archive into a biography and the slot frees.
4. **Player-triggered time.** Time never advances on its own. The player clicks; the world responds.
5. **Five-page UI, map as home.** Fewest pages possible: WorldMap (home) + City + Person + Group + GodMode/Controls. Everything else folds in.
6. **Numerical first, prose later.** Every system must work end-to-end without a single Claude call. Story integration comes once the engine runs.

---

## 3. World Architecture

### 3.1 Geography

- **Single seed city in v1.** World creation produces 1 city, hard-pinned. Multi-city, dynamic founding, and destruction deferred to v2. Schema retains full `world_id` multi-city support — only seeding is single-city.
- **Abstract `(x, y)` coordinates.** No tile map, no terrain rendering. Stylized map UI (parchment / painting) renders cities as named circles at their coordinates.
- **Distance is a float.** Plague-spread, Merchant-trade weighting, war-reachability all use euclidean distance. No graph adjacency. (Mostly inert in v1's single-city world; code paths exist for v2.)
- **`region_resource` enum** per city: `farmland | coast | mountains | forest | desert | crossroads`. Biases bucket-population *seeding* at world creation. Does not modify ongoing income rates (income is flat per-type with global event modifiers — see §6).

### 3.2 Setting

Generic medieval / pre-industrial. Familiar shorthand for a story engine. Fantasy / sci-fi / modern overlays are out of scope for v1; the schema is setting-agnostic enough to retheme later.

### 3.3 Political structure

- **Cities** are spatial units.
- **Factions** are political units that overlay cities — a faction can dominate one or more cities, can lose them, can declare war.
- **Religions** are global by default; not city-bound.
- **Mayor of a city = leader of the dominant faction in that city.** Always.
- **Faction takeover triggers** (either fires): rival faction's total wealth in the city > current dominant for 5 consecutive years, OR rival faction holds ≥2/3 of city population.

---

## 4. Population Model

### 4.1 Two tiers

Layer | What it is | How it scales
--- | --- | ---
**Bucket** | `(city, type)` aggregate row holding count + averages of all per-person numeric stats + race/group/tag distributions | ~10 cities × 10 types = ~100 rows total. Trivial cost.
**Real Person** | Named individual with full state (tags, memory, bonds, biography) | Hard cap **6,000 total**. Pinned and engine-managed share one pool; pinned slots are immune to auto-churn. ~10 fields each. Sub-1s/year processing target.

The aggregate side is essentially free — bucket counts can hold millions. The real-person side is the actual budget.

### 4.2 The 10 NPC types

Each type has a distinct economic vector and event vector.

```
Farmer    — base food production, lowest income, highest population
Laborer   — urban manual work (porters, miners, builders)
Artisan   — skilled crafts (smiths, weavers, masons), market-tied
Merchant  — inter-city trade, market-volatility income
Soldier   — defenders + war fighters, faction-funded
Priest    — religion-aligned, alms-funded, drives faith spread
Scholar   — small bucket, drives discovery, founds rare groups
Noble     — leadership pool, faction-aligned, taxes farmer/laborer
Outlaw    — criminal underclass, parasitic income (theft)
Healer    — plague resistance, low population, scarcity matters
```

**Type mobility** allowed at birth (high-stat children can shift type) and at promotion (a Farmer who founds a religion can become a Priest). Soft per-city caps as ratios (e.g. Noble bucket ≤ 5% of city population). Types can be empty in a city — a city with 0 Healers takes 2× plague mortality.

> **Optional later:** layer (class, station) coupling on top of type for social mobility (peasant-farmer → freeman-merchant → gentry-scholar → noble-lord). Out of scope for v1.

### 4.3 Promotion & demotion (the 6,000 budget)

- **Hard cap 6,000 total.** No overshoot. One flat pool — pinned + engine share it.
- **2% annual engine churn target.** ~120 promotions in / ~120 demotions out per year on a full pool. Pinned slots immune to auto-churn (player pin/unpin only).
- **5-year demotion grace window.** Engine real persons can sit "no events touching them" for up to 5 years before they're eligible for demotion.

**Cap overflow rules:**
- **Player pin at cap:** API returns `400 { error: 'real_person_cap_reached', current, cap: 6000 }`. Frontend shows toast: *"At 6000-person cap. Unpin or wait for engine demotion."*
- **Engine promotion at cap:** find one demotion-eligible person (unpinned, no events 5y, no leadership, no real-spouse, no strong bonds), demote, then promote. If zero eligible, promotion is skipped this year (logged on the YearRun).

**Promotion triggers** (any one fires; runs at year-end):
1. **Event-named.** A war casualty roster, plague patient zero, murder victim — any event needing a named individual materializes from the relevant bucket.
2. **Role-bound.** Becoming a leader of any active faction or religion.
3. **Wealth percentile.** Top-5 wealthiest in any city's bucket auto-promote.
4. **Crime threshold.** Outlaws crossing a crime-count threshold against real-person targets materialize as named perpetrators.
5. **Kin-promotion.** Direct family of a real person (parent, child, spouse) auto-promotes when that real person hits any of the above.
6. **Player pin.** Player can pin any bucket-NPC (or living real person) at any time. Pinned slots persist until manual unpin.

**Demotion eligibility** (must satisfy ALL):
- Not pinned.
- Not currently leading any active group.
- Not married to a real person who's still real.
- No event has named them in the last 5 years.
- No declared bonds with strength ≥80 to other real people.

**On demote:** write `BiographyArchive` row (selective — see §10), delete live row + memory buffer + bonds.

### 4.4 Materialization (bucket → real)

Hybrid algorithm:

- **Default path:** sample from bucket distributions. Race from `race_shares`, age normal-around `avg_age`, intelligence/combat/health/etc. drawn from normal-around respective bucket averages, personality tags drawn weighted from `personality_tag_freqs`, name from race-keyed pool.
- **Promotion-time backstory:** generate 2–4 templated memory entries reflecting their bucket-life ("worked the fields of Vellsburg from age 14 to 32"; year-stamped) + 1–3 declared bonds (prefer kin, then same-city compatible age/sexuality).
- **State at materialization:** `current_health = 100` regardless of bucket avg. They were chosen because they survived. 0 state tags by default unless the promotion was event-triggered (battle promotes with `battle-veteran`, plague survival with `plague-survivor`, etc.).
- **Special path** for event-triggered roles: tighter templated archetype overrides default sampling (war hero gets `combat ≥70` floor + `battle-veteran` tag locked + dead-kin bond).

---

## 5. Real-Person Schema

```
Person {
  id, world_id, city_id, type, faction_id?, religion_id?,

  // Identity
  name, age, gender, race (10 races; mixed = "{race_a}-{race_b}"),
  sexuality (0–100, 0=fully gay, 100=fully straight),
  is_alive, death_year?, created_year,

  // Stats
  combat (0–100),
  intelligence (0–100),
  happiness (0–100),
  wealth (Int, single scalar — no cash/invested split),
  current_health (0–100),

  // Tags
  personality_tags: string[]   // 1–3 from the 8-tag list, mostly permanent
  state_tags: { tag, set_year }[]   // 0–5 from the 8-tag list, decay

  // Memory + relationships
  recent_memories: jsonb[]   // cap 10, weight-FIFO
  // declared bonds in separate Relationship table

  // Kin
  spouse_id?, mother_id?, father_id?,

  // Player control
  is_pinned: bool,
  action_queue: jsonb[]   // queued agentic actions if pinned
}
```

### 5.1 The 8 personality tags (1–3 per person, mostly permanent)

```
ambitious     — leadership bids, faction founding, war declaration
cruel         — violence, unkind action selection
kind          — generosity, peace-favoring choices
greedy        — wealth accumulation, tax raises, theft tolerance
loyal         — faction retention, low betrayal rate
vengeful      — revenge cycles, grudge persistence
charismatic   — group founding, conversion success, leadership
pious         — religion conversion, devotion, alms
```

Tags inherit at birth (50% chance per parent tag passes) + bucket-default + small random injection.

> **Tag mutation deferred.** v1 treats personality tags as permanent. Once-per-lifetime mutation rules (`kind → cruel` after sustained trauma, etc.) deferred to v1.1.

### 5.2 The 8 state tags (0–5 per person, decay)

```
grieving           — 5y fixed (recent death of kin/close bond)
traumatized        — 10y fixed (witnessed/suffered violent event)
wedded-recently    — 2y fixed
ruined             — 7y fixed (lost wealth >80% in crash/event)
windfall           — 3y fixed (gained wealth >5x in short time)
battle-veteran     — 15y fixed (survived a Battle event)
famous             — 5y fixed (named in dramatic event recently)
infamous           — 10y fixed (named perpetrator of crime/scandal)
```

Boolean carriers (not numeric intensity). Year-end scan removes expired tags. Overflow drops oldest by `set_year`.

> **Derived (not stored):** `injured` is just `current_health < 50`. `marked-for-revenge` is just "someone holds a `nemesis` bond toward you." Don't materialize these as tags — read them off the source data when needed.

### 5.3 Bucket aggregate tag frequencies

Personality tags: bucket carries `personality_tag_freqs: jsonb` with all 8 tag rates (e.g. `{ ambitious: 0.12, pious: 0.34, ... }`).
State tags: only 5 high-relevance state tags tracked at bucket level (`grieving, traumatized, ruined, windfall, infamous`). The remaining 3 (`wedded-recently, battle-veteran, famous`) are real-person only.

### 5.4 Memory

**Slim rolling buffer on Person row.** `recent_memories: jsonb[]` cap 10 entries. Weight-FIFO eviction (lowest-weight drops on overflow, not strict FIFO).

Each entry: `{ year, kind, summary, magnitude, counterparty_id?, tone }`.
- `summary` is templated text from the engine in v1 (Claude rewrites later).
- `magnitude` 0.0–1.0 drives weight + state-tag gating.
- `tone` ∈ tabloid / literary / epic / reportage / neutral — routing key for future Claude prompts.

**Decade compression.** On birthday where `age % 10 == 0`: ranked memories promoted to a `LifeDecadeSummary` row, raw entries condensed. Buffer keeps rolling. Chains via `prior_summary_id` for full-life narration.

No live `MemoryBank` table. Memory lives on the row.

### 5.5 Relationships

**Slim declared-bonds table.** `Relationship { owner_id, target_id, kind, strength (0–100), set_year }`. Five kinds: `spouse | lover | rival | ally | nemesis`. Cap 5 declared bonds per person; on overflow, lowest-strength existing bond drops with a "drifted apart" memory entry.

Kinship lives directly on Person row (`spouse_id, mother_id, father_id`) — not in this table.
Friendship is implicit via co-membership + shared memory entries, not stored.

**Promotion auto-populates** 1–3 declared bonds (prefer kin → same-city compatible peers).

---

## 6. Economy

### 6.1 Income model (flat per-type with global event modifiers)

Each type has a base annual income range. Global event state applies multipliers:
- War: −30% non-Soldier income
- Plague: −50% all income
- Famine: −70% Farmer income
- Drought: −40% Farmer + Laborer
- Boom (global market index ≥1.6): +30% Merchant + Artisan + Noble

**No per-city per-type rates** — region_resource biases population at world-gen but not income flow.

### 6.2 Wealth

Single `wealth` Int per person (and bucket `avg_wealth`). No cash/invested split. Investment is a per-year compute (see §6.4), not a persistent column.

### 6.3 Flows (income + tax + dues + theft + trade)

- **Income** — bucket-level per-capita per-year. Bulk SQL update once per year.
- **City tax** — `tax_rate %` skim from each bucket's annual income → city treasury. Slider, 0–50, player-adjustable per city. Faction leader (mayor) can also pull it via agentic action.
- **Faction dues** — `cost_per_year` per member → faction treasury. Drains member wealth (real + bucket-share weighted).
- **Theft** — Outlaw bucket extracts `theft_rate × richer-bucket-wealth` from same-city richer buckets once per year. Outlaw bucket gains some, rest "lost." Real-person Outlaws may name specific real-person victims, generating crime memory entries.
- **Trade** — Merchant bucket size in city X × wealth-differential with another city Y produces a flow `wealth_X → wealth_Y`. Merchant bucket pockets the differential. Single SQL pass over city pairs.

### 6.4 Markets (global, intelligence-driven investment)

- **One `market_index` 0–10 lives on World.** Same index for every person regardless of city.
- Each year drift: `trend (player slider on World) + volatility (random walk) + event_modifiers`.
- **Every person invests `intelligence%` of wealth annually** into the global market.
  - Real persons: own intelligence × own wealth.
  - Bucket aggregates: `avg_intelligence × avg_wealth × count`.
- Returns: `wealth += invested × (new_index / old_index − 1)`.
- High-intelligence people compound faster and lose harder. Smart Farmers can out-accumulate dumb Merchants over time.
- Boom/crash events fire on index move >0.15 in a year. Bubble/depression on sustained >2.0 or <0.5 for 3+ years.

---

## 7. Births, Deaths, Inheritance

### 7.1 Births

**Bucket layer:** annual `birth_rate` per bucket. Type-defaulted (Farmer high-birth, Soldier moderate, Healer low). Modified by city events. `count += round(count × birth_rate)` each year via bulk SQL.

**Real-person layer:** real-person couples (spouse bond OR strong lover bond) roll annual conception chance based on age + tags. 1-year pregnancy resolves to a Child row.

**Inheritance (real-person child of real-person parents):**
- Stats: each = `avg(parent_a, parent_b) + random(−8, +8)`, clamped 0–100.
- Personality tags: drawn weighted from parent tag pool (50% chance per parent tag) + small random injection.
- Race: parents' if same, else `{race_a}-{race_b}` hyphenated mixed format.
- Type: defaults to a parent's type, unless high stats qualify mobility (intelligence ≥80 → Scholar, combat ≥80 → Soldier, ambition+charisma → Noble track, etc.).

Child enters bucket count immediately (count++ on `(city, type)`). Becomes real only via promotion trigger; if both parents real, child carries `kin_promote_eligible` and auto-promotes around age 14 (or earlier on parent death).

### 7.2 Same-sex couples & adoption

Sexuality slider drives partner-selection math (probability factor `(100 − sexuality)/100` for same-sex; product of both partners' values). Same-sex pairs cannot biologically conceive.

**Adoption agentic action**: same-sex couples can claim a bucket child of their city, materializing it as their real child with `mother_id = adopter_a, father_id = adopter_b`. No biological inheritance — random + city distribution instead. Writes "claimed as their own" memory.

### 7.3 Deaths

**Bucket layer:** annual `death_rate` per bucket. Bulk SQL applies count delta.

**Real-person layer:** annual death roll per person:
```
death_chance = base(age, death_age) + (1 − current_health/100) × 0.1 + event_exposure_bonus
```
Causes: `old_age | health | event | interaction | accident`.

**On real-person death:**
- Decrement source bucket count by 1.
- Run inheritance distribution (see §7.4).
- Run group succession (faction/religion leader replacement).
- Free promotion slot.
- Archive biography (selective — see §10).

### 7.4 Inheritance distribution

On real-person death with `wealth = W`:

1. **Real spouse alive + ≥1 real children alive** → 50% to spouse, remaining 50% split equally among real children.
2. **Real spouse alive, no real children** → 100% to spouse.
3. **No real spouse, ≥1 real children** → split equally among real children.
4. **No real heirs** → 100% to dominant-faction treasury (if member) else city treasury.

**Notes:**
- Bucket-only kin do not materialize for inheritance. Wealth would just disperse — dump to treasury instead.
- If any real heir's resulting `wealth > 5× city avg_wealth`, set `windfall` state tag on that heir.
- If decedent was the leader of a faction or religion, group succession runs *before* inheritance so the new leader's treasury claim (if it applies) reflects the right group.

---

## 8. Groups (Factions + Religions)

### 8.1 Single Group table

```
Group {
  id, world_id, kind: 'faction' | 'religion',
  name, founder_id, leader_id?,
  founded_year, dissolved_year?, is_active,
  treasury (Int),
  member_count_cached (Int),    // refreshed yearly from real + bucket shares
  dominant_city_id?,

  wanted_tags: string[],         // tags the group attracts
  type_affinities: jsonb,         // { Soldier: 1.5, Noble: 1.3, ... }
  stat_floors: jsonb,             // { intelligence_min: 40, ... }
  cost_per_year (Int),

  // Faction-only (nullable for religions)
  territory_cities: int[],
  tax_rate (0–50),
  army_size (Int),
  at_war_with: int[]              // multiple simultaneous wars allowed
}
```

### 8.2 Membership representation (real FK + bucket shares)

- Person carries `faction_id?, religion_id?` FK.
- Bucket carries `religion_shares: jsonb` and `faction_shares: jsonb` — cap 5 entries each, residual implicit "unaffiliated."
- `member_count_cached` recomputed at year-end as `sum(real_FK_count) + sum(bucket.count × bucket.shares[group_id])`.

### 8.3 Lifecycle

**Join/leave (tag + type + proximity fit-score):**
- Per bucket per year: compute fit per active group as `tag_match_count × type_affinity × proximity_bonus(group's share of person's city × 1.5)`. Drift bucket share toward highest-fit group, away from lowest-fit, by ~5%/year.
- Real persons: when alternative-fit > current-fit + threshold AND current membership ≥3 years (no whiplash), switch. Writes `converted` or `defected` memory + state tag.

**Founding:**
1. **Player-only via UI** — full forms, full control.
2. **Event-emergent** — Religious Schism event → splinter religion (`wanted_tags` = modal tags of defectors). City Revolt → rebel faction (`wanted_tags` = grievance signature). Discovery → Scholar Order faction.
3. **Agentic-autonomous** — real persons with `charismatic + ambitious` + intelligence ≥60 + age ≥25 + ≥30 fitting candidates in their city can found via agentic action. ~1–3% chance per qualifying person per year.

**Dissolution:**
- Member count `<5` for 3 consecutive years, OR
- Leader dies and no member satisfies `intelligence ≥50 + tag_overlap ≥2`.
- On disband: faction territory becomes contested; treasury distributes to leader's heirs; epic-tone group memory entry.

**Auto-schism (cluster detection):**
- Each year-end, scan groups with `member_count > 100`. Compute tag-cluster decomposition (group members by primary-tag, count clusters with ≥30 members each). If ≥2 clusters AND leader's primary tag mismatches a sub-cluster's modal tag → fire Religious Schism event candidate. Subject to 10-year cascade cooldown per group.
- Same trigger applies to factions (engine treats it under the "Religious Schism" event type for simplicity).

### 8.4 Faction-specific actions (5 actions, leader-agentic + player override)

- **Declare war** — gates: `treasury > 5k + army_size > 50 + leader has [ambitious | cruel | vengeful]`.
- **Sue for peace** — gates: `leader has [pragmatic | wise | broken]` OR faction state critical (treasury <500 OR army <10).
- **Levy soldiers** — gates: `treasury > 1k + leader has [ambitious | pragmatic | paranoid]`. Spends treasury → Soldier bucket count++ in territory cities.
- **Set tax rate** — gates: `leader has [greedy | tyrannical | ambitious]` to raise; `[kind | pious | popular]` to lower.
- **Annex city** — requires takeover trigger met + `leader has [ambitious | cunning]`.

**Multiple simultaneous wars allowed** (`at_war_with[]` is an array; battles fire per active war pair).

### 8.5 Battle event (war resolution)

Each year of active war between Faction A and B spawns one **Battle event** in a contested city:
- Casualties scale to army sizes. Loser loses 5–15%, winner 2–8%.
- Promote 2–4 named real-person casualties from each side's Soldier bucket. Write biographies. Headlines tagged with battle name.
- Battle outcome roll weighted by `total_combat_score` per side (sum of bucket avg_combat × army_size + sum of real-person Soldier combat).
- Contested aggregate-only city's `dominant_faction_id` can flip on outcome.

War ends when:
- One side's `army_size = 0`, OR
- Sue-for-peace agentic action accepted by both leaders, OR
- 20-year fallback timer (mutual exhaustion peace).

---

## 9. Events

### 9.1 Activation model

- **Player drops** events via GodMode/Controls (or contextual button on city/faction).
- **Engine cascade-fires** automatically when world state crosses thresholds. Cascade events have a **10-year cooldown per condition-type per world** to prevent loops.
- **God override replaces** an existing active event of the same `event_def_id` (extends/refreshes).
- **Cap 6 active per world.** Cascade events queue if cap hit; player notified.

### 9.2 Catalog (12 event types)

```
DISASTERS (city-scoped):
  Plague           — duration condition (infected <5%); kills, plague-survivor tag
  Famine           — fixed 3y; reduces Farmer income, mortality spike
  Fire             — fixed 1y; treasury hit, Artisan/Laborer mortality
  Drought          — fixed 2y; Farmer + Laborer income reduction

CONFLICTS (faction or city-scoped):
  Faction War      — duration condition (army=0 or peace) + 20y fallback
  City Revolt      — fixed 2y unless mayor flipped early
  Siege            — duration condition (city falls or relief)
  Religious Schism — fixed 1y; spawns splinter religion

BOOMS (global or city):
  Golden Age       — fixed 5y; +happiness, income boost
  Bountiful Harvest — fixed 1y; +Farmer income, +happiness in farmland cities
  Discovery        — fixed 1y; may spawn Scholar Order faction

CATASTROPHE (global):
  Great Crash      — duration condition (markets recover); ruin tag, infamous on speculators
```

### 9.3 Cascade triggers

```
avg_happiness < 30 for 3 years         → City Revolt (worst-mood city)
market_index < 0.3 for 3 years         → Great Crash
faction share swing >50% in <5 years   → Religious Schism (dominant religion)
bucket avg_health < 40 in city         → Plague risk roll
Farmer count drops >30% in city        → Famine
```

### 9.4 Event mechanics

Each event has:
- `bucket_modifiers` — income / mortality / happiness deltas applied to affected buckets each year.
- `real_person_targets` — rules for naming N people as participants/victims (e.g. Plague kills 2–5 named real people from affected cities each year).
- `headline_emit` rules — tone-tagged future-Claude prompts.
- `end_condition` and/or `duration_years`.

Archived to `EventHistory` on end with `end_reason`: `expired | manual | condition_met | overridden`.

---

## 10. Demotion / Biography Archive

`BiographyArchive` row written when a real person dies OR is demoted. Selective:

- **Core fields** preserved: id, name, race, age_at_demote, type, personality_tags, state_tags, wealth_at_demote, kin FKs, faction/religion at demote.
- **All `LifeDecadeSummary` rows** preserved.
- **Top 5 memories** from `recent_memories` buffer (highest weight at demotion).
- **Demotion reason** + year.

Dropped: full bond history (just spouse/parents preserved on Person), full memory buffer beyond top-5, criminal record details (just `was_criminal: bool`).

Future story-mode reads from this archive to render long-life biographies.

---

## 11. Real-Person Agentic Actions

Each year-end, every alive real person rolls a chance to take one autonomous action.

### 11.1 The 4 actions

```
marry           — declare spouse bond with bonded target
murder          — kill a real-person target
found-group     — start a new faction or religion
gift            — transfer wealth to bonded target
```

> **Deferred to v1.1:** `divorce, betray, speculate, take-revenge`. The 4 above each drive a distinct subsystem (relationships, deaths, groups, economy) and are enough to generate the v1 narrative loop.

### 11.2 Selection: random weighted

- Compute weight per qualifying action: `base_weight × tag_match × state_modifier × opportunity`.
- Sum weights, weighted-random pick. If total < threshold, no action (passive year).

### 11.3 Frequency: variable by tag/age

Base chance to act per year scales by:
- Tags: `ambitious +15%`, `cunning +10%`, `vengeful +10%`, `lazy −10%`, `stoic −5%`
- Age: 18–40 → +5%; 40–65 → 0; 65+ → −10%
- State tags: `grieving −20%`, `traumatized −10%`, `windfall +10%`, `ruined +5%`

Floor 5%, ceiling 50%. Population avg ~15%/year ≈ ~900 actions/year on a full 6k real population.

### 11.4 Player override: action queue per pinned person

- Pinned person carries `action_queue: jsonb[]` on Person row.
- Each entry: `{ action_type, target_id?, params?, scheduled_year, status }`.
- At year-end, queued actions for that year fire BEFORE engine-rolled actions.
- If gates fail (target dead, etc.), action fails gracefully + writes a memory entry.

### 11.5 Resolution

- Randomize all eligible real persons each year-end; process in random order. State mutates immediately; subsequent actions see updated state.
- Action conflicts (mutual murder, etc.): higher-combat wins, lower dies.
- Every successful action writes memory entries on protagonist and target with appropriate tone.

---

## 12. Bucket Aggregate Schema

```
Bucket {
  city_id (FK), type (enum: 10 types),    // composite PK (city_id, type)
  count (Int),

  // Demographics
  avg_age (Float), birth_rate (Float), death_rate (Float),
  race_shares: jsonb,                      // 10-race distribution

  // Stat averages (mirror Person numeric fields)
  avg_wealth (Int),
  avg_intelligence (Float),
  avg_combat (Float),
  avg_health (Float),
  avg_happiness (Float),
  avg_sexuality (Float),

  // Group affiliations
  religion_shares: jsonb,                  // max 5 entries
  faction_shares: jsonb,                   // max 5 entries

  // Tag frequencies
  personality_tag_freqs: jsonb,            // 16 entries
  state_tag_freqs: jsonb                   // ~5 high-relevance state tags only
}
```

**Update cadence:** year-end batch SQL pass. Random walk on averages (±0.5/year on most stats), bounded by stat min/max, plus event modifiers when active.

**Count source of truth:** bucket count is canonical. Real persons are checked-out members. Materialize → no count change. Die → decrement. Migrate → decrement source, increment dest.

**Floors:** count <5 = vestigial (skip most ops). Count = 0 = placeholder (city remembers the type slot exists).

---

## 13. City Schema

```
City {
  id, world_id, name, x, y, founded_year, is_ruined,

  // Snapshot rollups (year-end refresh)
  population_total, avg_wealth,
  mood_score (avg residents' happiness across real + bucket),
  dominant_faction_id?, dominant_religion_id?,

  // Permanent identity
  region_resource (enum: farmland | coast | mountains | forest | desert | crossroads),

  // Governance (Fork D from Q13)
  defense_rating (0–100),
  treasury (Int),
  mayor_id? (FK to Person, = leader of dominant faction),
  tax_rate (0–50, slider),
  garrison_size (Int),

  // Race relations (field exists; mechanic deferred — see §14.3)
  prejudice_level (0–100, default 0, inert in v1)
}

> **Market lives on World, not City.** v1 uses a single global `market_index` (see §6.4); per-city markets deferred.
```

---

## 14. Race & Sexuality

### 14.1 The 10 races

```
Caucasian, African American, East Asian, South Asian, Southeast Asian,
Hispanic/Latino, Native American, Middle Eastern,
Indigenous Australian, Polynesian
```

### 14.2 Mixed race

Format: `{race_a}-{race_b}` ordered alphabetically for canonicalization (e.g. `Caucasian-Hispanic/Latino`).

Three-way mixed (mixed parent × pure parent) caps at two-component (drop the lower-share component when re-mixing).

Name pool blending: each name picked atomically from one of the two parent race pools (50/50 of the two). Names themselves not blended within.

### 14.3 Prejudice mechanic — DEFERRED to v1.1

> **v1 ships with the entire prejudice subsystem disabled.** `City.prejudice_level` exists as a field (default 0) but no logic reads or writes it. No `prejudiced`/`tolerant` state tags. No cross-race interaction penalties. No `persecuted` / `harmonized` events.
>
> When unlocked in v1.1, the mechanic will work as: per-city prejudice level → spawn rate of `prejudiced`/`tolerant` state tags on residents → cross-race interaction penalties (conflict ↑, lover/spouse bonds ↓) → rare race-targeted events. Schema is forward-compatible.

### 14.4 Sexuality slider (single 0–100)

- 0 = fully gay, 100 = fully straight.
- Set at birth via small parent inheritance + larger random spread (mostly random, not heavily heritable).
- Partner selection math: same-sex pair multiplier = `(100 − sexuality)/100`; opposite-sex = `sexuality/100`. Both partners' values multiplied. Two near-50s pair freely; a 100 + 0 pair never form a bond.

### 14.5 Same-sex consequence (opt-in)

World-level toggle `prejudice_against_same_sex: bool`, default OFF. When ON, open same-sex partnerships in cities with `prejudice_level > 70` automatically generate `infamous` state tag; player God-Mode-dropped persecution events can exile or execute.

---

## 15. Time, Player Loop, Pipeline

### 15.1 Click-to-advance

- **Configurable per click:** 1 / 5 / 10 / until-event years. Default 1.
- **Single-phase year** internally. All work in one async phase per year.
- **Multi-year clicks** loop year-phase N times with one snapshot per year.
- **Until-event** loops up to a 50-year hard cap until a `notable_event` flag is set.

### 15.2 Async pipeline (pg-boss + SSE)

- `POST /api/years/advance` enqueues a `pg-boss` job, returns `{ year_run_id }`.
- Worker `processYearJob(yearId)` runs the year-phase pipeline.
- SSE endpoint `GET /api/pipeline/sse?run_id=...` streams progress (heartbeat).
- Frontend `Advance Year` button blocks until status = completed.
- **Active editing between clicks** (God Mode, edit person, drop event, pin/unpin) resolves immediately and synchronously.

### 15.2.1 Determinism (seeded RNG)

- Each `YearRun` carries `random_seed: BigInt` (generated at enqueue or supplied for replay).
- All randomness in the year-phase pipeline flows through a single seeded PRNG (e.g. `seedrandom`) keyed by `(world_id, year, random_seed)`.
- A given `(world_state, random_seed)` reproduces the same year deterministically. This is the debugging contract — "why did Vellsburg fall in 1247" can be re-played by re-running with the original seed.
- Active edits between clicks (God Mode mutations) are not seeded — they're player choices, not engine rolls.

### 15.3 Year-phase order (within a single year)

1. Resolve interactions (sample-K real-person pairs — see §15.4)
2. Apply interaction outcomes (state mutations, memory writes, bonds)
3. Bucket dynamics (income, taxes, dues, theft, trade)
4. Market step (global index drift; investment returns)
5. Births (bucket-rate + real-person pregnancy resolution)
6. Deaths (bucket-rate + real-person death rolls + inheritance + succession)
7. Events tick (active events apply modifiers, condition-checks)
8. Cascade trigger evaluation (fires new events if thresholds crossed)
9. Group lifecycle (membership drift, schism detection, dissolution checks)
10. Agentic actions (queued first if pinned, then random-weighted engine actions)
11. Tag decay + promotion/demotion churn (top 2% in / bottom 2% out of engine slots)
12. Snapshot write (denormalized world payload for fast reads)
13. Year increment + emit SSE complete event

### 15.4 Interactions (year-phase step 1, in detail)

Background-noise generator for drama between real people. Big drama still routes through events + agentic actions; interactions add texture and bond drift.

**Volume.** `K = min(N_real² × 0.001, 100)` interactions per year. Examples: 100 real people → 10/yr; 1000 → 100/yr (capped); 6000 → 100/yr (capped).

**Pair selection.**
- **Initiator:** weighted-random over all alive real persons. `activity_score`:
  - Base 1.0
  - +2.0 if `ambitious`, +2.0 if `cruel`, +1.5 if `charismatic`, +1.5 if `vengeful`
  - ×0.5 if age <18 or >65
- **Target:** weighted-random over all *other* alive real persons.
  - Base weight `1 / (distance + 1)` (mostly inert in v1's single city; same-city pairs all tie at 1.0)
  - ×5 if same city
  - ×10 if existing `Relationship` row between initiator and target

**Outcome roll** (chosen by initiator's dominant tag):

| Type | Trigger tags | Effect | Memory tone |
|---|---|---|---|
| `friendly` | `kind`, `loyal`, `charismatic`, `pious` | Bond +10; create `ally` bond if none | neutral |
| `hostile` | `cruel`, `vengeful`, `greedy` | Bond −10 → may flip to `rival`; if `combat_initiator > combat_target`, target `current_health −= 10–30` (death routes through normal death pipeline) | tabloid |
| `romantic` | gated by mutual sexuality compatibility (`§14.4` math) | Bond +15; create `lover` bond if none | literary |
| `transactional` | `greedy`, `ambitious` | Wealth transfer 1–5%: richer → poorer if initiator is `kind`/`loyal`/`pious`; reverse if `cruel`/`greedy` | reportage |

If initiator has no matching tag for any type, fall back to `friendly`.

**Resolution.**
- One memory entry written per side (so two writes per interaction).
- Bond updates obey the 5-bond cap (§5.5); overflow drops lowest-strength.
- Conflicts (e.g. mutual-murder via overlap with agentic actions) are not possible — interactions resolve before agentic actions in the year-phase order (§15.3 step 1 vs step 10).

---

## 16. UI

### 16.1 Five pages

1. **WorldMap (home)** — stylized parchment-styled map. Cities as named circles at `(x, y)`; size = log(population); border color = dominant faction; inner color = dominant religion; active-event icons overlaid; faint colored haze for faction territory. Click a city → city page. Top stats panel: year, population, market avg, mood avg.
2. **City detail** — population breakdown by bucket, real residents list, dominant faction/religion, treasury, **tax rate slider**, mood score, active events affecting this city, region_resource, mayor card. (Prejudice slider deferred with the §14.3 mechanic; global market_index history shown on WorldMap top stats panel.)
3. **Person detail** — full bio (data only in v1; future Claude prose), tags (personality + state), stats, relationships (declared bonds list), recent_memories buffer, decade summaries, family tree (3 generations), pin/unpin button, action queue editor (when pinned).
4. **Group detail (faction or religion)** — leader, founder, members (real list + bucket-share map), territory if faction, treasury, wanted_tags, member_count history chart, war state if at war, schism risk indicator.
5. **GodMode/Controls** — bulk character ops, force interaction, drop event (event catalog + active event list + history archive), bulk summon, world-trait nudge, world settings, race/sexuality world flags, ruleset CRUD.

### 16.2 Navigation

- **Map-as-home + drill-down.** WorldMap is the landing page. Sidebar shows nav links to GodMode/Controls + Settings sub-pages. Person/City/Group detail reached via map click or top search bar.
- **Floating control panel** bottom-right: advance button + dropdown (1/5/10/until-event) + heartbeat bar that fills during year run. Always visible.
- **Top search bar** finds Person / City / Group by name. Critical at 6k real people.
- **Cap-reached toast.** When pinning fails because real-person cap is full, show: *"At 6000-person cap. Unpin or wait for engine demotion."* Triggered by API response `{ error: 'real_person_cap_reached' }` (see §4.3).

### 16.3 Visuals

- **Map tech: SVG + React.** Declarative, Tailwind-friendly, fine for 1–15 named circles on a parchment background. No Canvas/Pixi deps. `framer-motion` optional for hover and event-pulse animations. Swap to Canvas later only if perf warrants.
- Static stylized map (no terrain rendering).
- Faction colors auto-assigned from a 12-color palette at founding.
- Tailwind dark palette inherited from prior project's grimoire theme; tweak per session.

---

## 17. Story Mode (Deferred)

Claude integration is deferred. v1 ships with structured data only:
- Memory entries store templated/empty summaries.
- Headlines generation deferred (data substrate exists; no Claude calls).
- Decade biographies stored as structured `LifeDecadeSummary` rows; future Claude reads them.
- Tone fields preserved on memories/events as routing keys.
- AI Oracle / God Mode console deferred.

When story mode is added in a later phase, it will:
- Use `claude-haiku-4-5` for high-volume per-event + per-year batch narration.
- Use `claude-opus-4-6` for low-volume biographies + AI Oracle.
- Async via pg-boss with SSE for "headline ready" events.

---

## 18. Build Phases (Roadmap)

The build runs in numbered phases. Each phase ships independently and is tested at small population (1 city, 100 bucket population, 0–10 real people) before moving on.

```
Phase 1  — Schema (Prisma) + shared types
Phase 2  — World creation + cities + buckets seeded
Phase 3  — Year-advance pipeline shell (pg-boss + SSE + single-phase year)
Phase 4  — Bucket dynamics (births / deaths / income / drift) at aggregate level only — no real people yet
Phase 5  — Real persons + materialization + promotion/demotion
Phase 6  — Tags + memory + relationships
Phase 7  — Groups (factions + religions) + membership + lifecycle
Phase 8  — Events catalog + cascades
Phase 9  — Agentic actions (8 actions, weighted random, action queue)
Phase 10 — Economy flows (theft, trade, market investment)
Phase 11 — Frontend UI (5 pages)
Phase 12 — God Mode controls
```

Each phase has its own tasks, test bar, and acceptance gate. Sam picks one phase at a time to work on.

---

## 19. Design Rules for New Code

- **Shared types first.** If it crosses the wire, it lives in `packages/shared/src/types.ts` before backend or frontend.
- **Verify the path.** Multiple worktrees exist. Confirm you're in `just for fun/CLAUDE GOD/packages/...` before any edit.
- **Boolean tags, not numeric scores.** No reintroducing the old 16-trait JSONB intensity system.
- **Aggregate-first.** Operations on the 100k population must be bulk SQL on bucket rows. Never iterate per-person across 100k.
- **Two tiers stay in sync.** Real-person death decrements bucket count. Real-person birth enters bucket count. Migration moves between buckets. Promotion does not change count.
- **Typecheck before done.** Both packages must pass `tsc --noEmit` before any work is declared complete.
- **Match existing patterns.** Routes → services → shared types. Don't invent new conventions.
- **`world_id` on everything.** Every per-world entity is scoped by `world_id`. Never leak across worlds.
- **Plan before code.** Show the implementation plan for each phase step before writing files. Wait for approval.
- **Don't commit** unless Sam explicitly asks.

---

## 20. Test Strategy

Each phase ships its own test file under `packages/backend/test/phase-N/`. Tests are kept around as the long-term debugging harness — when something looks wrong years later, the existing tests are the first place to add a regression case.

### 20.1 Always-on invariants suite

Runs after every phase (and as part of any year-advance smoke test). Failure is a hard stop.

- **Wealth conservation.** Income, tax, dues, theft, trade, and inheritance only redistribute money. Total world wealth changes only via explicit event modifiers and market returns. Track delta per year; assert reconciliation.
- **Bucket count integrity.** `(real-deaths) − (real-births) − (materializations) + (demotions)` reconciles against bucket count delta. Materialize and demote do *not* change count.
- **No negatives.** `count, wealth, current_health, market_index, treasury, army_size ≥ 0` at end of every year.
- **Real-person cap.** Total alive real persons ≤ 6000 at all times.
- **`world_id` containment.** No FK ever crosses worlds.

### 20.2 Phase-specific tests

| Phase | Tests |
|---|---|
| **P1 — Schema + types** | `tsc --noEmit` clean both packages. `prisma migrate` runs and reverses cleanly. Schema introspection matches shared types. |
| **P2 — World + city + buckets** | World-seed snapshot test (single city, 10 buckets). Race-share distributions match config ±2%. region_resource bias produces expected farmer/coast skew. |
| **P3 — Pipeline shell** | Enqueue → SSE complete fires. Year increments by 1. Idempotent under double-click (second click rejected or coalesced, never double-advances). YearRun row carries random_seed. |
| **P4 — Bucket dynamics** | 50-year smoke at 1 city / 1000 bucket pop. Birth and death rates bound to expected ranges. Tax flow conserves money. Invariants suite green every year. |
| **P5 — Real persons + churn** | 100-year run with full promotion/demotion churn. Cap stays at 6000 ±0. No orphaned biographies. Player-pin cap-overflow returns 400. |
| **P6 — Tags + memory + bonds** | State-tag decay timing exact-year correct. Memory FIFO eviction by weight (not arrival order). Bond cap enforced. |
| **P7 — Groups** | Membership drift converges toward best-fit group. Schism cooldown blocks re-fire within 10 years. Dissolution triggers fire on member-count and leader-loss. |
| **P8 — Events + cascades** | Each of 12 events: start, tick, end conditions. Cascade triggers fire on threshold; cooldown enforced. Cap-6 active queues correctly. |
| **P9 — Agentic actions** | 4 actions: gates correct. Weighted-random distribution within ±5% over 10k samples. Action queue fires before engine rolls. |
| **P10 — Economy flows** | Market index drift bounded. Investment math conservation (returns equal sum of others' losses). Theft and trade redistribute only. |
| **P11 — Frontend UI** | Component snapshots per page. Map renders 1 city at correct `(x, y)`. Cap-reached toast renders on simulated 400. |
| **P12 — God Mode** | Each god-mode endpoint hit with valid + invalid payloads. Error states (cap, missing target, invalid event) render correctly. |

### 20.3 Determinism harness

A small helper `test/helpers/replay.ts` runs `(world_seed, year_count)` and asserts the resulting world state hashes identically across runs. Used as a guard against any introduced non-determinism (`Math.random()` slipping in, `Date.now()` poisoning a roll, unstable iteration order).
