# AI GOD — Design Audit Prompt

Paste this entire file into a new Claude conversation to begin the design audit.

---

## Context Briefing

You are auditing a personal passion project called **AI GOD** — a browser-based civilization god-game built with React/TypeScript/Tailwind on the frontend and Express/Prisma/PostgreSQL on the backend. The builder is a solo developer who is the architect and sole engineer. Treat them as a Senior Lead Architect.

Your job is to deeply understand the game — its purpose, current structure, simulation engine, and the key relationships and levers the player can manipulate. Ask questions one topic at a time. Do not dump everything at once. Build up a shared model of the game before making any suggestions.

---

## What has been built so far

### The World
- A singleton **WorldState** tracks: current year, tick count, total deaths, market state, and 24 **global trait child values** (6 forces × 4 children).
- The 6 world forces are: **Scarcity, War, Faith, Plague, Tyranny, Discovery**.
- Each force has 4 children with typed ranges (some always-negative like `civilian_casualties`, some bipolar like `morale`, some always-positive like `devotion`).
- Force composite scores (0–100) are computed by normalizing each child to 0–100 and averaging. These represent the "temperature" of each force in the world.
- Each force has an **effect multiplier** (default 1×) that can be dialed up or down to amplify that force's impact on characters and interactions.
- The player can **edit all 24 global trait child values mid-game** via sliders in the Economy page.

### People
- The world auto-seeds **100 random people** on first load (idempotent — won't re-seed if population exists).
- Each person has:
  - **Core stats** (0–100): health, happiness, morality, reputation, influence, intelligence
  - **Wealth** (float, unbounded)
  - **100 survival/philosophy traits** across 25 categories (e.g. `combat_skill`, `mercy`, `death_acceptance`, `nihilism`)
  - **Global scores** (24 values): personal reflection of each world force child, seeded from world baseline ±25 random variance, clamped to each child's min/max
  - **Demographic fields**: race, gender, sexuality, age, lifespan (race-dependent — Elves live 250–700 years, Orcs 40–70)
  - **Archetype**: noble, merchant, soldier, criminal, scholar, priest, farmer, wanderer, artisan, elder — biases stats and trait values at generation
  - **Memory bank**: log of every significant event with emotional valence (traumatic → euphoric)
  - **Criminal record**: JSONB array of offenses

### The Tick Engine
- Each tick advances the simulation: processes interactions, runs the market, ages people, kills and births new people.
- **Interactions** are selected by weighted random from the active ruleset, then scored using:
  - Person's relevant trait values (e.g. `mercy` helps a compassion interaction, hurts a violence one)
  - Global amplifiers (world force child values that nudge the interaction score up or down)
- The score maps to an **outcome band** (e.g. "Triumph", "Setback", "Death") which applies stat deltas and may create a memory entry or generate a Claude-written headline.
- Deaths move people to a **DeceasedPerson** archive with cause, final stats, and peak outcomes.
- Births add new people seeded from current world state.
- 2 ticks = 1 world year.

### Rulesets
- A **Ruleset** is a JSON document defining: interaction types (with trait weights and global amplifiers), and outcome bands (score thresholds → stat deltas → effects).
- Multiple rulesets can exist; one is marked `is_active`.
- The player can switch rulesets to fundamentally change how interactions resolve.

### AI / Headlines
- A **Yearly Headlines** system generates AI-written narrative headlines for notable characters each year (most dramatic fall, greatest villain, rags-to-riches, etc.).
- Decade summaries are also generated.
- These are stored in the DB and shown in a Chronicle page.

### God Mode
- The player can directly edit any person's stats, apply deltas with a written event summary, add criminal records, and force mutations outside the simulation rules.

### Economy / Market
- A simple stock market: index, trend (drift), volatility (noise). Ticks randomly move it.
- Global force multipliers affect market behavior.

### Pages Built
- **Dashboard**: character grid with force score bars on each card
- **Character Detail**: full person view with core stats, 100 traits, and world force breakdown (4 children per force)
- **Economy / Exchange**: market view + 24 global trait sliders + multiplier controls
- **World Panel**: population averages, market snapshot, all 6 force composites + 24 children
- **Chronicle**: yearly/decade headlines from Claude
- **RIP Archive**: deceased persons list

---

## Your task

You are about to interview the developer to build a complete understanding of this game. Use the following areas to structure your questions — but ask one area at a time and go deep before moving on:

1. **Purpose & vision** — What is this game actually *for*? What should it feel like to play? What's the core fantasy?
2. **The player's role** — What does the player *do*? Are they a passive observer, an interventionist god, a narrative curator?
3. **The simulation engine** — How do global forces translate into individual character outcomes? What feedback loops exist or should exist?
4. **The trait system** — 100 traits across 25 categories is a lot. Which ones matter? How should they interact with the world forces and each other?
5. **Key relationships** — What are the most important cause-and-effect chains the player can manipulate? What levers should feel powerful?
6. **Missing systems** — Based on what's been built, what obvious gaps exist in the loop?
7. **Tone & narrative** — Is this dark? Epic? Absurd? What should the Chronicle feel like?

Start with question area 1. Ask one question at a time. Wait for answers before continuing.
