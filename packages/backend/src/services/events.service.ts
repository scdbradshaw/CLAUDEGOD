// ============================================================
// events.service.ts — Per-tick engine for all 6 world events.
// Called once per tick after all interactions resolve.
// ============================================================

import { PrismaClient, Prisma } from '@prisma/client';
import type {
  PlagueParams,
  WarParams,
  GoldenAgeParams,
  GreatDepressionParams,
  BabyBoomParams,
  RobinHoodParams,
  EventDefId,
  TraitKey,
  EventTargeting,
} from '@civ-sim/shared';

// ── Event lifecycle helpers (Phase 4) ─────────────────────────
// Centralised so every "event ends" path writes an event_history row.

/** Reason an event stopped running. */
export type EventEndReason = 'expired' | 'manual' | 'condition_met';

type PrismaLike = PrismaClient | Prisma.TransactionClient;

/**
 * Mark an active event inactive and log its run into `event_history`.
 * Idempotent — if the event is already inactive we skip the history
 * write so re-ending can't duplicate rows.
 *
 * `currentYear` is the world year at the moment of ending; the actual
 * duration is `currentYear - started_year` (clamped at 0).
 */
export async function endEventAndArchive(
  db:          PrismaLike,
  eventId:     string,
  endReason:   EventEndReason,
  currentYear: number,
): Promise<void> {
  const event = await db.worldEvent.findUnique({
    where:  { id: eventId },
    select: {
      id: true, world_id: true, event_def_id: true, params: true,
      started_year: true, is_active: true,
    },
  });
  if (!event || !event.is_active) return;

  await db.worldEvent.update({
    where: { id: event.id },
    data:  { is_active: false },
  });

  await db.eventHistory.create({
    data: {
      world_id:        event.world_id,
      event_def_id:    event.event_def_id,
      params:          event.params as Prisma.InputJsonValue,
      started_year:    event.started_year,
      ended_year:      currentYear,
      end_reason:      endReason,
      duration_actual: Math.max(0, currentYear - event.started_year),
    },
  });
}

/**
 * Per bi-annual call. Decrements `years_remaining` by 0.5 for every
 * active event in the world that has a `duration_years` set (null =
 * indefinite). Any event that hits ≤ 0 is ended with `end_reason:
 * 'expired'` via `endEventAndArchive`.
 */
export async function decrementEventTimers(
  prisma:      PrismaClient,
  worldId:     string,
  currentYear: number,
): Promise<{ expired: number }> {
  const events = await prisma.worldEvent.findMany({
    where:  {
      world_id:       worldId,
      is_active:      true,
      duration_years: { not: null },
    },
    select: { id: true, years_remaining: true },
  });
  if (events.length === 0) return { expired: 0 };

  // Bulk decrement first, then expire the ones that cross the line.
  await prisma.worldEvent.updateMany({
    where: { id: { in: events.map(e => e.id) } },
    data:  { years_remaining: { decrement: 0.5 } },
  });

  let expired = 0;
  for (const e of events) {
    const newRemaining = e.years_remaining - 0.5;
    if (newRemaining <= 0) {
      await endEventAndArchive(prisma, e.id, 'expired', currentYear);
      expired++;
    }
  }
  return { expired };
}

// ── Types ─────────────────────────────────────────────────────

export interface EventTickSummary {
  event_def_id: string;
  /** human-readable stats for what happened */
  summary: Record<string, number | string>;
}

// ── Targeting helpers ─────────────────────────────────────────

function personMatchesTargeting(
  person: TargetablePerson,
  targeting: EventTargeting | undefined,
): boolean {
  if (!targeting) return true;

  const { trait_filters, identity_filters, exclude } = targeting;

  let match = true;

  // Trait filters (all must pass)
  if (trait_filters && trait_filters.length > 0) {
    for (const tf of trait_filters) {
      const val = getNestedTrait(person.traits, tf.trait);
      const passes =
        tf.direction === 'above' ? val >= tf.threshold : val <= tf.threshold;
      if (!passes) { match = false; break; }
    }
  }

  // Identity filters
  if (match && identity_filters) {
    const id = identity_filters;
    if (id.races      && id.races.length      > 0 && !id.races.includes(person.race))       match = false;
    if (id.genders    && id.genders.length    > 0 && !id.genders.includes(person.gender))   match = false;
    if (id.occupations && id.occupations.length > 0 && !id.occupations.includes(person.occupation)) match = false;
    if (id.age_min != null && person.age < id.age_min) match = false;
    if (id.age_max != null && person.age > id.age_max) match = false;
    // religion/faction targeting uses string name comparison
    if (id.religions  && id.religions.length  > 0 && !id.religions.includes(person.religion)) match = false;
  }

  return exclude ? !match : match;
}

