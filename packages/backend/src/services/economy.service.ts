// Phase 10 — real-person economy service (DESIGN.md §6.1, §6.3, §6.4).
//
// Runs immediately after the bucket-dynamics phase in the year pipeline.
// Applies, in order, to every alive real person in the world:
//
//   1. Income (per-type flat × global event modifiers).
//   2. Faction + religion dues. 3 consecutive misses → kicked from group.
//   3. Market investment returns (intelligence% × wealth × index ratio).
//
// Group treasuries also receive bucket-side dues (computed by the
// bucket-dynamics orchestrator and passed in here as `bucketDuesOutcomes`).
// Those flow into Group.treasury within this service so all treasury writes
// live in one place.

import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import {
  type ActiveEventTags,
  applyDues,
  applyRealPersonIncome,
  applyRealPersonInvestment,
  computeNobleDividend,
  type GroupForDues,
  type RealPersonForEconomy,
} from '../engine/economy';
import { addMemory } from '../engine/memory';
import type { Memory } from '@claude-god/shared';

type TxClient = Prisma.TransactionClient | PrismaClient;

export interface RunRealPersonEconomyInput {
  world_id: string;
  year: number;
  /** Market index BEFORE this year's drift step. Captured by year.service
   * before runBucketDynamics runs. */
  prev_index: number;
  /** Market index AFTER this year's drift step. */
  next_index: number;
  /** §6.1 event modifier flags derived from active WorldEvents. */
  active_events: ActiveEventTags;
  /** Bucket-side dues totals from runBucketDynamics — keyed by group_id.
   * Already debited from bucket avg_wealth in the orchestrator; this service
   * credits the matching Group.treasury rows. */
  bucket_dues_by_group: Record<string, number>;
  /** City id for noble-dividend math (single-city worlds in v1). */
  city_id: string;
  /** Tax collected this year (from runBucketDynamics diagnostics). The noble
   * dividend skims NOBLE_DIVIDEND_PCT of this from the city treasury and
   * splits it across all Nobles. */
  tax_collected: number;
}

export interface RunRealPersonEconomyResult {
  total_income: number;
  total_dues_collected: number;
  total_kicked: number;
  total_returns: number;
  /** Per-group total dues credited to treasury THIS YEAR (bucket + real
   *  member portions combined). Consumed by `runFactionAwardsTx` to size the
   *  prize pool — note Group.treasury also carries prior-year balance, but
   *  awards only pay out from this year's intake. */
  dues_by_group_this_year: Record<string, number>;
  /** Total gold paid out as noble tax dividend this year (0 if no Nobles). */
  noble_dividend_paid: number;
}

