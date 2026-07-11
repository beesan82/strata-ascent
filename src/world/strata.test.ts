import { describe, expect, it } from 'vitest';
import { STRATA, STRATUM_HEIGHT, stratumAt, stratumIndexAt } from './strata';

describe('stratumIndexAt', () => {
  it('地表以下(y >= 0)は高度0として階層0', () => {
    expect(stratumIndexAt(0)).toBe(0);
    expect(stratumIndexAt(100)).toBe(0);
  });

  it('高度500タイルごとに階層が1つ進む(yは上がマイナス)', () => {
    expect(stratumIndexAt(-499)).toBe(0);
    expect(stratumIndexAt(-500)).toBe(1);
    expect(stratumIndexAt(-999)).toBe(1);
    expect(stratumIndexAt(-1000)).toBe(2);
  });
});

describe('stratumAt', () => {
  it('定義済み階層を順に返し、末尾以降はループする', () => {
    expect(stratumAt(0)).toBe(STRATA[0]);
    expect(stratumAt(-STRATUM_HEIGHT * STRATA.length)).toBe(STRATA[0]);
    expect(stratumAt(-STRATUM_HEIGHT * (STRATA.length + 1))).toBe(STRATA[1]);
  });

  it('各階層のパラメータは妥当な範囲', () => {
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
});