function getNestedTrait(traits: Record<string, number>, key: TraitKey): number {
  // Traits are stored flat in JSONB: { strength: 60, intelligence: 45, ... }
  return traits[key] ?? 50;
}

// ── Person shapes for event tick ─────────────────────────────

type TargetablePerson = {
  id:           string;
  traits:       Record<string, number>;
  race:         string;
  gender:       string;
  religion:     string;
  occupation:   string;
  age:          number;
  current_health: number;
  max_health:   number;
  happiness:    number;
  money:        number;
};

// ── Happiness drift helper ────────────────────────────────────

/** Natural happiness drift toward 50. Applied every tick, capped at 50. */
export function computeHappinessDrift(current: number): number {
  if (current === 50) return 0;
  const step = current > 50 ? -1 : 1;
  return step;
}

// ── Main event tick ───────────────────────────────────────────

export async function processEventsTick(
  prisma:    PrismaClient,
  worldId:   string,
  tick:      number,
  year:      number,
): Promise<EventTickSummary[]> {
  // Load active events
  const activeEvents = await prisma.worldEvent.findMany({
    where:   { world_id: worldId, is_active: true },
    orderBy: { created_at: 'asc' },
  });

  if (activeEvents.length === 0) return [];

  // Load all living persons for this world (columns needed across all events)
  const persons = await prisma.person.findMany({
    where:  { world_id: worldId, current_health: { gt: 0 } },
    select: {
      id: true, traits: true, race: true, gender: true, religion: true,
      occupation: true, age: true, current_health: true, max_health: true,
      happiness: true, money: true,
    },
  }) as TargetablePerson[];

  const summaries: EventTickSummary[] = [];

  for (const event of activeEvents) {
    const defId  = event.event_def_id as EventDefId;
    const params = event.params as Record<string, unknown>;

    try {
      let summary: Record<string, number | string>;

      switch (defId) {
        case 'plague':
          summary = await tickPlague(prisma, event.id, persons, params as unknown as PlagueParams, tick, year);
          break;
        case 'war':
          summary = await tickWar(prisma, event.id, persons, params as unknown as WarParams, year);
          break;
        case 'golden_age':
          summary = await tickGoldenAge(prisma, event.id, persons, params as unknown as GoldenAgeParams);
          break;
        case 'great_depression':
          summary = await tickGreatDepression(prisma, event.id, persons, params as unknown as GreatDepressionParams, worldId);
          break;
        case 'baby_boom':
          summary = await tickBabyBoom(prisma, event.id, persons, params as unknown as BabyBoomParams, worldId, year, tick);
          break;
        case 'robin_hood':
          summary = await tickRobinHood(prisma, event.id, persons, params as unknown as RobinHoodParams);
          break;
        default:
          continue;
      }

      summaries.push({ event_def_id: defId, summary });
    } catch (err) {
      console.error(`[events] Error ticking event ${defId}:`, err);
    }
  }

  return summaries;
}

// ── 1. Plague ─────────────────────────────────────────────────

