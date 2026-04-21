# AI GOD — Design Doc

**Status:** Design locked in via interview on 2026-04-21. Pre-implementation. This doc is the source of truth for what the game should become; where existing code diverges, code will be refactored to match this.

---

## 1. North Star

**Full control + unforeseen repercussions.**

The player is omnipotent — every lever is exposed, every person is editable, every rule is swappable. But the simulation must be chaotic enough to surprise even its creator. Every deliberate action should produce at least one second-order effect the player didn't explicitly request.

This is a private toy. There is no audience, no monetization, no multiplayer. It is a personal AI story engine disguised as a civilization sim.

---

## 2. Purpose & Vision

- **What it is:** A personal sandbox for generating AI-authored life stories. Watch characters and groups rise and fall, manipulate the world's underlying forces, dive in and co-author any arc that grabs you.
- **What it feels like:** Dramatic rises and falls — child prodigy becomes moon contractor becomes meth addict in a ditch. Burning it all down with nukes. Thriving societies. Rival families. Religious wars. All emergent from system interaction, all surfaced as narrative.
- **What's unique:** Every other civ/sim game simulates systems. This simulates *lives*, narrated by Claude, fully under the player's authorial control.
- **Multi-world:** A world designer lets the player pick which global rules are active per world. Different worlds = different engines = different kinds of stories.

---

## 3. Player Role

The player is a **director**, not a passive observer or pure interventionist.

- **Ticks are player-triggered.** Time does not advance on its own. Run 1 tick, mess around, run 10 more, dive into a character, run 100 more.
- **Typical flow:** Sim surfaces interesting people via headlines → player zooms in → player edits stats, adds custom history, forces a specific interaction → sim runs forward from the new state.
- **God Mode powers:**
  - Edit any stat on any person
  - Apply deltas with a written event summary (becomes a memory entry)
  - Add criminal records
  - Bulk filter-based actions (e.g. "everyone under 10 gets +100k wealth")
  - Force a specific interaction between two specific people
  - Create groups manually with hand-authored virus profiles
  - Dissolve groups
  - Drop nuke-style catastrophic events

---

## 4. The Person Model

Each person has three layers:

### 4.1 Demographics (fixed facts)

| Field | Notes |
|---|---|
| Name | String |
| Current age | Int |
| Death age | Rolled at birth from race-based lifespan. Natural cap — person can die earlier. |
| Race | Label; determines lifespan |
| Gender | Label |
| Sexuality | Label |
| Occupation | Label; influences some interactions |
| Religion | Label; empty/None allowed |
| Net worth | Float, unbounded |
| Family/household status | Label |

In this world, science has advanced enough that **anyone can conceive a child with anyone at any age.** No biological gating on reproduction.

### 4.2 Identity Attributes (25 total, all 0-100, constant across rule swaps)

| Category | Attributes |
|---|---|
| Physical | beauty, health, strength, endurance, agility |
| Mental | intelligence, creativity, memory, curiosity, cunning |
| Social | charisma, empathy, humor, leadership, persuasion |
| Character | ambition, discipline, honesty, courage, resilience |
| Skills | combat, craftsmanship, artistry, street_smarts, survival |

These change slowly over life based on accumulated interaction outcomes and trauma/triumph memories.

### 4.3 World-Rule Traits (8 per active rule)

Each active world rule attaches 8 personal resonance traits. These represent how much of that force lives in the individual. They are dynamic — interactions and world events push them up and down.

| World scale | Active rules | Total person traits |
|---|---|---|
| Minimal | 4 | 62 (10 demo + 25 ID + 32 rule) |
| Standard | 6 | 78 |
| Complex | 8 | 94 |

Practical upper bound: ~10 active rules before a person sheet becomes unreadable.

### 4.4 Other person-attached data

- **Memory bank** — log of significant events with emotional valence and optional per-person tags
- **Criminal record** — JSONB array of offenses
- **Inner circle** — list of linked people with relationship type (parent, child, sibling, spouse, lover, close friend, rival, enemy) and bond strength (0-100)
- **Group memberships** — religion, political faction, etc.