export async function runRealPersonEconomyPhaseTx(
  input: RunRealPersonEconomyInput,
  tx: TxClient,
): Promise<RunRealPersonEconomyResult> {
  // ── 1. Load alive real persons + active groups ───────────────────────────
  const personRows = await tx.person.findMany({
    where: { world_id: input.world_id, is_alive: true },
    select: {
      id: true,
      type: true,
      wealth: true,
      intelligence: true,
      faction_id: true,
      religion_id: true,
      dues_missed_faction: true,
      dues_missed_religion: true,
    },
  });

  if (personRows.length === 0) {
    // Still apply bucket-side dues to treasuries (they don't depend on real persons).
    await applyBucketDuesToTreasuriesTx(input.bucket_dues_by_group, tx);
    // Noble dividend can still pay out to bucket Nobles even with no real persons.
    const nobleResult = await applyNobleDividendTx(
      input.city_id,
      input.tax_collected,
      [],
      tx,
    );
    return {
      total_income: 0,
      total_dues_collected: sumValues(input.bucket_dues_by_group),
      total_kicked: 0,
      total_returns: 0,
      dues_by_group_this_year: { ...input.bucket_dues_by_group },
      noble_dividend_paid: nobleResult.total_paid,
    };
  }

  const groupRows = await tx.group.findMany({
    where: { world_id: input.world_id, is_active: true },
    select: {
      id: true,
      kind: true,
      cost_per_year: true,
      cost_pct_of_wealth: true,
      is_active: true,
      member_count_cached: true,
    },
  });

  const persons: RealPersonForEconomy[] = personRows.map((p) => ({
    id: p.id,
    type: p.type,
    wealth: p.wealth,
    intelligence: p.intelligence,
    faction_id: p.faction_id,
    religion_id: p.religion_id,
    dues_missed_faction: p.dues_missed_faction,
    dues_missed_religion: p.dues_missed_religion,
  }));

  const groups: GroupForDues[] = groupRows.map((g) => ({
    id: g.id,
    kind: g.kind,
    cost_per_year: g.cost_per_year,
    cost_pct_of_wealth: g.cost_pct_of_wealth,
    is_active: g.is_active,
    member_count_cached: g.member_count_cached,
  }));

  // ── 2. Apply income ──────────────────────────────────────────────────────
  const incomeResult = applyRealPersonIncome(persons, input.active_events);
  const wealthAfterIncome = new Map(incomeResult.updates.map((u) => [u.person_id, u.wealth]));

  // Per-person gross income this year (delta vs starting wealth) — used to
  // accumulate the faction competition ledger below.
  const grossIncomeByPerson = new Map<string, number>();
  for (const p of persons) {
    const after = wealthAfterIncome.get(p.id) ?? p.wealth;
    grossIncomeByPerson.set(p.id, Math.max(0, after - p.wealth));
  }

  // Mutate working copies in-place for the dues + investment passes.
  const personsAfterIncome: RealPersonForEconomy[] = persons.map((p) => ({
    ...p,
    wealth: wealthAfterIncome.get(p.id) ?? p.wealth,
  }));

  // ── 3. Apply real-person dues. Bucket dues already pre-summed by caller;
  //       we pass `0` for each group's bucketDues here because those deltas
  //       were already applied to bucket avg_wealth inside runBucketDynamics
  //       (they don't apply to real persons). The applyDues function returns
  //       only the real-member portion in this call. ─────────────────────────
  const realDuesResult = applyDues({
    groups,
    realMembers: personsAfterIncome,
    bucketDuesByGroup: {}, // bucket dues already captured upstream
  });

  // Apply per-member dues outcomes back onto the working copy + collect kicks.
  const kicked: Array<{ person_id: string; group_id: string; kind: 'faction' | 'religion' }> = [];
  const memberById = new Map(personsAfterIncome.map((p) => [p.id, p]));
  let realDebited = 0;

  for (const outcome of realDuesResult.outcomes) {
    const group = groups.find((g) => g.id === outcome.group_id);
    if (!group) continue;
    for (const m of outcome.real_member_outcomes) {
      const p = memberById.get(m.person_id);
      if (!p) continue;
      p.wealth = Math.max(0, p.wealth - m.paid);
      realDebited += m.paid;
      if (group.kind === 'faction') p.dues_missed_faction = m.new_missed_count;
      else p.dues_missed_religion = m.new_missed_count;
      if (m.kicked) {
        kicked.push({ person_id: p.id, group_id: group.id, kind: group.kind });
        if (group.kind === 'faction') p.faction_id = null;
        else p.religion_id = null;
      }
    }
  }

  // ── 4. Apply investment returns on wealth post-income, post-dues ─────────
  const investResult = applyRealPersonInvestment(
    [...memberById.values()],
    input.prev_index,
    input.next_index,
  );

  // ── 5. Persist all per-person updates in one batched pass ────────────────
  // The hot loop used to be ~N awaited tx.person.update calls; over a single
  // Prisma interactive-tx connection that's ~N round-trips and was the
  // dominant cost of the year. We now build (id, wealth, dmf, dmr, fy_delta)
  // rows and emit a single bulk UPDATE … FROM (VALUES …) — one round-trip
  // regardless of N. Kicks (small set) get a follow-up bulk UPDATE for the
  // FK + joined_year nulls.
  const finalWealthById = new Map(investResult.updates.map((u) => [u.person_id, u.wealth]));
  const kickedFactionIds = new Set(
    kicked.filter((k) => k.kind === 'faction').map((k) => k.person_id),
  );
  const kickedReligionIds = new Set(
    kicked.filter((k) => k.kind === 'religion').map((k) => k.person_id),
  );

  const updateRows: Prisma.Sql[] = [];
  for (const p of memberById.values()) {
    const finalWealth = finalWealthById.get(p.id) ?? p.wealth;
    const gross = grossIncomeByPerson.get(p.id) ?? 0;
    // Only credit the ledger if the member is still in the faction at the
    // end of dues processing — if they got kicked, this year doesn't count.
    const inFactionAfter = p.faction_id != null && !kickedFactionIds.has(p.id);
    const fyDelta = inFactionAfter && gross > 0 ? gross : 0;
    updateRows.push(
      Prisma.sql`(${p.id}::text, ${finalWealth}::int, ${p.dues_missed_faction}::int, ${p.dues_missed_religion}::int, ${fyDelta}::int)`,
    );
  }
  if (updateRows.length > 0) {
    await tx.$executeRaw`
      UPDATE "Person" AS p
      SET wealth = v.wealth,
          dues_missed_faction = v.dmf,
          dues_missed_religion = v.dmr,
          faction_income_year = p.faction_income_year + v.fy_delta
      FROM (VALUES ${Prisma.join(updateRows)}) AS v(id, wealth, dmf, dmr, fy_delta)
      WHERE p.id = v.id
    `;
  }
  // Faction kicks: bulk-null faction_id + faction_joined_year.
  if (kickedFactionIds.size > 0) {
    const ids = [...kickedFactionIds].map((id) => Prisma.sql`${id}::text`);
    await tx.$executeRaw`
      UPDATE "Person"
      SET faction_id = NULL, faction_joined_year = NULL
      WHERE id IN (${Prisma.join(ids)})
    `;
  }
  // Religion kicks: same pattern.
  if (kickedReligionIds.size > 0) {
    const ids = [...kickedReligionIds].map((id) => Prisma.sql`${id}::text`);
    await tx.$executeRaw`
      UPDATE "Person"
      SET religion_id = NULL, religion_joined_year = NULL
      WHERE id IN (${Prisma.join(ids)})
    `;
  }

  // ── 6. Treasury writes: bucket dues (from caller) + real dues (this pass)
  //       and member_count_cached decrements for any kicks. ──────────────────
  const bucketDuesById = input.bucket_dues_by_group;
  const realDuesById = new Map<string, number>();
  for (const outcome of realDuesResult.outcomes) {
    realDuesById.set(outcome.group_id, outcome.collected);
  }

  const allGroupIds = new Set<string>([
    ...Object.keys(bucketDuesById),
    ...realDuesById.keys(),
  ]);
  // Track combined per-group dues this year so the faction-awards step can
  // size each prize pool from intake (not from accumulated treasury).
  const duesByGroupThisYear: Record<string, number> = {};
  const treasuryUpdates: Promise<unknown>[] = [];
  for (const gid of allGroupIds) {
    const total = (bucketDuesById[gid] ?? 0) + (realDuesById.get(gid) ?? 0);
    duesByGroupThisYear[gid] = total;
    if (total <= 0) continue;
    treasuryUpdates.push(
      tx.group.update({
        where: { id: gid },
        data: { treasury: { increment: Math.round(total) } },
      }),
    );
  }
  if (treasuryUpdates.length > 0) await Promise.all(treasuryUpdates);

  // member_count_cached decrements: bulk by (group_id, count).
  if (kicked.length > 0) {
    const perGroupKicks = new Map<string, number>();
    for (const k of kicked) {
      perGroupKicks.set(k.group_id, (perGroupKicks.get(k.group_id) ?? 0) + 1);
    }
    await Promise.all(
      [...perGroupKicks].map(([gid, n]) =>
        tx.group.update({
          where: { id: gid },
          data: { member_count_cached: { decrement: n } },
        }),
      ),
    );

    // Kick memos: load recent_memories for the kicked set in one query, mutate
    // in JS, write back as a single bulk UPDATE.
    const kickedIds = [...new Set(kicked.map((k) => k.person_id))];
    const memRows = await tx.person.findMany({
      where: { id: { in: kickedIds } },
      select: { id: true, recent_memories: true },
    });
    const memBuf = new Map<string, Memory[]>();
    for (const r of memRows) {
      memBuf.set(
        r.id,
        (Array.isArray(r.recent_memories) ? r.recent_memories : []) as unknown as Memory[],
      );
    }
    for (const k of kicked) {
      const buf = memBuf.get(k.person_id);
      if (!buf) continue;
      memBuf.set(
        k.person_id,
        addMemory(buf, {
          year: input.year,
          kind: 'kicked-from-group',
          summary: `expelled from ${k.kind} for unpaid dues`,
          magnitude: 0.6,
          counterparty_id: k.group_id,
          tone: 'reportage',
        }),
      );
    }
    const memUpdateRows = [...memBuf].map(([id, buf]) =>
      Prisma.sql`(${id}::text, ${JSON.stringify(buf)}::jsonb)`,
    );
    if (memUpdateRows.length > 0) {
      await tx.$executeRaw`
        UPDATE "Person" AS p
        SET recent_memories = v.mem
        FROM (VALUES ${Prisma.join(memUpdateRows)}) AS v(id, mem)
        WHERE p.id = v.id
      `;
    }
  }

  // ── 7. Noble tax dividend (role-power §). Skim NOBLE_DIVIDEND_PCT of city
  //       tax_collected from the treasury and split per-capita across all
  //       Nobles in the city (real persons + bucket aggregate). ──────────────
  const realNobleIds = persons
    .filter((p) => p.type === 'Noble')
    .map((p) => p.id);
  const nobleResult = await applyNobleDividendTx(
    input.city_id,
    input.tax_collected,
    realNobleIds,
    tx,
  );

  return {
    total_income: incomeResult.total_gross,
    total_dues_collected: sumValues(input.bucket_dues_by_group) + realDebited,
    total_kicked: kicked.length,
    total_returns: investResult.total_returns,
    dues_by_group_this_year: duesByGroupThisYear,
    noble_dividend_paid: nobleResult.total_paid,
  };
}

