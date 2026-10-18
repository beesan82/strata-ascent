import { describe, expect, it } from 'vitest';
import { hardSeamAt, hardRibAt, hardEdgeStrength, holeCenterX, SEAM_SPACING, RIB_SPACING } from './hardPlate';

describe('hardPlate', () => {
  it('継ぎ目は 16 タイルごと(負数も)', () => {
    expect(hardSeamAt(0, 5)).toEqual({ v: true, h: false });
    expect(hardSeamAt(-16, 16)).toEqual({ v: true, h: true });
    expect(hardSeamAt(7, -3)).toEqual({ v: false, h: false });
    expect(SEAM_SPACING).toBe(16);
  });

  it('垂下リブは 8 タイルごと', () => {
    expect(hardRibAt(8)).toBe(true);
    expect(hardRibAt(-8)).toBe(true);
    expect(hardRibAt(3)).toBe(false);
    expect(RIB_SPACING).toBe(8);
  });

  it('エッジ強度は大穴の真下で 1、256 以遠で 0.3、単調減少', () => {
    expect(hardEdgeStrength(0)).toBe(1);
    expect(hardEdgeStrength(256)).toBeCloseTo(0.3);
    expect(hardEdgeStrength(-1000)).toBeCloseTo(0.3);
    expect(hardEdgeStrength(64)).toBeGreaterThan(hardEdgeStrength(128));
  });

  it('大穴の中心は孔 +48', () => {
    expect(holeCenterX(196)).toBe(244);
  });
});