async function tickPlague(
  prisma:   PrismaClient,
  eventId:  string,
  persons:  TargetablePerson[],
  params:   PlagueParams,
  _tick:    number,
  _year:    number,
): Promise<Record<string, number | string>> {
  const {
    infection_chance,
    health_drain,
    happiness_drain,
    recovery_health_threshold,
    recovery_happiness_threshold,
    targeting,
  } = params;

  // Load infected set
  const infectedRows = await prisma.personEventStatus.findMany({
    where:  { event_id: eventId, status: 'infected' },
    select: { person_id: true },
  });
  const infectedSet = new Set(infectedRows.map(r => r.person_id));

  const eligible = persons.filter(p => personMatchesTargeting(p, targeting));

  const newlyInfected: string[]  = [];
  const recovered:     string[]  = [];
  const healthUpdates: { id: string; health: number; happiness: number }[] = [];

  for (const p of eligible) {
    const alreadyInfected = infectedSet.has(p.id);

    if (alreadyInfected) {
      // Check recovery
      if (
        p.current_health >= recovery_health_threshold &&
        p.happiness >= recovery_happiness_threshold
      ) {
        recovered.push(p.id);
        infectedSet.delete(p.id);
      } else {
        // Drain
        healthUpdates.push({
          id:        p.id,
          health:    Math.max(0, p.current_health - health_drain),
          happiness: Math.max(0, p.happiness - happiness_drain),
        });
      }
    } else {
      // Exposure check
      if (Math.random() * 100 < infection_chance) {
        newlyInfected.push(p.id);
        infectedSet.add(p.id);
        healthUpdates.push({
          id:        p.id,
          health:    Math.max(0, p.current_health - health_drain),
          happiness: Math.max(0, p.happiness - happiness_drain),
        });
      }
    }
  }

  // Persist in parallel
  await Promise.all([
    // Create infection status rows for newly infected
    newlyInfected.length > 0 && prisma.personEventStatus.createMany({
      data: newlyInfected.map(person_id => ({
        event_id: eventId,
        person_id,
        status: 'infected',
      })),
      skipDuplicates: true,
    }),
    // Mark recovered
    recovered.length > 0 && prisma.personEventStatus.updateMany({
      where:  { event_id: eventId, person_id: { in: recovered } },
      data:   { status: 'recovered' },
    }),
    // Apply HP + happiness drains
    healthUpdates.length > 0 && prisma.$executeRaw`
      UPDATE persons p SET
        current_health = u.health,
        happiness      = u.happiness
      FROM (
        SELECT
          unnest(${healthUpdates.map(r => r.id)}::uuid[])        AS id,
          unnest(${healthUpdates.map(r => r.health)}::int[])     AS health,
          unnest(${healthUpdates.map(r => r.happiness)}::int[])  AS happiness
      ) AS u
      WHERE p.id = u.id
    `,
  ].filter(Boolean));

  return {
    newly_infected: newlyInfected.length,
    recovered:      recovered.length,
    drained:        healthUpdates.length,
    total_infected: infectedSet.size,
  };
}

// ── 2. War ────────────────────────────────────────────────────

