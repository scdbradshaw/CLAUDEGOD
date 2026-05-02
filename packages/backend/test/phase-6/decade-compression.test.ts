import { describe, it, expect } from 'vitest';
import {
  shouldCompress,
  compressDecade,
} from '../../src/engine/decade-compression';
import { DECADE_COMPRESSION_INTERVAL, type Memory } from '@claude-god/shared';

const mem = (year: number, magnitude: number, summary = `m-${year}-${magnitude}`): Memory => ({
  year,
  kind: 'event',
  summary,
  magnitude,
  tone: 'literary',
});

describe('shouldCompress', () => {
  it('triggers at multiples of the interval (excluding age 0)', () => {
    expect(shouldCompress(0)).toBe(false);
    expect(shouldCompress(DECADE_COMPRESSION_INTERVAL)).toBe(true);
    expect(shouldCompress(DECADE_COMPRESSION_INTERVAL * 3)).toBe(true);
  });

  it('does not trigger between intervals', () => {
    expect(shouldCompress(7)).toBe(false);
    expect(shouldCompress(11)).toBe(false);
    expect(shouldCompress(DECADE_COMPRESSION_INTERVAL + 1)).toBe(false);
  });
});

describe('compressDecade', () => {
  it('returns no summary when not at a decade boundary', () => {
    const buf = [mem(5, 0.5)];
    const out = compressDecade({ memories: buf, age: 7, year: 7 });
    expect(out.triggered).toBe(false);
    expect(out.summary).toBeNull();
    expect(out.buffer).toBe(buf); // unchanged reference
  });

  it('produces a summary at age 30 with top-5 ranked memories from the past decade', () => {
    // Person aged 30; the "past decade" is years [year-10, year]. Stage memories
    // across that window with varied magnitude so the top-5 ordering is stable.
    const memories: Memory[] = [
      mem(21, 0.95, 'crowning'),
      mem(22, 0.90, 'wedding'),
      mem(23, 0.20, 'minor'),
      mem(24, 0.85, 'feud'),
      mem(25, 0.10, 'minor-2'),
      mem(26, 0.80, 'famine'),
      mem(27, 0.15, 'minor-3'),
      mem(28, 0.75, 'birth'),
      mem(29, 0.05, 'minor-4'),
      mem(30, 0.60, 'duel'),
    ];
    const out = compressDecade({ memories, age: 30, year: 30, prior_summary_id: null });
    expect(out.triggered).toBe(true);
    expect(out.summary).not.toBeNull();
    expect(out.summary!.decade_start_year).toBe(20); // year - interval
    expect(out.summary!.prior_summary_id).toBeNull();
    expect(out.summary!.ranked_memories).toHaveLength(5);
    // Top-5 are the highest-magnitude entries, sorted desc.
    expect(out.summary!.ranked_memories.map((m) => m.summary)).toEqual([
      'crowning',
      'wedding',
      'feud',
      'famine',
      'birth',
    ]);
  });

  it('chains via prior_summary_id when one is supplied', () => {
    const memories: Memory[] = [mem(15, 0.6, 'a'), mem(18, 0.7, 'b')];
    const out = compressDecade({
      memories,
      age: 20,
      year: 20,
      prior_summary_id: 'prev-uuid',
    });
    expect(out.triggered).toBe(true);
    expect(out.summary!.prior_summary_id).toBe('prev-uuid');
  });

  it('condenses the buffer: drops promoted entries and entries before the decade boundary', () => {
    // Need >5 in-decade entries so the lower-magnitude ones survive in the buffer.
    const memories: Memory[] = [
      mem(10, 0.99, 'old-epic'), // pre-decade — should be dropped wholesale
      mem(15, 0.50, 'old-mid'),  // pre-decade — should be dropped wholesale
      mem(21, 0.95, 'a'),        // in-decade, top-5 → promoted
      mem(22, 0.10, 'b'),        // in-decade, low → stays in buffer
      mem(23, 0.90, 'c'),        // in-decade, top-5 → promoted
      mem(24, 0.20, 'd'),        // in-decade, low → stays in buffer
      mem(25, 0.85, 'e'),        // in-decade, top-5 → promoted
      mem(26, 0.80, 'f'),        // in-decade, top-5 → promoted
      mem(27, 0.75, 'g'),        // in-decade, top-5 → promoted
    ];
    const out = compressDecade({ memories, age: 30, year: 30 });
    expect(out.triggered).toBe(true);
    // Buffer keeps in-decade NON-promoted entries only.
    expect(out.buffer.map((m) => m.summary).sort()).toEqual(['b', 'd']);
  });

  it('handles fewer-than-5 in-decade memories without padding the summary', () => {
    const memories: Memory[] = [mem(22, 0.6, 'one'), mem(25, 0.4, 'two')];
    const out = compressDecade({ memories, age: 30, year: 30 });
    expect(out.triggered).toBe(true);
    expect(out.summary!.ranked_memories).toHaveLength(2);
    // Buffer has nothing left — both entries got promoted.
    expect(out.buffer).toHaveLength(0);
  });

  it('returns RankedDecadeMemory shape (no counterparty_id)', () => {
    const memories: Memory[] = [
      { year: 22, kind: 'duel', summary: 's', magnitude: 0.7, tone: 'literary', counterparty_id: 'foe-1' },
    ];
    const out = compressDecade({ memories, age: 30, year: 30 });
    const r = out.summary!.ranked_memories[0];
    expect(Object.keys(r).sort()).toEqual(['kind', 'magnitude', 'summary', 'tone', 'year']);
  });
});
