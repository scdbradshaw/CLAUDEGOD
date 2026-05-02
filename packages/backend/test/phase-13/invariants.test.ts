import { describe, it, expect } from 'vitest';
import {
  runYearEndInvariants,
  sumWorldWealth,
  InvariantViolationError,
  type InvariantContext,
} from '../../src/engine/invariants';
import { REAL_PERSON_CAP } from '@claude-god/shared';

// ─── Mock tx helpers ─────────────────────────────────────────────────────
// Hand-rolled stubs for the minimal Prisma query surface invariants uses.
// We control every return value so each test exercises exactly one rule.

interface FakeWorld {
  id: string;
  market_index: number;
}

interface FakeBucket {
  city_id: string;
  type: string;
  count: number;
  avg_wealth: number;
  city_world_id: string;
  city_is_ruined: boolean;
}

interface FakePerson {
  id: string;
  world_id: string;
  city_id: string;
  city_world_id: string;
  wealth: number;
  current_health: number;
  is_alive: boolean;
}

interface FakeGroup {
  id: string;
  world_id: string;
  treasury: number;
  army_size: number;
  is_active: boolean;
}

interface FakeCity {
  id: string;
  world_id: string;
  treasury: number;
}

interface FakeDb {
  worlds: FakeWorld[];
  buckets: FakeBucket[];
  persons: FakePerson[];
  groups: FakeGroup[];
  cities: FakeCity[];
}

function makeTx(db: FakeDb) {
  // We only implement the very narrow surface invariants.ts touches.
  return {
    bucket: {
      findFirst: async ({ where, select: _select }: any) => {
        const w = where ?? {};
        const cityW = w.city ?? {};
        return (
          db.buckets.find((b) => {
            if (cityW.world_id && b.city_world_id !== cityW.world_id) return false;
            if (cityW.is_ruined !== undefined && b.city_is_ruined !== cityW.is_ruined) return false;
            if (w.OR) {
              const ok = (w.OR as any[]).some((cond) => {
                if (cond.count?.lt !== undefined) return b.count < cond.count.lt;
                if (cond.avg_wealth?.lt !== undefined) return b.avg_wealth < cond.avg_wealth.lt;
                return false;
              });
              if (!ok) return false;
            }
            return true;
          }) ?? null
        );
      },
      findMany: async ({ where }: any) => {
        const cityW = where?.city ?? {};
        return db.buckets
          .filter((b) => !cityW.world_id || b.city_world_id === cityW.world_id)
          .map((b) => ({ count: b.count, avg_wealth: b.avg_wealth }));
      },
    },
    person: {
      findFirst: async ({ where }: any) => {
        return (
          db.persons.find((p) => {
            if (where.world_id && p.world_id !== where.world_id) return false;
            if (where.city) {
              const notWid = where.city.world_id?.not;
              if (notWid !== undefined && p.city_world_id === notWid) return false;
              if (notWid !== undefined && p.city_world_id === where.world_id) return false;
            }
            if (where.OR) {
              const ok = (where.OR as any[]).some((cond) => {
                if (cond.wealth?.lt !== undefined) return p.wealth < cond.wealth.lt;
                if (cond.current_health?.lt !== undefined) return p.current_health < cond.current_health.lt;
                return false;
              });
              if (!ok) return false;
            }
            return true;
          }) ?? null
        );
      },
      count: async ({ where }: any) => {
        return db.persons.filter(
          (p) => p.world_id === where.world_id && p.is_alive === where.is_alive,
        ).length;
      },
      aggregate: async ({ where }: any) => {
        const sum = db.persons
          .filter((p) => p.world_id === where.world_id && (where.is_alive ? p.is_alive : true))
          .reduce((s, p) => s + p.wealth, 0);
        return { _sum: { wealth: sum } };
      },
    },
    group: {
      findFirst: async ({ where }: any) => {
        return (
          db.groups.find((g) => {
            if (where.world_id && g.world_id !== where.world_id) return false;
            if (where.OR) {
              const ok = (where.OR as any[]).some((cond) => {
                if (cond.treasury?.lt !== undefined) return g.treasury < cond.treasury.lt;
                if (cond.army_size?.lt !== undefined) return g.army_size < cond.army_size.lt;
                return false;
              });
              if (!ok) return false;
            }
            return true;
          }) ?? null
        );
      },
      aggregate: async ({ where }: any) => {
        const sum = db.groups
          .filter((g) => g.world_id === where.world_id && (where.is_active ? g.is_active : true))
          .reduce((s, g) => s + g.treasury, 0);
        return { _sum: { treasury: sum } };
      },
    },
    city: {
      findFirst: async ({ where }: any) => {
        return (
          db.cities.find((c) => {
            if (where.world_id && c.world_id !== where.world_id) return false;
            if (where.OR) {
              const ok = (where.OR as any[]).some((cond) => {
                if (cond.treasury?.lt !== undefined) return c.treasury < cond.treasury.lt;
                return false;
              });
              if (!ok) return false;
            }
            return true;
          }) ?? null
        );
      },
      aggregate: async ({ where }: any) => {
        const sum = db.cities
          .filter((c) => c.world_id === where.world_id)
          .reduce((s, c) => s + c.treasury, 0);
        return { _sum: { treasury: sum } };
      },
    },
    world: {
      findUnique: async ({ where }: any) => {
        return db.worlds.find((w) => w.id === where.id) ?? null;
      },
    },
  } as any;
}

const baseCtx: InvariantContext = {
  world_id: 'w1',
  wealth_at_start: 0,
  wealth_tolerance: 0,
};