async function tickWar(
  prisma:  PrismaClient,
  eventId: string,
  persons: TargetablePerson[],
  params:  WarParams,
  year:    number,
): Promise<Record<string, number | string>> {
  const { group_a, group_b, percent_affected, flat_damage, cost_per_tick, bankruptcy_threshold } = params;

  // Load group balances + members
  const [groupAData, groupBData] = await Promise.all([
    group_a.type === 'faction'
      ? prisma.faction.findUnique({ where: { id: group_a.id }, select: { id: true, balance: true, is_active: true } })
      : prisma.religion.findUnique({ where: { id: group_a.id }, select: { id: true, balance: true, is_active: true } }),
    group_b.type === 'faction'
      ? prisma.faction.findUnique({ where: { id: group_b.id }, select: { id: true, balance: true, is_active: true } })
      : prisma.religion.findUnique({ where: { id: group_b.id }, select: { id: true, balance: true, is_active: true } }),
  ]);

  if (!groupAData || !groupBData) {
    // End the event — group no longer exists
    await endEventAndArchive(prisma, eventId, 'condition_met', year);
    return { reason: 'group_dissolved', killed: 0 };
  }

  // Check bankruptcy
  const aBalance = groupAData.balance ?? 0;
  const bBalance = groupBData.balance ?? 0;

  if (aBalance <= bankruptcy_threshold || bBalance <= bankruptcy_threshold) {
    await endEventAndArchive(prisma, eventId, 'condition_met', year);
    return {
      reason:    'bankruptcy',
      bankrupt:  aBalance <= bankruptcy_threshold ? group_a.name : group_b.name,
    };
  }

  // Resolve members
  const personIds = persons.map(p => p.id);
  const [aMemberRows, bMemberRows] = await Promise.all([
    group_a.type === 'faction'
      ? prisma.factionMembership.findMany({ where: { faction_id: group_a.id, person_id: { in: personIds } }, select: { person_id: true } })
      : prisma.religionMembership.findMany({ where: { religion_id: group_a.id, person_id: { in: personIds } }, select: { person_id: true } }),
    group_b.type === 'faction'
      ? prisma.factionMembership.findMany({ where: { faction_id: group_b.id, person_id: { in: personIds } }, select: { person_id: true } })
      : prisma.religionMembership.findMany({ where: { religion_id: group_b.id, person_id: { in: personIds } }, select: { person_id: true } }),
  ]);

  const aMembers = aMemberRows.map(r => r.person_id);
  const bMembers = bMemberRows.map(r => r.person_id);

  if (aMembers.length === 0 || bMembers.length === 0) {
    await endEventAndArchive(prisma, eventId, 'condition_met', year);
    return { reason: 'annihilation', killed: 0 };
  }

  // Select combatants
  const aCombatants = samplePercent(aMembers, percent_affected);
  const bCombatants = samplePercent(bMembers, percent_affected);

  const allCombatantIds = [...aCombatants, ...bCombatants];
  const byId = new Map(persons.map(p => [p.id, p]));

  // Compute damage updates
  const updates: { id: string; health: number }[] = [];
  let kills = 0;
  for (const pid of allCombatantIds) {
    const p = byId.get(pid);
    if (!p) continue;
    const newHealth = Math.max(0, p.current_health - flat_damage);
    updates.push({ id: pid, health: newHealth });
    if (newHealth <= 0) kills++;
  }

  // Deduct cost from both group balances
  await Promise.all([
    // HP damage
    updates.length > 0 && prisma.$executeRaw`
      UPDATE persons p SET current_health = u.health
      FROM (
        SELECT
          unnest(${updates.map(r => r.id)}::uuid[])     AS id,
          unnest(${updates.map(r => r.health)}::int[])  AS health
      ) AS u
      WHERE p.id = u.id
    `,
    // Group treasury drain
    group_a.type === 'faction'
      ? prisma.faction.update({ where: { id: group_a.id }, data: { balance: { decrement: cost_per_tick } } })
      : prisma.religion.update({ where: { id: group_a.id }, data: { balance: { decrement: cost_per_tick } } }),
    group_b.type === 'faction'
      ? prisma.faction.update({ where: { id: group_b.id }, data: { balance: { decrement: cost_per_tick } } })
      : prisma.religion.update({ where: { id: group_b.id }, data: { balance: { decrement: cost_per_tick } } }),
  ].filter(Boolean));

  return {
    combatants_a: aCombatants.length,
    combatants_b: bCombatants.length,
    kills,
    cost_a: cost_per_tick,
    cost_b: cost_per_tick,
  };
}

// ── 3. Golden Age ─────────────────────────────────────────────

async function tickGoldenAge(
  prisma:  PrismaClient,
  _eventId: string,
  persons: TargetablePerson[],
  params:  GoldenAgeParams,
): Promise<Record<string, number | string>> {
  const { health_gain, happiness_gain, money_bonus, targeting } = params;

  const eligible = persons.filter(p => personMatchesTargeting(p, targeting));
  if (eligible.length === 0) return { eligible: 0 };

  const updates = eligible.map(p => ({
    id:        p.id,
    health:    Math.min(p.max_health, p.current_health + health_gain),
    happiness: Math.min(100, p.happiness + happiness_gain),
  }));

  await Promise.all([
    prisma.$executeRaw`
      UPDATE persons p SET
        current_health = u.health,
        happiness      = u.happiness,
        money          = money + ${money_bonus}
      FROM (
        SELECT
          unnest(${updates.map(r => r.id)}::uuid[])        AS id,
          unnest(${updates.map(r => r.health)}::int[])     AS health,
          unnest(${updates.map(r => r.happiness)}::int[])  AS happiness
      ) AS u
      WHERE p.id = u.id
    `,
  ]);

  return { eligible: eligible.length, health_gain, happiness_gain, money_bonus };
}

// ── 4. Great Depression ───────────────────────────────────────