---

## 5. World Forces & Engines

### 5.1 Structure

Each world rule (force) has:
- A composite score (0-100), computed by normalizing and averaging its children
- 4 children with typed ranges (always-negative, bipolar, always-positive)
- An effect multiplier (player dial, default 1×)

### 5.2 Force engine layers

**Layer 1 — Composite score = reach.** Determines how many people the engine touches per tick. Low (0-30): only a few. High (70-100): everyone.

**Layer 2 — Children = what fires.** Each child has threshold-gated effects defined in the ruleset JSON. Two worlds with the same composite score can feel completely different depending on which children are elevated.

**Layer 3 — Effect multiplier = player amplification.** Cranks the whole engine regardless of children.

### 5.3 Data-driven principle

**The ruleset IS the engine.** No stat names are hardcoded in application logic. Effects reference stats by string. If a stat doesn't exist on a person, the effect is a silent no-op. This lets the player swap entire trait systems per world without breaking the engine.

### 5.4 Rule library

Rules are first-class reusable entities. The player maintains a library. Each world picks 4-8 active rules from the library. Rules can be edited, cloned, or authored from scratch.

---

## 6. Interactions

### 6.1 Loop

Every living person runs exactly **1 interaction per tick as the subject**, paired with an antagonizer.

### 6.2 Antagonizer selection

**60/40 hybrid weighting:**
- 60% weighted toward the subject's connections (inner circle, same group, rivals)
- 40% random wild card

### 6.3 Scoring

Only the **subject's traits** + **world force amplifiers** determine the outcome score. The antagonizer does not fight back mechanically — they just react to whatever happens.

Score maps to an outcome band (e.g. Triumph, Setback, Death) defined in the ruleset.

### 6.4 Asymmetric outcomes

Each outcome band produces **two effect packets** — one for the subject, one for the antagonizer — and world rules can modify each side independently.

Example: high Tyranny → subjects gain more from their interactions, antagonizers suffer more. High Faith → both parties get morality boosts regardless of outcome.

### 6.5 Tick = half a year

2 ticks = 1 world year. Age advances accordingly.

---

## 7. Groups

### 7.1 Group types

1. **Families / inner circle** — not a shared entity. Per-person list of linked relationships (blood + lovers + close friends + rivals + enemies). Bond strength floats with every interaction.
2. **Religions** — shared entities. Die when founder dies.
3. **Political factions** — shared entities. Can split under specific conditions.

### 7.2 Viral membership

Each religion and faction carries a **virus profile** — a set of trait thresholds that define who belongs.

```
Example:
Church of the Iron Sun:
  devotion: ≥ 60
  personal_faith_score: ≥ 70
  honesty: ≥ 40
```

**Spread:** When the antagonizer is a group member and the subject meets the virus profile, the subject joins.

**Drop-off:** Every tick, existing members whose traits have drifted out of the profile auto-leave.

Membership is always a living count — it rises and falls with the population's trait drift.

### 7.3 Virus profile origins

- **Emergent groups:** snapshot of the founder's traits at founding (+tunable tolerance band)
- **Player-created groups:** manually authored profile
- Both allowed in the same world.

### 7.4 Group formation

Three paths, with emergent as the spine:

1. **Emergent** (default) — when a person clears capability gates AND a dramatic event fires (high-score outcome in a relevant interaction), a new group is born. Claude names it and writes a founding headline.
2. **Player-created** via God Mode
3. **Event-driven** — specific ruleset interactions (schism, revelation, manifesto) can force a new group

### 7.5 Caps

Maximum **1 group per 100 people**, per group type (religions and factions counted separately).

### 7.6 Lifecycle

- **Religions** die instantly when the founder dies. (Personality cult; a fragile and deliberately fragile institution — assassinate the prophet, you kill the faith.)
- **Factions** survive past their leader's death if a worthy successor exists (passes leadership capability gate).
- **Splits** happen when a member's trait alignment with the group's virus profile exceeds the current leader's alignment by enough to overcome the **founder buffer bonus** (+20-30 alignment points), sustained for **5 years (10 ticks)**.

