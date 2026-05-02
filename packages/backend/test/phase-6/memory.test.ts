import { describe, it, expect } from 'vitest';
import { addMemory, addMemories } from '../../src/engine/memory';
import { MEMORY_BUFFER_CAP, type Memory } from '@claude-god/shared';

const mem = (year: number, magnitude: number, summary = `m-${year}-${magnitude}`): Memory => ({
  year,
  kind: 'test',
  summary,
  magnitude,
  tone: 'neutral',
});

describe('addMemory', () => {
  it('appends below cap', () => {
    const out = addMemory([mem(1, 0.5)], mem(2, 0.5));
    expect(out).toHaveLength(2);
  });

  it('drops the lowest-magnitude entry when over cap (not the oldest)', () => {
    // 10 entries, all magnitude 0.5; then add a high-magnitude new entry —
    // should drop the *oldest* (year 0) on tie, keeping the new one.
    const buf: Memory[] = Array.from({ length: MEMORY_BUFFER_CAP }, (_, i) =>
      mem(i, 0.5),
    );
    const out = addMemory(buf, mem(99, 0.9));
    expect(out).toHaveLength(MEMORY_BUFFER_CAP);
    expect(out.find((m) => m.year === 99)).toBeDefined();
    expect(out.find((m) => m.year === 0)).toBeUndefined();
  });

  it('drops a low-magnitude OLDER entry over a high-magnitude oldest', () => {
    // Buffer has one strong-but-old entry + 9 weak-but-newer entries; adding
    // an 11th entry should drop a weak entry, not the strong old one.
    const buf: Memory[] = [
      mem(0, 0.95, 'epic'), // strong but oldest
      ...Array.from({ length: MEMORY_BUFFER_CAP - 1 }, (_, i) => mem(i + 1, 0.1)),
    ];
    const out = addMemory(buf, mem(99, 0.5));
    expect(out.find((m) => m.summary === 'epic')).toBeDefined();
  });

  it('does not mutate input', () => {
    const buf = [mem(1, 0.5)];
    const before = JSON.stringify(buf);
    addMemory(buf, mem(2, 0.5));
    expect(JSON.stringify(buf)).toBe(before);
  });
});

describe('addMemories', () => {
  it('applies cap step-by-step', () => {
    const out = addMemories(
      [],
      Array.from({ length: 12 }, (_, i) => mem(i, 0.5)),
    );
    expect(out).toHaveLength(MEMORY_BUFFER_CAP);
  });
});