async function tickGreatDepression(
  prisma:   PrismaClient,
  _eventId: string,
  persons:  TargetablePerson[],
  params:   GreatDepressionParams,
  worldId:  string,
): Promise<Record<string, number | string>> {
  const { market_floor, unemployment_drain, happiness_drain, firing_multiplier, targeting } = params;

  const eligible = persons.filter(p => personMatchesTargeting(p, targeting));
  if (eligible.length === 0) return { eligible: 0 };

  // Load job_id for eligible persons
  const eligibleIds = eligible.map(p => p.id);
  const jobRows = await prisma.person.findMany({
    where:  { id: { in: eligibleIds } },
    select: { id: true, job_id: true },
  });
  const jobMap = new Map(jobRows.map(r => [r.id, r.job_id]));

  const updates = eligible.map(p => {
    const isUnemployed = !jobMap.get(p.id);
    return {
      id:        p.id,
      happiness: Math.max(0, p.happiness - happiness_drain),
      money_drain: isUnemployed ? unemployment_drain : 0,
    };
  });

  // Apply happiness + unemployment drain
  const unemployed = updates.filter(u => u.money_drain > 0);

  await Promise.all([
    // Happiness drain for everyone
    prisma.$executeRaw`
      UPDATE persons p SET happiness = u.happiness
      FROM (
        SELECT
          unnest(${updates.map(r => r.id)}::uuid[])        AS id,
          unnest(${updates.map(r => r.happiness)}::int[])  AS happiness
      ) AS u
      WHERE p.id = u.id
    `,
    // Money drain for unemployed
    unemployed.length > 0 && prisma.$executeRaw`
      UPDATE persons SET money = GREATEST(0, money - ${unemployment_drain})
      WHERE id = ANY(${unemployed.map(u => u.id)}::uuid[])
    `,
  ].filter(Boolean));

  // Enforce market floor — clamp world market_index if below floor
  const world = await prisma.world.findUnique({ where: { id: worldId }, select: { market_index: true } });
  if (world && world.market_index < market_floor) {
    await prisma.world.update({
      where: { id: worldId },
      data:  { market_index: market_floor },
    });
  }

  return {
    eligible:             eligible.length,
    unemployed_drained:   unemployed.length,
    happiness_drain,
    firing_multiplier,
  };
}

// ── 5. Baby Boom ──────────────────────────────────────────────

async function tickBabyBoom(
  prisma:   PrismaClient,
  _eventId: string,
  persons:  TargetablePerson[],
  params:   BabyBoomParams,
  worldId:  string,
  year:     number,
  tick:     number,
): Promise<Record<string, number | string>> {
  const { conception_chance, happiness_boost } = params;

  const living = persons.filter(p => p.age >= 16 && p.age < 50);

  // Global happiness boost for everyone
  if (persons.length > 0) {
    await prisma.$executeRaw`
      UPDATE persons SET happiness = LEAST(100, happiness + ${happiness_boost})
      WHERE world_id = ${worldId}::uuid AND current_health > 0
    `;
  }

  // Baby boom conception — any two living souls, regardless of relationship
  let conceptions = 0;
  // Pair off living persons randomly and roll conception
  const shuffled = [...living].sort(() => Math.random() - 0.5);
  const pairs: [TargetablePerson, TargetablePerson][] = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    pairs.push([shuffled[i], shuffled[i + 1]]);
  }

  for (const [a, b] of pairs) {
    if (Math.random() * 100 < conception_chance) {
      // Create a pregnancy (due 3 ticks from now)
      const dueTick = tick + 3;
      try {
        await prisma.pregnancy.create({
          data: {
            parent_a_id: a.id,
            parent_b_id: b.id,
            world_id:    worldId,
            started_tick: tick,
            due_tick:    dueTick,
            resolved:    false,
          },
        });
        conceptions++;
      } catch {
        // Skip duplicate pair
      }
    }
  }

  return { happiness_boost, conceptions };
}

// ── 6. Robin Hood ─────────────────────────────────────────────

