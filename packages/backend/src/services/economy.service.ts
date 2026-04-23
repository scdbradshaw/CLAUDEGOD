// ============================================================
// ECONOMY SERVICE — Phase 1 real income model
//
// Called once per tick from the interactions route, AFTER
// interaction deaths are processed. Runs seven sequential steps:
//
//   1. Job retention   — fire/quit souls whose score drifted out of band
//   2. Job application — unemployed souls apply for best-fit job
//   3. Income          — every employed soul earns base_pay
//   4. Faction tax     — 10% of income deducted from faction members
//                        (TODO: wire to faction treasury when that lands)
//   5. Debt interest   — souls with money < 0 accrue 2% interest/tick
//   6. Auto-theft      — poverty + low discipline → probabilistic steal
//                        from a random relationship target
//   7. Auto-gifting    — wealth + high empathy → probabilistic gift
//                        to a random poorer relationship target
//
// All DB writes are batched — at most 4 round-trips regardless of N.
// ============================================================

import type { PrismaClient } from '@prisma/client';
import {
  ALL_JOBS,
  JOB_BY_ID,
  computeJobScore,
  shouldBeFired,
  shouldQuit,
  bestFitJob,
} from '@civ-sim/shared';
import { writeMemoriesBatch, type MemoryWriteInput } from './memory.service';

// ── Tunables ────────────────────────────────────────────────────────────────

/** Interest rate applied to negative balances each tick (2 %). */
const DEBT_INTEREST_RATE = 0.02;

/** Theft triggers when money is below this AND discipline below THEFT_DISCIPLINE_MAX. */
const THEFT_MONEY_THRESHOLD    = 200;
const THEFT_DISCIPLINE_MAX     = 35;
/** Chance per tick that a qualifying soul steals from a random linked target. */
const THEFT_PROB               = 0.15;
/** Fraction range of target's money stolen: [min, max]. */
const THEFT_FRAC_MIN           = 0.10;
const THEFT_FRAC_MAX           = 0.30;
/** Bond-strength penalty for the victim's view of the thief. */
const THEFT_BOND_DAMAGE        = 20;

/** Gifting triggers when money is above this AND empathy above GIFT_EMPATHY_MIN. */
const GIFT_MONEY_THRESHOLD     = 1000;
const GIFT_EMPATHY_MIN         = 70;
/** Chance per tick that a qualifying soul gifts to a random linked poorer target. */
const GIFT_PROB                = 0.10;
/** Fraction range of donor's money gifted: [min, max]. */
const GIFT_FRAC_MIN            = 0.05;
const GIFT_FRAC_MAX            = 0.15;
/** Bond-strength boost for the recipient's view of the donor. */
const GIFT_BOND_BOOST          = 8;

// ── Minimal types ───────────────────────────────────────────────────────────

/** Shape shared with the tick engine for economy processing. */
export interface EconomyPerson {
  id:         string;
  name:       string;
  age:        number;
  money:      number;
  job_id:     string | null;
  traits:     Record<string, number>;
  // faction membership is provided separately via memberships map
}

export interface OwnedEdge {
  target_id:     string;
  bond_strength: number;
}

