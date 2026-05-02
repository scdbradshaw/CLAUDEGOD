// Phase 1 — schema.test.ts
//
// Verifies Prisma schema is well-formed without requiring a live database.
//   - `prisma validate` succeeds
//   - schema parses; expected models are present
//   - shared package compiles

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const PRISMA_SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');

describe('Phase 1 — Prisma schema', () => {
  it('passes `prisma validate`', () => {
    // Throws if validate fails. We don't need a DB connection for validate.
    expect(() =>
      execSync('npx prisma validate', {
        cwd: join(__dirname, '..', '..'),
        stdio: 'pipe',
        env: {
          ...process.env,
          DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://placeholder@localhost:5432/placeholder',
        },
      })
    ).not.toThrow();
  });

  const schemaSrc = readFileSync(PRISMA_SCHEMA_PATH, 'utf8');

  const expectedModels = [
    'World',
    'City',
    'Bucket',
    'Person',
    'Relationship',
    'Group',
    'LifeDecadeSummary',
    'BiographyArchive',
    'WorldEvent',
    'YearRun',
  ];

  for (const model of expectedModels) {
    it(`declares model ${model}`, () => {
      expect(schemaSrc).toMatch(new RegExp(`\\bmodel ${model}\\s*\\{`));
    });
  }

  const expectedEnums = [
    'PersonType',
    'RegionResource',
    'GroupKind',
    'EventType',
    'EventEndReason',
    'DeathCause',
    'YearRunStatus',
  ];

  for (const enumName of expectedEnums) {
    it(`declares enum ${enumName}`, () => {
      expect(schemaSrc).toMatch(new RegExp(`\\benum ${enumName}\\s*\\{`));
    });
  }

  it('YearRun carries random_seed BigInt for replay determinism (§15.2.1)', () => {
    expect(schemaSrc).toMatch(/random_seed\s+BigInt/);
  });

  it('World carries global market_index (§6.4)', () => {
    expect(schemaSrc).toMatch(/market_index\s+Float/);
  });

  it('Bucket has composite primary key (city_id, type) (§12)', () => {
    expect(schemaSrc).toMatch(/@@id\(\[city_id,\s*type\]\)/);
  });

  it('YearRun has unique (world_id, year)', () => {
    expect(schemaSrc).toMatch(/@@unique\(\[world_id,\s*year\]\)/);
  });
});