async function tickRobinHood(
  prisma:  PrismaClient,
  _eventId: string,
  persons: TargetablePerson[],
  params:  RobinHoodParams,
): Promise<Record<string, number | string>> {
  const { rich_percentile, poor_percentile, transfer_percent, rich_happiness_drain, poor_happiness_gain } = params;

  if (persons.length < 2) return { transferred: 0 };

  // Sort by money
  const sorted = [...persons].sort((a, b) => a.money - b.money);
  const n = sorted.length;

  const richCutoff = Math.max(1, Math.floor(n * (1 - rich_percentile / 100)));
  const poorCutoff = Math.max(1, Math.floor(n * (poor_percentile / 100)));

  const rich = sorted.slice(richCutoff);
  const poor = sorted.slice(0, poorCutoff);

  if (rich.length === 0 || poor.length === 0) return { transferred: 0 };

  // Compute transfers
  const richUpdates: { id: string; money: number; happiness: number }[] = [];
  let totalTransferred = 0;

  for (const r of rich) {
    const transfer = Math.floor(r.money * (transfer_percent / 100));
    richUpdates.push({
      id:        r.id,
      money:     Math.max(0, r.money - transfer),
      happiness: Math.max(0, r.happiness - rich_happiness_drain),
    });
    totalTransferred += transfer;
  }

  // Distribute evenly to poor
  const perPoor = poor.length > 0 ? Math.floor(totalTransferred / poor.length) : 0;
  const poorUpdates: { id: string; money: number; happiness: number }[] = poor.map(p => ({
    id:        p.id,
    money:     p.money + perPoor,
    happiness: Math.min(100, p.happiness + poor_happiness_gain),
  }));

  // Persist
  const allUpdates = [...richUpdates, ...poorUpdates];
  await prisma.$executeRaw`
    UPDATE persons p SET
      money     = u.money,
      happiness = u.happiness
    FROM (
      SELECT
        unnest(${allUpdates.map(r => r.id)}::uuid[])        AS id,
        unnest(${allUpdates.map(r => r.money)}::int[])      AS money,
        unnest(${allUpdates.map(r => r.happiness)}::int[])  AS happiness
    ) AS u
    WHERE p.id = u.id
  `;

  return {
    rich_count:       rich.length,
    poor_count:       poor.length,
    total_transferred: totalTransferred,
    per_poor:         perPoor,
  };
}

// ── Happiness natural drift ───────────────────────────────────

/** Apply natural happiness drift toward 50 for all living persons in world. */
export async function applyHappinessDrift(
  prisma:  PrismaClient,
  worldId: string,
): Promise<void> {
  // People above 50: drift down by 1. People below 50: drift up by 1.
  await prisma.$executeRaw`
    UPDATE persons SET
      happiness = CASE
        WHEN happiness > 50 THEN happiness - 1
        WHEN happiness < 50 THEN happiness + 1
        ELSE 50
      END
    WHERE world_id = ${worldId}::uuid AND current_health > 0
  `;
}

// ── Utilities ─────────────────────────────────────────────────

function samplePercent<T>(arr: T[], pct: number): T[] {
  const n = Math.max(1, Math.floor(arr.length * (pct / 100)));
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// ── Group treasury funding ────────────────────────────────────

/**
 * Add cost_per_tick to each religion/faction balance from member payments.
 * Called every tick. Funded by the group's cost_per_tick setting.
 */
export async function fundGroupTreasuries(prisma: PrismaClient, worldId: string): Promise<void> {
  // Religions
  const religions = await prisma.religion.findMany({
    where:   { world_id: worldId, is_active: true, cost_per_tick: { gt: 0 } },
    include: { memberships: { select: { person_id: true } } },
  });

  for (const rel of religions) {
    const members = rel.memberships.length;
    if (members === 0) continue;
    const income = members * rel.cost_per_tick;
    await prisma.religion.update({ where: { id: rel.id }, data: { balance: { increment: income } } });
  }

  // Factions
  const factions = await prisma.faction.findMany({
    where:   { world_id: worldId, is_active: true, cost_per_tick: { gt: 0 } },
    include: { memberships: { select: { person_id: true } } },
  });

  for (const fac of factions) {
    const members = fac.memberships.length;
    if (members === 0) continue;
    const income = members * fac.cost_per_tick;
    await prisma.faction.update({ where: { id: fac.id }, data: { balance: { increment: income } } });
  }
}