const cleanDb = (): FakeDb => ({
  worlds: [{ id: 'w1', market_index: 1 }],
  buckets: [
    { city_id: 'c1', type: 'Farmer', count: 100, avg_wealth: 50, city_world_id: 'w1', city_is_ruined: false },
  ],
  persons: [],
  groups: [],
  cities: [{ id: 'c1', world_id: 'w1', treasury: 100 }],
});

describe('runYearEndInvariants', () => {
  it('passes on a clean world', async () => {
    await expect(runYearEndInvariants(baseCtx, makeTx(cleanDb()))).resolves.toBeUndefined();
  });

  it('throws on negative bucket count', async () => {
    const db = cleanDb();
    db.buckets[0].count = -1;
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toBeInstanceOf(InvariantViolationError);
  });

  it('throws on negative person wealth', async () => {
    const db = cleanDb();
    db.persons.push({
      id: 'p1', world_id: 'w1', city_id: 'c1', city_world_id: 'w1',
      wealth: -5, current_health: 100, is_alive: true,
    });
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toThrow(/no_negatives/);
  });

  it('throws on negative group treasury', async () => {
    const db = cleanDb();
    db.groups.push({
      id: 'g1', world_id: 'w1', treasury: -1, army_size: 0, is_active: true,
    });
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toThrow(/group g1/);
  });

  it('throws on negative city treasury', async () => {
    const db = cleanDb();
    db.cities[0].treasury = -1;
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toThrow(/city c1/);
  });

  it('throws on negative market_index', async () => {
    const db = cleanDb();
    db.worlds[0].market_index = -0.1;
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toThrow(/market_index/);
  });

  it('throws when alive count exceeds REAL_PERSON_CAP', async () => {
    // Fake count by installing a tx whose person.count returns CAP+1.
    const db = cleanDb();
    const tx = makeTx(db);
    tx.person.count = async () => REAL_PERSON_CAP + 1;
    await expect(runYearEndInvariants(baseCtx, tx)).rejects.toThrow(/real_person_cap/);
  });

  it('throws on world_id_containment violation', async () => {
    const db = cleanDb();
    db.persons.push({
      id: 'p1', world_id: 'w1', city_id: 'cX', city_world_id: 'OTHER',
      wealth: 10, current_health: 100, is_alive: true,
    });
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toThrow(/world_id_containment/);
  });

  it('throws on bucket orphan (ruined city with bucket count > 0)', async () => {
    const db = cleanDb();
    db.buckets.push({
      city_id: 'c2', type: 'Farmer', count: 50, avg_wealth: 50,
      city_world_id: 'w1', city_is_ruined: true,
    });
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).rejects.toThrow(/bucket_orphan/);
  });

  it('skips wealth-conservation when wealth_at_start is 0', async () => {
    // Even with massive imbalance, rule 5 is bypassed.
    const db = cleanDb();
    db.persons.push({
      id: 'p1', world_id: 'w1', city_id: 'c1', city_world_id: 'w1',
      wealth: 99999999, current_health: 100, is_alive: true,
    });
    await expect(runYearEndInvariants(baseCtx, makeTx(db))).resolves.toBeUndefined();
  });

  it('throws on wealth-conservation drift beyond tolerance', async () => {
    const db = cleanDb();
    // baseline = bucket(100*50) + city(100) = 5100
    // current  = same (5100). To force drift, pass a mismatched start.
    const ctx: InvariantContext = { world_id: 'w1', wealth_at_start: 1000, wealth_tolerance: 10 };
    await expect(runYearEndInvariants(ctx, makeTx(db))).rejects.toThrow(/wealth_conservation/);
  });

  it('passes wealth-conservation when drift within tolerance', async () => {
    const db = cleanDb();
    const ctx: InvariantContext = { world_id: 'w1', wealth_at_start: 5095, wealth_tolerance: 10 };
    await expect(runYearEndInvariants(ctx, makeTx(db))).resolves.toBeUndefined();
  });

  it('aggregates multiple violations into one error', async () => {
    const db = cleanDb();
    db.buckets[0].count = -1;
    db.cities[0].treasury = -1;
    try {
      await runYearEndInvariants(baseCtx, makeTx(db));
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvariantViolationError);
      expect((err as InvariantViolationError).violations.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('sumWorldWealth', () => {
  it('sums buckets + persons + groups + cities', async () => {
    const db = cleanDb();
    db.persons.push({
      id: 'p1', world_id: 'w1', city_id: 'c1', city_world_id: 'w1',
      wealth: 200, current_health: 100, is_alive: true,
    });
    db.groups.push({
      id: 'g1', world_id: 'w1', treasury: 300, army_size: 0, is_active: true,
    });
    // bucket=100*50=5000, person=200, group=300, city=100 → 5600
    const total = await sumWorldWealth('w1', makeTx(db));
    expect(total).toBe(5600);
  });

  it('excludes dead persons and inactive groups', async () => {
    const db = cleanDb();
    db.buckets = []; // strip buckets so we can isolate person/group sums
    db.cities[0].treasury = 0;
    db.persons.push({
      id: 'dead', world_id: 'w1', city_id: 'c1', city_world_id: 'w1',
      wealth: 999, current_health: 0, is_alive: false,
    });
    db.groups.push({
      id: 'inactive', world_id: 'w1', treasury: 999, army_size: 0, is_active: false,
    });
    const total = await sumWorldWealth('w1', makeTx(db));
    expect(total).toBe(0);
  });
});
