import { describe, it, expect } from 'vitest';
import {
  pruneExpiredStateTags,
  addStateTag,
  refreshAndAddStateTag,
} from '../../src/engine/state-tags';
import { STATE_TAG_DURATIONS, STATE_TAG_MAX, type StateTagEntry } from '@claude-god/shared';

describe('pruneExpiredStateTags', () => {
  it('drops entries strictly past their duration window', () => {
    // grieving = 5y. Set at year 10, duration 5 → expires when year >= 15.
    const tags: StateTagEntry[] = [{ tag: 'grieving', set_year: 10 }];
    expect(pruneExpiredStateTags(tags, 14)).toHaveLength(1);
    expect(pruneExpiredStateTags(tags, 15)).toHaveLength(0);
  });

  it('keeps tags whose window still contains the year', () => {
    const tags: StateTagEntry[] = [
      { tag: 'traumatized', set_year: 100 }, // 10y window
      { tag: 'wedded-recently', set_year: 100 }, // 2y window
    ];
    const out = pruneExpiredStateTags(tags, 101);
    expect(out).toHaveLength(2);
  });

  it('removes long-expired tags', () => {
    const tags: StateTagEntry[] = [
      { tag: 'famous', set_year: 0 }, // 5y window
      { tag: 'battle-veteran', set_year: 0 }, // 15y window
    ];
    const out = pruneExpiredStateTags(tags, 6);
    expect(out.map((t) => t.tag)).toEqual(['battle-veteran']);
  });
});

describe('addStateTag', () => {
  it('appends new tag', () => {
    expect(addStateTag([], 'grieving', 10)).toEqual([
      { tag: 'grieving', set_year: 10 },
    ]);
  });

  it('refreshes set_year if tag already present', () => {
    const tags: StateTagEntry[] = [{ tag: 'grieving', set_year: 5 }];
    expect(addStateTag(tags, 'grieving', 12)).toEqual([
      { tag: 'grieving', set_year: 12 },
    ]);
  });

  it('drops oldest tag on overflow past STATE_TAG_MAX', () => {
    const tags: StateTagEntry[] = [
      { tag: 'famous', set_year: 1 },
      { tag: 'infamous', set_year: 2 },
      { tag: 'ruined', set_year: 3 },
      { tag: 'windfall', set_year: 4 },
      { tag: 'battle-veteran', set_year: 5 },
    ];
    expect(tags).toHaveLength(STATE_TAG_MAX);
    const out = addStateTag(tags, 'grieving', 6);
    expect(out).toHaveLength(STATE_TAG_MAX);
    expect(out.map((t) => t.tag)).not.toContain('famous'); // oldest dropped
    expect(out.map((t) => t.tag)).toContain('grieving');
  });
});

describe('refreshAndAddStateTag', () => {
  it('prunes then adds in one go', () => {
    const tags: StateTagEntry[] = [
      { tag: 'famous', set_year: 0 },
      { tag: 'infamous', set_year: 100 },
    ];
    const out = refreshAndAddStateTag(tags, 'grieving', 50);
    // famous at year 0 + 5y window expires by year 5; gone at year 50.
    expect(out.map((t) => t.tag).sort()).toEqual(['grieving', 'infamous']);
  });
});

describe('STATE_TAG_DURATIONS', () => {
  it('has an entry for every state tag', () => {
    const tags = ['grieving', 'traumatized', 'wedded-recently', 'ruined',
      'windfall', 'battle-veteran', 'famous', 'infamous'] as const;
    for (const t of tags) {
      expect(STATE_TAG_DURATIONS[t]).toBeGreaterThan(0);
    }
  });
});
