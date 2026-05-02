// Phase 3 — year-service.test.ts
//
// Unit tests for the pure pieces of year.service. The DB-touching paths
// (`enqueueYearAdvance`, `runYearPhase`) are exercised in the integration
// test under `test/phase-3/year-advance.int.test.ts`.

import { describe, it, expect } from 'vitest';
import { decideAdvance } from '../../src/services/year.service';

describe('Phase 3 — decideAdvance (single-flight guard)', () => {
  it('allows advance when no active run exists', () => {
    expect(decideAdvance(null)).toEqual({ allow: true });
  });

  it('rejects when a pending run exists', () => {
    const r = decideAdvance({ id: 'r1', status: 'pending' });
    expect(r).toEqual({ allow: false, reason: 'pending' });
  });

  it('rejects when a running run exists', () => {
    const r = decideAdvance({ id: 'r1', status: 'running' });
    expect(r).toEqual({ allow: false, reason: 'running' });
  });

  it('allows advance when previous run is completed', () => {
    expect(decideAdvance({ id: 'r1', status: 'completed' })).toEqual({ allow: true });
  });

  it('allows advance when previous run failed (caller may want to retry)', () => {
    expect(decideAdvance({ id: 'r1', status: 'failed' })).toEqual({ allow: true });
  });
});
