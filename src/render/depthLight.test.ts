import { describe, expect, it } from 'vitest';
import { coneParams, depthShade, DEPTH_SHADE_MIN, FLASHLIGHT_RADIUS_MULT } from './depthLight';

describe('depthShade(深さの明るさ)', () => {
  it('層 0 で 1.0、1 層ごとに 0.06 ずつ下がる', () => {
    expect(depthShade(0)).toBe(1);
    expect(depthShade(1)).toBeCloseTo(0.94);
    expect(depthShade(5)).toBeCloseTo(0.7);
  });

  it('深いほど暗い(単調非増加)', () => {
    for (let l = 0; l < 30; l++) expect(depthShade(l + 1)).toBeLessThanOrEqual(depthShade(l));
  });

  it('下限 0.45 で止まる', () => {
    expect(DEPTH_SHADE_MIN).toBe(0.45);
    expect(depthShade(9)).toBeCloseTo(0.46);
    expect(depthShade(10)).toBe(0.45);
    expect(depthShade(100)).toBe(0.45);
  });

  it('層番号が 0 未満でも 1.0 を超えない', () => {
    expect(depthShade(-3)).toBe(1);
  });
});

describe('coneParams(懐中電灯モードのコーン)', () => {
  it('通常は従来の値(半径 1 倍、中心 0.8、中間 0.35)', () => {
    expect(coneParams(0)).toEqual({ radiusMult: 1, centerAlpha: 0.8, midAlpha: 0.35 });
  });

  it('懐中電灯モードでは半径が約 1.3 倍になり、中心と中間が明るくなる', () => {
    const on = coneParams(1);
    expect(FLASHLIGHT_RADIUS_MULT).toBeCloseTo(1.3);
    expect(on.radiusMult).toBeCloseTo(1.3);
    expect(on.centerAlpha).toBeGreaterThan(0.8);
    expect(on.centerAlpha).toBeLessThanOrEqual(1);
    expect(on.midAlpha).toBeGreaterThan(0.35);
    expect(on.midAlpha).toBeLessThan(on.centerAlpha);
  });

  it('範囲外の強さは 0..1 に丸める', () => {
    expect(coneParams(-1)).toEqual(coneParams(0));
    expect(coneParams(2)).toEqual(coneParams(1));
  });
});