/**
 * Pay out the noble tax dividend. Reads current treasury + bucket Noble count,
 * computes the per-capita share, and writes:
 *   • city.treasury -= total_paid
 *   • each real Noble.wealth += per_noble
 *   • Noble bucket avg_wealth bumped by per_noble (totalWealth-preserving)
 * Returns the dividend result for diagnostics / propagation.
 */
async function applyNobleDividendTx(
  cityId: string,
  taxCollected: number,
  realNobleIds: string[],
  tx: TxClient,
): Promise<{ total_paid: number; per_noble: number }> {
  const city = await tx.city.findUnique({
    where: { id: cityId },
    select: { treasury: true },
  });
  if (!city) return { total_paid: 0, per_noble: 0 };

  const nobleBucket = await tx.bucket.findUnique({
    where: { city_id_type: { city_id: cityId, type: 'Noble' } },
    select: { count: true, avg_wealth: true },
  });
  const bucketCount = nobleBucket?.count ?? 0;

  const dividend = computeNobleDividend({
    tax_collected: taxCollected,
    treasury: city.treasury,
    real_noble_count: realNobleIds.length,
    bucket_noble_count: bucketCount,
  });
  if (dividend.total_paid <= 0) {
    return { total_paid: 0, per_noble: 0 };
  }

  // Debit treasury.
  await tx.city.update({
    where: { id: cityId },
    data: { treasury: dividend.new_treasury },
  });

  // Credit real Nobles (+per_noble each).
  if (realNobleIds.length > 0 && dividend.per_noble > 0) {
    const ids = realNobleIds.map((id) => Prisma.sql`${id}::text`);
    await tx.$executeRaw`
      UPDATE "Person"
      SET wealth = wealth + ${dividend.per_noble}
      WHERE id IN (${Prisma.join(ids)})
    `;
  }

  // Credit Noble bucket (avg_wealth += per_noble).
  if (nobleBucket && bucketCount > 0 && dividend.per_noble > 0) {
    const totalWealth = bucketCount * nobleBucket.avg_wealth + dividend.to_bucket;
    const newAvgWealth = Math.round(totalWealth / bucketCount);
    await tx.bucket.update({
      where: { city_id_type: { city_id: cityId, type: 'Noble' } },
      data: { avg_wealth: newAvgWealth },
    });
  }

  return { total_paid: dividend.total_paid, per_noble: dividend.per_noble };
}

async function applyBucketDuesToTreasuriesTx(
  bucketDuesByGroup: Record<string, number>,
  tx: TxClient,
): Promise<void> {
  for (const [gid, amount] of Object.entries(bucketDuesByGroup)) {
    if (amount <= 0) continue;
    await tx.group.update({
      where: { id: gid },
      data: { treasury: { increment: Math.round(amount) } },
    });
  }
}

function sumValues(rec: Record<string, number>): number {
  return Object.values(rec).reduce((s, v) => s + v, 0);
}