---

## 8. Capability Gates

Role and action eligibility thresholds. Defined per-rule in the ruleset JSON.

| Action | Example gate |
|---|---|
| Found a religion | leadership ≥ 70 + persuasion ≥ 70 + personal Faith score ≥ 80 + dramatic event |
| Found a faction | leadership ≥ 70 + ambition ≥ 70 + dramatic event |
| Lead a group | leadership ≥ 60 + charisma ≥ 60 |
| Challenge a leader | leadership ≥ current leader's leadership |
| Commit assassination | cunning ≥ 70 + combat ≥ 60 |
| Prophet-level fervor | devotion ≥ 90 + charisma ≥ 80 |

Gates are tunable per world.

---

## 9. Births

### 9.1 Trigger

**Interaction-driven only.** A specific "conception" interaction type between two people can initiate pregnancy, tracked over ticks until birth.

No random sim-seeded births for population upkeep; if population dips too low, the player can manually inject new people.

### 9.2 Eligibility

- Any age
- Any pairing
- Partners need not be in a formal relationship (bastards and affairs are in scope)

### 9.3 Inheritance

- **Traits:** 50% average of the two parents + variance
- **Race:** mixed if parents differ
- **Religion:** inherits from parents at birth (can drift out later via virus profile drift)
- **Family/inner-circle links:** auto-created for both parents

---

## 10. Memory System

### 10.1 Feedback loops

Two layers, both active:

1. **Trauma-modifier** — traumatic memories apply small permanent trait debuffs; euphoric memories apply buffs. Accumulating memory shifts who a person is over time.
2. **Relationship-weighted** — memories tagged with the involved antagonizer reweight future interaction scoring when those two people meet again. Grudges, loyalty, debts, crushes.

### 10.2 Persistence

**Memory length scales with outcome magnitude.** Extreme events (top/bottom outcome bands) persist for life; mid-band events fade over time. Only the big stuff echoes forward.

---

## 11. Tone & Narrative

### 11.1 Voice routing

Claude's voice flexes by event type. Each outcome band and event type carries a `tone` field.

| Event type | Voice |
|---|---|
| Personal scandals, rises/falls, addictions, affairs | Tabloid |
| Deaths, births, quiet personal moments | Literary |
| Group events (religion founded, faction split, war) | Epic |
| Bulk-effect chaos (plague, nukes, crashes) | Reportage |
| Decade summaries | Epic |

### 11.2 Content ceiling

**Fully unflinching.** Overdose, torture, assassination, abuse, sexual violence are rendered directly when the narrative calls for it. No gratuitous horror, but no squeamish euphemism either.

---

## 12. Scale

Scale is a **dial, not a bet.** Each world picks its tier at creation.

| Tier | Population | Feel |
|---|---|---|
| Intimate | 100-500 | Every person trackable; current experience |
| Town | 500-5,000 | Pagination required, personal but noisy |
| Civilization | 5,000-50,000 | Macro view primary, dive into individuals via filters |

### 12.1 What 50k requires

1. Batched DB writes — no per-person UPDATEs
2. Tick processing in background jobs, not request cycle
3. Claude API calls are strictly aggregate — no per-interaction calls
4. Filter-first UI — no scrolling 50k cards
5. Player experience shifts: you're watching *culture* emerge, not tracking 50k individuals

---

## 13. Economy / Market

Existing: market index, trend, volatility, affected by force multipliers. Keep.

**Gap:** Wealth flow between people. Currently the only wealth delta source is interaction outcomes. Consider: inheritance at death, taxation (if a faction runs it), theft/gift interactions, faction dues. Flagged for later.

---

## 14. The Second-Order Effect Rule

**Every player action must have at least one emergent ripple the player didn't explicitly request.** This is what makes full control still feel surprising. Examples of ripples built into the architecture:

- **Memory echoes:** You assassinate someone. Their child's grudge memory reweights every future interaction involving the killer's bloodline.
- **Viral group drift:** You buff a person's charisma. They found a religion. Its virus profile infects people you never looked at. 30 ticks later a splinter faction is terrorizing a city.
- **Trait cascades:** Crank Scarcity → desperate crime → trauma memories → shifted traits → shifted group memberships → reshaped ideology.
- **Antagonizer randomness:** The 40% wild-card pairing disrupts any setup with an outsider you didn't plan for.

When adding new systems, ask: *what's the ripple?* If an action has zero second-order effects, it's not finished.

---

# Next Steps

A prioritized starting sequence. Each step is a discrete chunk of work with visible output.

### Phase 0 — Align existing code with this doc

1. **Audit current schema vs doc.** Map current DB tables and fields to the person model in §4. Flag every mismatch (wrong attribute names, missing demographics, extra stats). This is the refactor budget.
2. **Pull `death_age` into Person.** Roll at birth from race lifespan. Drive natural death off this instead of age-only checks.
3. **Collapse 100 traits to 25 identity attributes.** Replace the current 25-category trait block with §4.2. Keep the 24 world-rule values as-is for now.
4. **Make the engine fully data-driven.** Remove any hardcoded stat references from interaction resolution code. All effects must look up stats by string from the ruleset, silently skipping missing ones.

### Phase 1 — Core loop upgrades

5. **Antagonizer selection with 60/40 hybrid.** Implement the inner-circle link table first, then the weighted picker.
6. **Asymmetric outcomes.** Every interaction outcome band gets two effect packets. Extend the ruleset schema and resolution code.
7. **Memory persistence scaling.** Tag memories by outcome magnitude, add decay logic to the memory reader so mid-band events fade.
8. **Memory feedback — trauma modifier + grudge weighting.** Trauma memories permanently shift traits; per-person memories reweight future pairings.

### Phase 2 — Groups

9. **Religion & Faction entities.** Schema, CRUD, virus profile storage.
10. **Viral membership engine.** Tick-time join check (antagonizer is member + subject meets profile) and drop-off check (existing members drift out).
11. **Group formation.** Emergent (capability gate + dramatic event) + player-created (God Mode) + event-driven (ruleset interaction).
12. **Religion-founder death handler.** Leader dies → religion dies → all members get a "faith lost" memory.
13. **Faction split logic.** Track per-member alignment with profile; detect sustained lead over founder with buffer.

### Phase 3 — God Mode upgrades

14. **Bulk filter actions.** Filter builder UI (age, race, occupation, religion, trait thresholds) + delta application.
15. **Force-specific interactions.** UI to pick subject + antagonizer + interaction type and run.
16. **Manual event authoring.** Add custom memory with stat delta from a single form.

### Phase 4 — World designer

17. **Rule library.** First-class storage for rules. Tag rules as reusable.
18. **World creation flow.** Pick rule set (4/6/8), starting population tier, initial groups, demographic mix.
19. **Multi-world switching.** Each world is a separate state. Player can run multiple in parallel or archive/revive.

### Phase 5 — Narrative upgrades

20. **Tone-routed headline generation.** Each outcome/event type carries a tone tag; the headline prompt picks voice accordingly.
21. **Decade summaries per world.** Running context for Claude so long-running worlds stay coherent.

### Phase 6 — Scale

22. **Batched tick processing.** Bulk DB writes, parallel interaction resolution, background job runner.
23. **Filter-first UI.** Search, filter, surface-via-headline as primary navigation.
24. **Scale tier selector at world creation.**

### Phase 7 — Births

25. **Conception interaction type.** Pregnancy tracking state on person. Child creation with 50/50 inheritance.

---

## Recommended first move

**Phase 0, step 1** — the schema audit. Before building anything new, know exactly what has to change in the existing code. That audit produces the concrete refactor plan for Phase 0 steps 2-4, which unblocks everything else.
