import { describe, it, expect } from 'vitest';
import { evaluateEndCondition } from '../../src/engine/events/end-conditions';

describe('evaluateEndCondition — duration', () => {
  it('continues while elapsed < years', () => {
    const r = evaluateEndCondition(
      { kind: 'duration', years: 3 },
      { current_year: 102, started_year: 100 },
    );
    expect(r).toBe('continue');
  });

  it('expires when elapsed === years (boundary)', () => {
    const r = evaluateEndCondition(
      { kind: 'duration', years: 3 },
      { current_year: 103, started_year: 100 },
    );
    expect(r).toBe('expired');
  });

  it('expires when elapsed > years', () => {
    const r = evaluateEndCondition(
      { kind: 'duration', years: 1 },
      { current_year: 105, started_year: 100 },
    );
    expect(r).toBe('expired');
  });
});

describe('evaluateEndCondition — plague-clear', () => {
  it('condition_met when infected_pct < clear_pct', () => {
    const r = evaluateEndCondition(
      { kind: 'plague-clear', clear_pct: 0.05 },
      { current_year: 5, started_year: 1, infected_pct: 0.04 },
    );
    expect(r).toBe('condition_met');
  });

  it('continues when infected_pct >= clear_pct', () => {
    const r = evaluateEndCondition(
      { kind: 'plague-clear', clear_pct: 0.05 },
      { current_year: 5, started_year: 1, infected_pct: 0.06 },
    );
    expect(r).toBe('continue');
  });

  it('continues when infected_pct missing', () => {
    const r = evaluateEndCondition(
      { kind: 'plague-clear', clear_pct: 0.05 },
      { current_year: 5, started_year: 1 },
    );
    expect(r).toBe('continue');
  });
});

describe('evaluateEndCondition — war-resolved', () => {
  it('condition_met when army_size hits 0', () => {
    const r = evaluateEndCondition(
      { kind: 'war-resolved', fallback_years: 20 },
      { current_year: 105, started_year: 100, army_size: 0 },
    );
    expect(r).toBe('condition_met');
  });

  it('expired at fallback_years even with positive army', () => {
    const r = evaluateEndCondition(
      { kind: 'war-resolved', fallback_years: 20 },
      { current_year: 120, started_year: 100, army_size: 50 },
    );
    expect(r).toBe('expired');
  });

  it('continues mid-war', () => {
    const r = evaluateEndCondition(
      { kind: 'war-resolved', fallback_years: 20 },
      { current_year: 105, started_year: 100, army_size: 50 },
    );
    expect(r).toBe('continue');
  });
});

describe('evaluateEndCondition — siege-resolved', () => {
  it('continues while siege_unresolved', () => {
    const r = evaluateEndCondition(
      { kind: 'siege-resolved' },
      { current_year: 5, started_year: 1, siege_unresolved: true },
    );
    expect(r).toBe('continue');
  });

  it('condition_met when siege resolved', () => {
    const r = evaluateEndCondition(
      { kind: 'siege-resolved' },
      { current_year: 5, started_year: 1, siege_unresolved: false },
    );
    expect(r).toBe('condition_met');
  });
});

describe('evaluateEndCondition — crash-recovered', () => {
  it('condition_met when market_index >= threshold', () => {
    const r = evaluateEndCondition(
      { kind: 'crash-recovered', threshold: 0.6 },
      { current_year: 5, started_year: 1, market_index: 0.6 },
    );
    expect(r).toBe('condition_met');
  });

  it('continues while market_index below threshold', () => {
    const r = evaluateEndCondition(
      { kind: 'crash-recovered', threshold: 0.6 },
      { current_year: 5, started_year: 1, market_index: 0.5 },
    );
    expect(r).toBe('continue');
  });
});
