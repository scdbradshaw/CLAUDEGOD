// Phase 13a — Interactions service (§15.3 step 1).
//
// Loads alive real persons + their bonds, runs the pure planner from
// `engine/interactions.ts`, and applies effects against the open year-pipeline
// transaction:
//
//   - Memory entries (actor always; target only when the outcome succeeded —
//     failures are flavor for the actor only, see Step 4 below).
//   - Successful gift: wealth transfer from actor → target (clamped to actor's
//     running balance to avoid negatives).
//   - Successful betray: drops the actor's bond toward target if one existed.
//   - Successful chat with a stranger: writes a 'ally' bond (cap-respecting
//     via setBondTx).
//
// Performance refactor (2026-05-01): the apply path used to fire 4–8
// sequential round-trips per outcome (read+write recent_memories twice, plus
// gift/bond/conversion writes), which pushed the phase past 20s at ~1k
// persons. We now:
//   1. Accumulate every effect in plain JS state during a pure outcome loop.
//   2. Flush in batches at the end: one update per dirty person for memories,
//      one per net-changed person for wealth, single deleteMany for bond
//      drops, parallel updates for conversions + member-count bumps.
//   3. Skip the target-side memory entry on failed outcomes (flavor only;
//      no game logic depends on it). Halves memory writes in practice.
//   4. (engine/interactions.ts) Pre-bucket persons by city so pickTarget
//      walks the city slice instead of the world.

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  planInteractions,
  type BondForInteraction,
  type InteractionOutcome,
  type PersonForInteraction,
} from '../engine/interactions';
import {
  RELIGION_TALK_PER_TAG_CHANCE,
  type Memory,
  type PersonalityTag,
  type RelationshipKind,
} from '@claude-god/shared';
import type { Rng } from '../lib/rng';
import { addMemory } from '../engine/memory';
import { planAddBond, type BondRow } from '../engine/relationships';

/** Kinds of interaction where preaching/conversion can happen (§8.3). */
const CONVERSION_KINDS = new Set<InteractionOutcome['kind']>([
  'chat',
  'gift',
  'comfort',
  'romance',
]);

/** Intel curve from §8.3:
 *    1.0 below 30 · 0.5 at 60 · 0.0 at 90+
 *  Below-average intelligence is fully susceptible; high-intel targets resist.
 */
function intelFactor(intel: number): number {
  const f = 1 - (intel - 30) / 60;
  return Math.max(0, Math.min(1, f));
}

type TxClient = Prisma.TransactionClient | PrismaClient;

const FRIENDLY_TONES: Record<string, Memory['tone']> = {
  chat: 'literary',
  gift: 'literary',
  comfort: 'literary',
  romance: 'literary',
  argue: 'tabloid',
  betray: 'tabloid',
};

function summary(out: InteractionOutcome, otherName: string): string {
  const verbed = (
    {
      chat: out.success ? `had a good chat with ${otherName}` : `tried to chat with ${otherName} (it went nowhere)`,
      gift: out.success ? `gave ${otherName} a gift` : `tried to give ${otherName} a gift (declined)`,
      comfort: out.success ? `comforted ${otherName}` : `failed to console ${otherName}`,
      romance: out.success ? `shared a romantic moment with ${otherName}` : `made a clumsy pass at ${otherName}`,
      argue: out.success ? `won an argument with ${otherName}` : `lost an argument with ${otherName}`,
      betray: out.success ? `betrayed ${otherName}` : `tried to betray ${otherName} (failed)`,
    } as const
  )[out.kind];
  return verbed;
}

function summaryReceived(out: InteractionOutcome, actorName: string): string {
  const phrased = (
    {
      chat: out.success ? `enjoyed a chat with ${actorName}` : `was bored by ${actorName}`,
      gift: out.success ? `received a gift from ${actorName}` : `refused a gift from ${actorName}`,
      comfort: out.success ? `was comforted by ${actorName}` : `was approached awkwardly by ${actorName}`,
      romance: out.success ? `shared a romantic moment with ${actorName}` : `rebuffed ${actorName}`,
      argue: out.success ? `lost an argument with ${actorName}` : `won an argument with ${actorName}`,
      betray: out.success ? `was betrayed by ${actorName}` : `caught ${actorName} attempting to betray them`,
    } as const
  )[out.kind];
  return phrased;
}

