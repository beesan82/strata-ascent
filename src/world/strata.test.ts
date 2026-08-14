import { describe, expect, it } from 'vitest';
import { STRATA, STRATUM_HEIGHT, stratumAt, stratumIndexAt } from './strata';

describe('stratumIndexAt', () => {
  it('uses floor division for signed world-Y band boundaries', () => {
    expect(stratumIndexAt(-501)).toBe(-2);
    expect(stratumIndexAt(-1)).toBe(-1);
    expect(stratumIndexAt(0)).toBe(0);
    expect(stratumIndexAt(499)).toBe(0);
    expect(stratumIndexAt(500)).toBe(1);
  });
});

describe('stratumAt', () => {
  it('selects deterministic, non-repeating strata in adjacent signed bands', () => {
    const seed = 42;
    let previous: (typeof STRATA)[number] | undefined;

    for (let band = -20; band <= 20; band++) {
      const current = stratumAt(seed, band * STRATUM_HEIGHT);
      expect(stratumAt(seed, band * STRATUM_HEIGHT)).toBe(current);
      if (previous) expect(current).not.toBe(previous);
      previous = current;
    }
  });

  it('keeps every stratum parameter within its valid range', () => {
    for (const s of STRATA) {
      expect(s.floorSpacing).toBeGreaterThanOrEqual(6);
      expect(s.gapChance).toBeGreaterThanOrEqual(0);
      expect(s.gapChance).toBeLessThan(1);
      expect(s.massThreshold).toBeGreaterThan(0);
      expect(s.massThreshold).toBeLessThan(1);
      expect(s.cavityThreshold).toBeGreaterThan(0);
      expect(s.cavityThreshold).toBeLessThanOrEqual(1);
    }
  });

  it('does not mirror positive and negative signed sequences across seeds', () => {
    for (const seed of [1, 42, 20260711]) {
      const positive = Array.from(
        { length: 12 },
        (_, index) => stratumAt(seed, (index + 1) * STRATUM_HEIGHT).name,
      );
      const negative = Array.from(
        { length: 12 },
        (_, index) => stratumAt(seed, -(index + 1) * STRATUM_HEIGHT).name,
      );
      expect(positive).not.toEqual(negative);
    }
  });
});