export interface EconomyTickResult {
  fired:          number;
  quit:           number;
  newly_employed: number;
  income_paid:    number;   // total money distributed
  faction_tax:    number;   // total money deducted for tax
  debt_interest:  number;   // number of souls accruing interest
  thefts:         number;
  gifts:          number;
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function processEconomyTick(
  prisma:      PrismaClient,
  /** All persons alive at the END of the interaction phase this tick. */
  alive:       EconomyPerson[],
  /** owner_id → outgoing edges — used for auto-theft and auto-gifting. */
  linksOf:     Map<string, OwnedEdge[]>,
  /** faction membership: person_id → set of faction_ids. */
  factionsByPerson: Map<string, Set<string>>,
  worldYear:   number,
  worldId:     string,
  /** Flat multiplier applied to every job's base_pay. Default 1.0. */
  jobIncomeMultiplier: number = 1,
  /** Fraction of gross income deducted as cost of living. Default 0.30 (30%). */
  colPct: number = 0.30,
): Promise<EconomyTickResult> {

  // Working copies — money deltas accumulate here before a single bulk UPDATE.
  const moneyDelta:   Record<string, number> = {};
  const jobUpdates:   Array<{ id: string; job_id: string | null; occupation: string }> = [];
  const bondUpdates:  Array<{ owner_id: string; target_id: string; delta: number }> = [];
  const memories:     MemoryWriteInput[] = [];

  let fired          = 0;
  let quit           = 0;
  let newly_employed = 0;
  let income_paid    = 0;
  let faction_tax    = 0;
  let debt_interest  = 0;
  let thefts         = 0;
  let gifts          = 0;

  // Quick lookup for the alive set.
  const aliveById = new Map(alive.map(p => [p.id, p]));

  // ── 1 & 2. Job retention + application ──────────────────────────────────
  for (const person of alive) {
    const traits = person.traits;

    if (person.job_id !== null) {
      // Employed — check fire / quit
      const job = JOB_BY_ID.get(person.job_id);
      if (job) {
        if (shouldBeFired(traits, job)) {
          jobUpdates.push({ id: person.id, job_id: null, occupation: 'unemployed' });
          person.job_id = null; // update local copy for income step
          fired++;
        } else if (shouldQuit(traits, job)) {
          jobUpdates.push({ id: person.id, job_id: null, occupation: 'unemployed' });
          person.job_id = null;
          quit++;
        }
      } else {
        // Stale job_id not in static list — clear it
        jobUpdates.push({ id: person.id, job_id: null, occupation: 'unemployed' });
        person.job_id = null;
      }
    }

    if (person.job_id === null) {
      // Unemployed — try to find a new job
      const best = bestFitJob(traits);
      if (best) {
        jobUpdates.push({ id: person.id, job_id: best.id, occupation: best.title });
        person.job_id = best.id; // update local copy so income fires this tick
        newly_employed++;
      }
    }
  }

  // ── 3. Income ────────────────────────────────────────────────────────────
  for (const person of alive) {
    if (person.job_id === null) continue;
    const job = JOB_BY_ID.get(person.job_id);
    if (!job) continue;

    const pay = Math.round(job.base_pay * jobIncomeMultiplier);
    moneyDelta[person.id] = (moneyDelta[person.id] ?? 0) + pay;
    income_paid += pay;
  }

  // ── 3b. Cost of living — 30% of gross income, debt allowed ──────────────
  for (const person of alive) {
    const earned = moneyDelta[person.id] ?? 0;
    if (earned <= 0) continue; // unemployed pay nothing
    const col = Math.floor(earned * colPct);
    moneyDelta[person.id] = earned - col;
  }

  // ── 4. Faction tax (10 % of income, deducted after earning) ─────────────
  for (const person of alive) {
    const factions = factionsByPerson.get(person.id);
    if (!factions || factions.size === 0) continue;

    const earned = moneyDelta[person.id] ?? 0;
    if (earned <= 0) continue;

    const tax = Math.floor(earned * 0.10);
    if (tax === 0) continue;

    moneyDelta[person.id] = (moneyDelta[person.id] ?? 0) - tax;
    faction_tax += tax;
  }

  // ── 5. Debt interest (2 % on negative balances) ──────────────────────────
  for (const person of alive) {
    const currentMoney = person.money + (moneyDelta[person.id] ?? 0);
    if (currentMoney >= 0) continue;

    // Interest makes debt worse (more negative)
    const interest = Math.floor(Math.abs(currentMoney) * DEBT_INTEREST_RATE);
    if (interest > 0) {
      moneyDelta[person.id] = (moneyDelta[person.id] ?? 0) - interest;
      debt_interest++;
    }
  }

  // ── 6. Auto-theft ────────────────────────────────────────────────────────
  for (const person of alive) {
    const currentMoney = person.money + (moneyDelta[person.id] ?? 0);
    const discipline   = person.traits.discipline ?? 50;

    if (currentMoney >= THEFT_MONEY_THRESHOLD) continue;
    if (discipline   >= THEFT_DISCIPLINE_MAX)   continue;
    if (Math.random()  >= THEFT_PROB)           continue;

    // Pick a random linked target who is alive and has more money
    const edges = linksOf.get(person.id) ?? [];
    const candidates = edges.filter(e => {
      const target = aliveById.get(e.target_id);
      if (!target) return false;
      const targetMoney = target.money + (moneyDelta[e.target_id] ?? 0);
      return targetMoney > currentMoney;
    });
    if (candidates.length === 0) continue;

    const edge   = candidates[Math.floor(Math.random() * candidates.length)];
    const target = aliveById.get(edge.target_id)!;
    const targetMoney = target.money + (moneyDelta[edge.target_id] ?? 0);

    const frac   = THEFT_FRAC_MIN + Math.random() * (THEFT_FRAC_MAX - THEFT_FRAC_MIN);
    const stolen = Math.max(1, Math.floor(targetMoney * frac));

    moneyDelta[person.id]  = (moneyDelta[person.id]  ?? 0) + stolen;
    moneyDelta[target.id]  = (moneyDelta[target.id]  ?? 0) - stolen;

    // Bond damage: target's view of thief drops
    bondUpdates.push({ owner_id: target.id, target_id: person.id, delta: -THEFT_BOND_DAMAGE });

    // Memories for both parties
    memories.push({
      personId:        person.id,
      eventSummary:    `Stole ${stolen} coins from ${target.name}.`,
      emotionalImpact: 'neutral',
      deltaApplied:    { money: stolen },
      magnitude:       0.4,
      tone:            'tabloid',
      worldYear,
      counterpartyId:  target.id,
      eventKind:       'crime',
      ageAtEvent:      person.age,
    });
    memories.push({
      personId:        target.id,
      eventSummary:    `${person.name} stole ${stolen} coins from them.`,
      emotionalImpact: 'negative',
      deltaApplied:    { money: -stolen },
      magnitude:       0.5,
      tone:            'tabloid',
      worldYear,
      counterpartyId:  person.id,
      eventKind:       'crime',
      ageAtEvent:      target.age,
    });

    thefts++;
  }

  // ── 7. Auto-gifting ──────────────────────────────────────────────────────
  for (const person of alive) {
    const currentMoney = person.money + (moneyDelta[person.id] ?? 0);
    const empathy      = person.traits.empathy ?? 50;

    if (currentMoney <= GIFT_MONEY_THRESHOLD) continue;
    if (empathy      <= GIFT_EMPATHY_MIN)     continue;
    if (Math.random()  >= GIFT_PROB)          continue;

    // Pick a random linked target who is alive and has less money
    const edges = linksOf.get(person.id) ?? [];
    const candidates = edges.filter(e => {
      const target = aliveById.get(e.target_id);
      if (!target) return false;
      const targetMoney = target.money + (moneyDelta[e.target_id] ?? 0);
      return targetMoney < currentMoney;
    });
    if (candidates.length === 0) continue;

    const edge   = candidates[Math.floor(Math.random() * candidates.length)];
    const target = aliveById.get(edge.target_id)!;

    const frac   = GIFT_FRAC_MIN + Math.random() * (GIFT_FRAC_MAX - GIFT_FRAC_MIN);
    const amount = Math.max(1, Math.floor(currentMoney * frac));

    moneyDelta[person.id]  = (moneyDelta[person.id]  ?? 0) - amount;
    moneyDelta[target.id]  = (moneyDelta[target.id]  ?? 0) + amount;

    // Bond boost: recipient's view of donor rises
    bondUpdates.push({ owner_id: target.id, target_id: person.id, delta: GIFT_BOND_BOOST });

    memories.push({
      personId:        person.id,
      eventSummary:    `Gifted ${amount} coins to ${target.name} out of generosity.`,
      emotionalImpact: 'positive',
      deltaApplied:    { money: -amount },
      magnitude:       0.35,
      tone:            'literary',
      worldYear,
      counterpartyId:  target.id,
      ageAtEvent:      person.age,
    });
    memories.push({
      personId:        target.id,
      eventSummary:    `${person.name} gave them ${amount} coins as a gift.`,
      emotionalImpact: 'positive',
      deltaApplied:    { money: amount },
      magnitude:       0.35,
      tone:            'literary',
      worldYear,
      counterpartyId:  person.id,
      ageAtEvent:      target.age,
    });

    gifts++;
  }

  // ── Persist all changes ──────────────────────────────────────────────────

  await Promise.all([
    // Bulk money UPDATE
    persistMoneyDeltas(prisma, moneyDelta),
    // Bulk job_id + occupation UPDATE
    persistJobUpdates(prisma, jobUpdates),
    // Bond strength adjustments
    persistBondUpdates(prisma, bondUpdates),
    // Memories
    memories.length > 0 ? writeMemoriesBatch(prisma, memories) : Promise.resolve(),
  ]);

  return { fired, quit, newly_employed, income_paid, faction_tax, debt_interest, thefts, gifts };
}

// ── Bulk DB helpers ──────────────────────────────────────────────────────────

async function persistMoneyDeltas(
  prisma:  PrismaClient,
  deltas:  Record<string, number>,
): Promise<void> {
  const entries = Object.entries(deltas).filter(([, d]) => d !== 0);
  if (entries.length === 0) return;

  const ids    = entries.map(([id]) => id);
  const amounts = entries.map(([, d]) => d);

  await prisma.$executeRawUnsafe(`
    UPDATE persons p
    SET money      = p.money + v.delta,
        updated_at = NOW()
    FROM (
      SELECT UNNEST($1::uuid[])    AS id,
             UNNEST($2::integer[]) AS delta
    ) AS v
    WHERE p.id = v.id
  `, ids, amounts);
}

async function persistJobUpdates(
  prisma:  PrismaClient,
  updates: Array<{ id: string; job_id: string | null; occupation: string }>,
): Promise<void> {
  if (updates.length === 0) return;

  // Two separate bulk updates: one for newly-employed (job_id IS NOT NULL),
  // one for fired/quit (job_id IS NULL). Both use UNNEST.
  const employed  = updates.filter(u => u.job_id !== null);
  const dismissed = updates.filter(u => u.job_id === null);

  if (employed.length > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE persons p
      SET job_id     = v.job_id,
          occupation = v.occupation,
          updated_at = NOW()
      FROM (
        SELECT UNNEST($1::uuid[])   AS id,
               UNNEST($2::text[])   AS job_id,
               UNNEST($3::text[])   AS occupation
      ) AS v
      WHERE p.id = v.id
    `, employed.map(u => u.id), employed.map(u => u.job_id!), employed.map(u => u.occupation));
  }

  if (dismissed.length > 0) {
    await prisma.$executeRawUnsafe(`
      UPDATE persons p
      SET job_id     = NULL,
          occupation = 'unemployed',
          updated_at = NOW()
      FROM (SELECT UNNEST($1::uuid[]) AS id) AS v
      WHERE p.id = v.id
    `, dismissed.map(u => u.id));
  }
}

async function persistBondUpdates(
  prisma:  PrismaClient,
  updates: Array<{ owner_id: string; target_id: string; delta: number }>,
): Promise<void> {
  if (updates.length === 0) return;

  await prisma.$executeRawUnsafe(`
    UPDATE inner_circle_links l
    SET bond_strength = GREATEST(0, LEAST(100, l.bond_strength + v.delta)),
        updated_at    = NOW()
    FROM (
      SELECT UNNEST($1::uuid[])    AS owner_id,
             UNNEST($2::uuid[])    AS target_id,
             UNNEST($3::integer[]) AS delta
    ) AS v
    WHERE l.owner_id  = v.owner_id
      AND l.target_id = v.target_id
  `, updates.map(u => u.owner_id), updates.map(u => u.target_id), updates.map(u => u.delta));
}

// ── Manual steal / gift helpers (called from the interactions route) ─────────

export interface StealResult {
  stolen:         number;
  thief_name:     string;
  victim_name:    string;
  new_bond:       number | null;
}

export interface GiftResult {
  amount:         number;
  donor_name:     string;
  recipient_name: string;
  new_bond:       number | null;
}

/**
 * Player-triggered theft. Transfers a flat amount (10–30 % of victim's money,
 * min 1) from victim → thief, damages the victim's bond toward the thief,
 * and writes memories for both. Does NOT check trait thresholds — the player
 * is overriding free will.
 */
export async function manualSteal(
  prisma:    PrismaClient,
  thiefId:   string,
  victimId:  string,
  worldYear: number,
): Promise<StealResult> {
  const [thief, victim] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: thiefId },  select: { id: true, name: true, money: true, age: true } }),
    prisma.person.findUniqueOrThrow({ where: { id: victimId }, select: { id: true, name: true, money: true, age: true } }),
  ]);

  const frac   = THEFT_FRAC_MIN + Math.random() * (THEFT_FRAC_MAX - THEFT_FRAC_MIN);
  const stolen = Math.max(1, Math.floor(Math.abs(victim.money) * frac));

  await Promise.all([
    prisma.$executeRawUnsafe(
      `UPDATE persons SET money = money + $1, updated_at = NOW() WHERE id = $2`,
      stolen, thiefId,
    ),
    prisma.$executeRawUnsafe(
      `UPDATE persons SET money = money - $1, updated_at = NOW() WHERE id = $2`,
      stolen, victimId,
    ),
    // Bond damage: victim's view of thief
    prisma.$executeRawUnsafe(`
      UPDATE inner_circle_links
      SET bond_strength = GREATEST(0, bond_strength - $1), updated_at = NOW()
      WHERE owner_id = $2 AND target_id = $3
    `, THEFT_BOND_DAMAGE, victimId, thiefId),
    writeMemoriesBatch(prisma, [
      {
        personId:        thiefId,
        eventSummary:    `Stole ${stolen} coins from ${victim.name}.`,
        emotionalImpact: 'neutral',
        deltaApplied:    { money: stolen },
        magnitude:       0.45,
        tone:            'tabloid',
        worldYear,
        counterpartyId:  victimId,
        eventKind:       'crime',
        ageAtEvent:      thief.age,
      },
      {
        personId:        victimId,
        eventSummary:    `${thief.name} stole ${stolen} coins from them.`,
        emotionalImpact: 'negative',
        deltaApplied:    { money: -stolen },
        magnitude:       0.55,
        tone:            'tabloid',
        worldYear,
        counterpartyId:  thiefId,
        eventKind:       'crime',
        ageAtEvent:      victim.age,
      },
    ]),
  ]);

  // Read back new bond so the UI can display it
  const link = await prisma.innerCircleLink.findFirst({
    where: { owner_id: victimId, target_id: thiefId },
    select: { bond_strength: true },
  });

  return {
    stolen,
    thief_name:  thief.name,
    victim_name: victim.name,
    new_bond:    link?.bond_strength ?? null,
  };
}

/**
 * Player-triggered gift. Transfers `amount` from donor → recipient,
 * boosts recipient's bond toward donor, and writes memories for both.
 */
export async function manualGift(
  prisma:      PrismaClient,
  donorId:     string,
  recipientId: string,
  amount:      number,
  worldYear:   number,
): Promise<GiftResult> {
  if (amount <= 0) throw new Error('Gift amount must be positive');

  const [donor, recipient] = await Promise.all([
    prisma.person.findUniqueOrThrow({ where: { id: donorId },     select: { id: true, name: true, age: true } }),
    prisma.person.findUniqueOrThrow({ where: { id: recipientId }, select: { id: true, name: true, age: true } }),
  ]);

  await Promise.all([
    prisma.$executeRawUnsafe(
      `UPDATE persons SET money = money - $1, updated_at = NOW() WHERE id = $2`,
      amount, donorId,
    ),
    prisma.$executeRawUnsafe(
      `UPDATE persons SET money = money + $1, updated_at = NOW() WHERE id = $2`,
      amount, recipientId,
    ),
    // Bond boost: recipient's view of donor
    prisma.$executeRawUnsafe(`
      UPDATE inner_circle_links
      SET bond_strength = LEAST(100, bond_strength + $1), updated_at = NOW()
      WHERE owner_id = $2 AND target_id = $3
    `, GIFT_BOND_BOOST, recipientId, donorId),
    writeMemoriesBatch(prisma, [
      {
        personId:        donorId,
        eventSummary:    `Gifted ${amount} coins to ${recipient.name}.`,
        emotionalImpact: 'positive',
        deltaApplied:    { money: -amount },
        magnitude:       0.35,
        tone:            'literary',
        worldYear,
        counterpartyId:  recipientId,
        ageAtEvent:      donor.age,
      },
      {
        personId:        recipientId,
        eventSummary:    `${donor.name} gave them ${amount} coins as a gift.`,
        emotionalImpact: 'positive',
        deltaApplied:    { money: amount },
        magnitude:       0.35,
        tone:            'literary',
        worldYear,
        counterpartyId:  donorId,
        ageAtEvent:      recipient.age,
      },
    ]),
  ]);

  const link = await prisma.innerCircleLink.findFirst({
    where: { owner_id: recipientId, target_id: donorId },
    select: { bond_strength: true },
  });

  return {
    amount,
    donor_name:     donor.name,
    recipient_name: recipient.name,
    new_bond:       link?.bond_strength ?? null,
  };
}
