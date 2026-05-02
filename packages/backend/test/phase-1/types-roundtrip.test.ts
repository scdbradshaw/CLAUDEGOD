// Phase 1 — types-roundtrip.test.ts
//
// Guards parity between shared-types unions and Prisma enums.
// If a value is added to one but not the other, this test fails.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  PERSON_TYPES,
  REGION_RESOURCES,
  GROUP_KINDS,
  EVENT_TYPES,
  EVENT_END_REASONS,
  DEATH_CAUSES,
  YEAR_RUN_STATUSES,
  RACES,
  mixRaces,
  type Race,
} from '@claude-god/shared';

const PRISMA_SCHEMA_PATH = join(__dirname, '..', '..', 'prisma', 'schema.prisma');
const schemaSrc = readFileSync(PRISMA_SCHEMA_PATH, 'utf8');

/** Extract values from a Prisma enum block. */
function extractPrismaEnum(name: string): string[] {
  const match = schemaSrc.match(new RegExp(`enum ${name}\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`Prisma enum ${name} not found`);
  return match[1]
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('//'));
}

interface Pair {
  prismaEnum: string;
  union: readonly string[];
}

const PAIRS: Pair[] = [
  { prismaEnum: 'PersonType', union: PERSON_TYPES },
  { prismaEnum: 'RegionResource', union: REGION_RESOURCES },
  { prismaEnum: 'GroupKind', union: GROUP_KINDS },
  { prismaEnum: 'EventEndReason', union: EVENT_END_REASONS },
  { prismaEnum: 'DeathCause', union: DEATH_CAUSES },
  { prismaEnum: 'YearRunStatus', union: YEAR_RUN_STATUSES },
  { prismaEnum: 'EventType', union: EVENT_TYPES },
];

describe('Phase 1 — type/enum roundtrip parity', () => {
  for (const { prismaEnum, union } of PAIRS) {
    it(`Prisma enum ${prismaEnum} matches shared union exactly`, () => {
      const prismaValues = extractPrismaEnum(prismaEnum).sort();
      const unionValues = [...union].sort();
      expect(prismaValues).toEqual(unionValues);
    });
  }
});

describe('Phase 1 — race / mixed-race helper (§14.2)', () => {
  it('has 10 base races', () => {
    expect(RACES.length).toBe(10);
  });

  it('mixRaces canonicalizes alphabetically', () => {
    const a: Race = 'Polynesian';
    const b: Race = 'Caucasian';
    expect(mixRaces(a, b)).toBe('Caucasian-Polynesian');
    expect(mixRaces(b, a)).toBe('Caucasian-Polynesian');
  });

  it('mixRaces with same race returns single race (no self-mix)', () => {
    expect(mixRaces('Caucasian', 'Caucasian')).toBe('Caucasian');
  });
});