function magnitude(out: InteractionOutcome): number {
  // Calibrated low — these are flavor entries that should not crowd out
  // big life events (deaths, marriages). Betrayals get a punch.
  if (out.kind === 'betray' && out.success) return 0.7;
  if (out.kind === 'romance' && out.success) return 0.5;
  if (out.kind === 'gift' && out.success) return 0.4;
  if (out.kind === 'argue' && out.success) return 0.35;
  return 0.25;
}

export async function runInteractionsPhaseTx(
  worldId: string,
  year: number,
  rng: Rng,
  tx: TxClient,
): Promise<{ outcomes: number }> {
  const persons = await tx.person.findMany({
    where: { world_id: worldId, is_alive: true },
    select: {
      id: true,
      name: true,
      city_id: true,
      age: true,
      wealth: true,
      is_pinned: true,
      religion_id: true,
      intelligence: true,
      personality_tags: true,
      recent_memories: true,
    },
  });
  if (persons.length < 2) return { outcomes: 0 };

  const nameById = new Map(persons.map((p) => [p.id, p.name]));
  const personIds = new Set(persons.map((p) => p.id));

  // ── In-memory state mutated during the outcome loop. ──
  // memoryBuf: each person's recent_memories buffer (mutated locally; flushed
  // in one update per dirty person at the end).
  const memoryBuf = new Map<string, Memory[]>();
  for (const p of persons) {
    memoryBuf.set(
      p.id,
      (Array.isArray(p.recent_memories) ? p.recent_memories : []) as unknown as Memory[],
    );
  }
  const memoryDirty = new Set<string>();
  // wealth tracking: running balance lets us clamp gifts without DB reads;
  // delta is what we flush.
  const wealthNow = new Map(persons.map((p) => [p.id, p.wealth]));
  const wealthDelta = new Map<string, number>();
  // Bond-side effects collected for batched apply.
  const bondsToDelete: { owner_id: string; target_id: string }[] = [];
  const bondSetCalls: { owner_id: string; target_id: string; strength: number }[] = [];
  // Conversion side effects (§8.3).
  const conversions: { personId: string; religionId: string }[] = [];
  const conversionGroupBumps = new Map<string, number>(); // religion_id → count bump

  // Mutable per-person view used during conversion (religion_id flips when
  // someone is preached to). personality_tags + intelligence are cached
  // immutable for this phase — tags are static, intel doesn't shift this loop.
  type ConvState = {
    religion_id: string | null;
    intelligence: number;
    tags: PersonalityTag[];
  };
  const stateById = new Map<string, ConvState>();
  for (const p of persons) {
    const tags = (Array.isArray(p.personality_tags) ? p.personality_tags : []) as PersonalityTag[];
    stateById.set(p.id, {
      religion_id: p.religion_id,
      intelligence: p.intelligence,
      tags,
    });
  }

  // Load active religions for the world so we can look up wanted_tags by id.
  const religionRows = await tx.group.findMany({
    where: { world_id: worldId, kind: 'religion', is_active: true },
    select: { id: true, name: true, wanted_tags: true },
  });
  const religionById = new Map(
    religionRows.map((r) => [
      r.id,
      {
        id: r.id,
        name: r.name,
        wanted_tags: (Array.isArray(r.wanted_tags) ? r.wanted_tags : []) as PersonalityTag[],
      },
    ]),
  );

  // Load id + set_year too — bulk-apply path needs them for planAddBond.
  const bondRows = await tx.relationship.findMany({
    where: { owner_id: { in: persons.map((p) => p.id) } },
    select: { id: true, owner_id: true, target_id: true, kind: true, strength: true, set_year: true },
  });
  const bonds: BondForInteraction[] = bondRows
    .filter((b) => personIds.has(b.target_id))
    .map((b) => ({
      owner_id: b.owner_id,
      target_id: b.target_id,
      kind: b.kind as RelationshipKind,
      strength: b.strength,
    }));

  // Per-owner in-memory bond list, used by the bulk bond apply below. Mutated
  // as we plan each chat-success spawn so subsequent picks see the new state
  // (matches the per-call setBondTx semantics).
  const bondsByOwner = new Map<string, BondRow[]>();
  for (const b of bondRows) {
    const arr = bondsByOwner.get(b.owner_id) ?? [];
    arr.push({
      id: b.id,
      target_id: b.target_id,
      kind: b.kind as RelationshipKind,
      strength: b.strength,
      set_year: b.set_year,
    });
    bondsByOwner.set(b.owner_id, arr);
  }

  const planInput: PersonForInteraction[] = persons.map((p) => ({
    id: p.id,
    city_id: p.city_id,
    age: p.age,
    wealth: p.wealth,
    is_pinned: p.is_pinned,
  }));
  const outcomes = planInteractions(planInput, bonds, rng);

  // ── Outcome iteration: pure in-memory accumulation. No DB calls. ──
  for (const out of outcomes) {
    const actorName = nameById.get(out.actor_id) ?? 'someone';
    const targetName = nameById.get(out.target_id) ?? 'someone';
    const tone = FRIENDLY_TONES[out.kind] ?? 'literary';
    const mag = magnitude(out);

    // Actor memory: always (failures still constitute "tried something").
    pushMemory(memoryBuf, memoryDirty, out.actor_id, {
      year,
      kind: `interaction-${out.kind}`,
      summary: summary(out, targetName),
      magnitude: mag,
      counterparty_id: out.target_id,
      tone,
    });

    // Target memory: only on success. Step 4 throttling — failures are flavor
    // for the actor only and never carry side-effects, so the target's buffer
    // doesn't need a cap-eligible entry for them.
    if (out.success) {
      pushMemory(memoryBuf, memoryDirty, out.target_id, {
        year,
        kind: `interaction-${out.kind}-recv`,
        summary: summaryReceived(out, actorName),
        magnitude: mag * 0.9,
        counterparty_id: out.actor_id,
        tone,
      });
    }

    // Wealth transfer for successful gifts. Clamp to actor's running balance
    // (multiple gifts in one year can't overdraw).
    if (out.success && out.kind === 'gift' && out.gift_amount && out.gift_amount > 0) {
      const cur = wealthNow.get(out.actor_id) ?? 0;
      if (cur > 0) {
        const amt = Math.min(cur, out.gift_amount);
        wealthNow.set(out.actor_id, cur - amt);
        wealthNow.set(out.target_id, (wealthNow.get(out.target_id) ?? 0) + amt);
        wealthDelta.set(out.actor_id, (wealthDelta.get(out.actor_id) ?? 0) - amt);
        wealthDelta.set(out.target_id, (wealthDelta.get(out.target_id) ?? 0) + amt);
      }
    }

    // Successful chat-spawn — propose a new ally bond. Applied below via
    // setBondTx (cap-5 enforced + drift memory for any eviction).
    if (out.success && out.spawn_bond) {
      bondSetCalls.push({
        owner_id: out.actor_id,
        target_id: out.target_id,
        strength: out.spawn_bond.strength,
      });
    }

    // Successful betray — drop the actor's bond toward target if any.
    if (out.success && out.kind === 'betray' && out.drop_bond) {
      bondsToDelete.push({ owner_id: out.actor_id, target_id: out.target_id });
    }

    // §8.3 — Talk-based religion conversion.
    // Only on successful friendly/romantic outcomes; only when the actor
    // belongs to a religion they personally embody (≥1 of their tags is
    // wanted) and the target is unaffiliated. Final chance compounds:
    //   tag_chance  = min(1, 0.25 × matching_tags_on_target)
    //   intel_chance = clamp(1 - (target.intel - 30) / 60, 0, 1)
    if (out.success && CONVERSION_KINDS.has(out.kind)) {
      const actorState = stateById.get(out.actor_id);
      const targetState = stateById.get(out.target_id);
      if (
        actorState &&
        targetState &&
        actorState.religion_id != null &&
        targetState.religion_id == null
      ) {
        const religion = religionById.get(actorState.religion_id);
        if (religion && religion.wanted_tags.length > 0) {
          const wanted = new Set(religion.wanted_tags);
          const actorMatch = actorState.tags.some((t) => wanted.has(t));
          if (actorMatch) {
            const targetMatchCount = targetState.tags.reduce(
              (n, t) => (wanted.has(t) ? n + 1 : n),
              0,
            );
            const tagChance = Math.min(
              1,
              RELIGION_TALK_PER_TAG_CHANCE * targetMatchCount,
            );
            const intelChance = intelFactor(targetState.intelligence);
            const finalChance = tagChance * intelChance;
            if (finalChance > 0 && rng.next() < finalChance) {
              // Stamp in-memory so we don't double-convert this person later
              // in the same phase.
              targetState.religion_id = religion.id;
              conversions.push({ personId: out.target_id, religionId: religion.id });
              conversionGroupBumps.set(
                religion.id,
                (conversionGroupBumps.get(religion.id) ?? 0) + 1,
              );
              pushMemory(memoryBuf, memoryDirty, out.target_id, {
                year,
                kind: 'religion-converted',
                summary: `was moved by ${actorName} and joined ${religion.name}`,
                magnitude: 0.6,
                counterparty_id: out.actor_id,
                tone: 'literary',
              });
              pushMemory(memoryBuf, memoryDirty, out.actor_id, {
                year,
                kind: 'religion-preached',
                summary: `brought ${targetName} into ${religion.name}`,
                magnitude: 0.5,
                counterparty_id: out.target_id,
                tone: 'literary',
              });
            }
          }
        }
      }
    }
  }

  // ── Apply phase: batched DB writes. ──

  // 1. Memory: a single bulk UPDATE … FROM (VALUES …) statement covers every
  // dirty person in one round-trip. Prisma's interactive transaction
  // serializes queries over a single connection, so even Promise.all of N
  // updates hits the wire one-at-a-time — bulk SQL is the only way to drop
  // round-trip count to 1 here.
  if (memoryDirty.size > 0) {
    const rows = [...memoryDirty].map((id) => {
      const memJson = JSON.stringify(memoryBuf.get(id) ?? []);
      return Prisma.sql`(${id}::text, ${memJson}::jsonb)`;
    });
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET recent_memories = v.mem
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, mem)
      WHERE p.id = v.id
    `;
  }

  // 2. Wealth: same bulk-UPDATE pattern, applying signed deltas. In-memory
  // clamping above guarantees p.wealth + delta >= 0 for every row.
  if (wealthDelta.size > 0) {
    const rows = [...wealthDelta].map(([id, delta]) =>
      Prisma.sql`(${id}::text, ${delta}::int)`,
    );
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET wealth = p.wealth + v.delta
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, delta)
      WHERE p.id = v.id
    `;
  }

  // 3. Bond drops: a single deleteMany covering every betray success.
  if (bondsToDelete.length > 0) {
    await tx.relationship.deleteMany({
      where: { OR: bondsToDelete },
    });
  }

  // 4. Bond proposals from stranger-chat. Plan each in JS using the running
  //    in-memory bondsByOwner state (mirrors setBondTx semantics — cap-5,
  //    in-place strength bump on dup, weakest-eviction with drift memory).
  //    Then flush as: one createMany for new rows, one bulk UPDATE for
  //    in-place strength bumps, one deleteMany for evictions, and a final
  //    bulk UPDATE for any drift memories that landed after step 1.
  const bondInserts: Prisma.RelationshipCreateManyInput[] = [];
  const bondUpdates: { id: string; strength: number; set_year: number }[] = [];
  const bondEvictIds: string[] = [];
  const driftMemoryOwners = new Set<string>();
  for (const call of bondSetCalls) {
    if (call.owner_id === call.target_id) continue; // self_bond_forbidden
    const existing = bondsByOwner.get(call.owner_id) ?? [];
    const candidate: BondRow = {
      target_id: call.target_id,
      kind: 'ally',
      strength: call.strength,
      set_year: year,
    };
    const plan = planAddBond(existing, candidate);
    if (!plan.added) continue;

    const dup = existing.find(
      (b) => b.target_id === call.target_id && b.kind === 'ally',
    );
    if (dup && dup.id) {
      bondUpdates.push({ id: dup.id, strength: call.strength, set_year: year });
      bondsByOwner.set(
        call.owner_id,
        existing.map((b) =>
          b.id === dup.id ? { ...b, strength: call.strength, set_year: year } : b,
        ),
      );
      continue;
    }

    if (plan.evicted?.id) {
      bondEvictIds.push(plan.evicted.id);
      pushMemory(memoryBuf, memoryDirty, call.owner_id, {
        year,
        kind: 'drifted-apart',
        summary: `drifted apart from a former ${plan.evicted.kind}`,
        magnitude: 0.15,
        counterparty_id: plan.evicted.target_id,
        tone: 'neutral',
      });
      driftMemoryOwners.add(call.owner_id);
    }

    bondInserts.push({
      owner_id: call.owner_id,
      target_id: call.target_id,
      kind: 'ally',
      strength: call.strength,
      set_year: year,
    });
    const next = plan.evicted?.id
      ? existing.filter((b) => b.id !== plan.evicted!.id)
      : existing.slice();
    next.push({ ...candidate });
    bondsByOwner.set(call.owner_id, next);
  }

  if (bondEvictIds.length > 0) {
    await tx.relationship.deleteMany({ where: { id: { in: bondEvictIds } } });
  }
  if (bondUpdates.length > 0) {
    const rows = bondUpdates.map((u) =>
      Prisma.sql`(${u.id}::text, ${u.strength}::int, ${u.set_year}::int)`,
    );
    await tx.$executeRaw`
      UPDATE "Relationship" AS r
      SET strength = v.s, set_year = v.y
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, s, y)
      WHERE r.id = v.id
    `;
  }
  if (bondInserts.length > 0) {
    await tx.relationship.createMany({ data: bondInserts, skipDuplicates: true });
  }
  // Drift memories arrived after step 1's flush — re-flush just the affected
  // owners' buffers so the DB sees the eviction memory entry.
  if (driftMemoryOwners.size > 0) {
    const rows = [...driftMemoryOwners].map((id) => {
      const memJson = JSON.stringify(memoryBuf.get(id) ?? []);
      return Prisma.sql`(${id}::text, ${memJson}::jsonb)`;
    });
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET recent_memories = v.mem
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, mem)
      WHERE p.id = v.id
    `;
  }

  // 5. Conversions: bulk UPDATE for all converted persons in one round-trip;
  //    per-religion member-count bumps stay parallel (small N — one row per
  //    religion).
  if (conversions.length > 0) {
    const rows = conversions.map((c) =>
      Prisma.sql`(${c.personId}::text, ${c.religionId}::text, ${year}::int)`,
    );
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET religion_id = v.rid,
          religion_joined_year = v.yr,
          unmatched_religion_years = 0,
          dues_missed_religion = 0
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, rid, yr)
      WHERE p.id = v.id
    `;
    await Promise.all(
      [...conversionGroupBumps].map(([religionId, n]) =>
        tx.group.update({
          where: { id: religionId },
          data: { member_count_cached: { increment: n } },
        }),
      ),
    );
  }

  return { outcomes: outcomes.length };
}

function pushMemory(
  buf: Map<string, Memory[]>,
  dirty: Set<string>,
  personId: string,
  entry: Memory,
): void {
  const cur = buf.get(personId);
  if (!cur) return; // not in our loaded set (defensive)
  buf.set(personId, addMemory(cur, entry));
  dirty.add(personId);
}
