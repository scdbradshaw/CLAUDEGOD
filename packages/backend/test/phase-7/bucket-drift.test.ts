import { describe, it, expect } from 'vitest';
import { driftBucketShares } from '../../src/engine/groups/bucket-drift';

describe('driftBucketShares', () => {
  it('promotes a new best-fit when none held and slots available', () => {
    const out = driftBucketShares({ shares: {}, fit: { A: 5, B: 1 } });
    expect(out.A).toBeCloseTo(0.05);
    expect(out.B).toBeUndefined();
  });

  it('grows the best-fit held entry by the drift step', () => {
    const out = driftBucketShares({
      shares: { A: 0.3, B: 0.2 },
      fit: { A: 10, B: 1 },
    });
    expect(out.A).toBeCloseTo(0.35);
    // B is the worst-held → bled by the drift step.
    expect(out.B).toBeCloseTo(0.15);
  });

  it('bleeds worst-held entry to zero and removes it', () => {
    const out = driftBucketShares({
      shares: { A: 0.5, B: 0.04 },
      fit: { A: 10, B: 0 },
    });
    expect(out.B).toBeUndefined();
    expect(out.A).toBeCloseTo(0.55);
  });

  it('returns shares unchanged when fit map is empty', () => {
    const shares = { A: 0.4 };
    expect(driftBucketShares({ shares, fit: {} })).toEqual(shares);
  });

  it('keeps total share ≤ 1 (residual unaffiliated stays implicit)', () => {
    const out = driftBucketShares({
      shares: { A: 0.5, B: 0.4 },
      fit: { A: 10, B: 1 },
    });
    const total = Object.values(out).reduce((s, v) => s + v, 0);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('caps held entries at 5', () => {
    const shares = { A: 0.1, B: 0.1, C: 0.1, D: 0.1, E: 0.1 };
    const out = driftBucketShares({
      shares,
      fit: { A: 5, B: 1, C: 1, D: 1, E: 1, F: 100 }, // F best-fit but not held
    });
    // Cap-5 with no slot freed yet — F can't enter this year.
    expect(Object.keys(out).length).toBeLessThanOrEqual(5);
    expect(out.F).toBeUndefined();
  });

  it('clamps total to 1 if numerical drift overshoots', () => {
    const out = driftBucketShares({
      shares: { A: 0.7, B: 0.3 },
      fit: { A: 10, B: 1 },
    });
    const total = Object.values(out).reduce((s, v) => s + v, 0);
    expect(total).toBeLessThanOrEqual(1 + 1e-9);
  });
});
