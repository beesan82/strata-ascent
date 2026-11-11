import { describe, expect, it } from 'vitest';
import {
  coneParams, curtainAlpha, depthShade, enclosure, enclosureShade, CURTAIN_MAX, CURTAIN_SLOPE, DEPTH_SHADE_MIN,
  DEPTH_SHADE_PER_LAYER, ENCLOSURE_CLOSED, ENCLOSURE_OPEN, ENCLOSURE_SHADE_MIN, FLASHLIGHT_RADIUS_MULT,
} from './depthLight';
import { OPENNESS_LO } from '../core/zoom';

describe('enclosure / enclosureShade(室内の暗さ、2.16 → 2.17 で強化)', () => {
  it('開放度 0.7 以上では係数 1(ズームの閉塞境界 OPENNESS_LO より手前から効く)', () => {
    expect(ENCLOSURE_OPEN).toBe(0.7);
    expect(ENCLOSURE_OPEN).toBeGreaterThan(OPENNESS_LO);
    for (const o of [ENCLOSURE_OPEN, 0.8, 0.9, 1]) {
      expect(enclosure(o)).toBe(0);
      expect(enclosureShade(o)).toBe(1);
    }
    // 旧境界(0.55)ではすでに暗くなり始めている
    expect(enclosureShade(OPENNESS_LO)).toBeLessThan(1);
  });

  it('囲まれるほど暗く(単調非減少の囲まれ度、単調非増加の係数)', () => {
    for (let o = 0; o < 1; o += 0.01) {
      expect(enclosure(o)).toBeGreaterThanOrEqual(enclosure(o + 0.01));
      expect(enclosureShade(o)).toBeLessThanOrEqual(enclosureShade(o + 0.01));
    }
    const mid = (ENCLOSURE_OPEN + ENCLOSURE_CLOSED) / 2;
    expect(enclosure(mid)).toBeCloseTo(0.5);
    expect(enclosureShade(mid)).toBeCloseTo((1 + ENCLOSURE_SHADE_MIN) / 2);
  });

  it('下限 0.35 で止まる', () => {
    expect(ENCLOSURE_CLOSED).toBe(0.2);
    expect(ENCLOSURE_SHADE_MIN).toBe(0.35);
    for (const o of [ENCLOSURE_CLOSED, 0.1, 0, -1]) {
      expect(enclosure(o)).toBe(1);
      expect(enclosureShade(o)).toBeCloseTo(ENCLOSURE_SHADE_MIN);
    }
  });

  it('深さ係数との積で両方効く(深く囲まれた場所が最も暗い)', () => {
    const open0 = depthShade(0) * enclosureShade(1);
    const closed0 = depthShade(0) * enclosureShade(0);
    const closedDeep = depthShade(10) * enclosureShade(0);
    expect(open0).toBe(1);
    expect(closed0).toBeLessThan(open0);
    expect(closedDeep).toBeLessThan(closed0);
    expect(closedDeep).toBeCloseTo(DEPTH_SHADE_MIN * ENCLOSURE_SHADE_MIN);
  });
});

describe('depthShade(深さの明るさ)', () => {
  it('層 0 で 1.0、1 層ごとに 0.08 ずつ下がる', () => {
    expect(DEPTH_SHADE_PER_LAYER).toBe(0.08);
    expect(depthShade(0)).toBe(1);
    expect(depthShade(1)).toBeCloseTo(0.92);
    expect(depthShade(5)).toBeCloseTo(0.6);
    expect(depthShade(8)).toBeCloseTo(0.36);
  });

  it('深いほど暗い(単調非増加)', () => {
    for (let l = 0; l < 30; l++) expect(depthShade(l + 1)).toBeLessThanOrEqual(depthShade(l));
  });

  it('下限 0.30 で止まる', () => {
    expect(DEPTH_SHADE_MIN).toBe(0.3);
    expect(depthShade(9)).toBe(0.3);
    expect(depthShade(10)).toBe(0.3);
    expect(depthShade(100)).toBe(0.3);
  });

  it('層番号が 0 未満でも 1.0 を超えない', () => {
    expect(depthShade(-3)).toBe(1);
  });
});

describe('curtainAlpha(暗幕の濃さ、2.17)', () => {
  it('係数は (1 − 環境光) × 1.0、上限 0.86', () => {
    expect(CURTAIN_SLOPE).toBe(1);
    expect(CURTAIN_MAX).toBe(0.86);
    expect(curtainAlpha(1)).toBe(0);
    expect(curtainAlpha(0.5)).toBeCloseTo(0.5);
    expect(curtainAlpha(0.25)).toBeCloseTo(0.75);
  });

  it('上限で止まり、真っ黒にはしない(光源のない場所でもシルエットが残る)', () => {
    for (const a of [0.12, 0.1, 0.05, 0, -1]) expect(curtainAlpha(a)).toBe(CURTAIN_MAX);
    expect(CURTAIN_MAX).toBeLessThan(0.9);
  });

  it('環境光が暗いほど濃い(単調非増加)、範囲外は 0..1 に丸める', () => {
    for (let a = 0; a < 1; a += 0.01) expect(curtainAlpha(a + 0.01)).toBeLessThanOrEqual(curtainAlpha(a));
    expect(curtainAlpha(2)).toBe(0);
  });

  it('旧式(min(0.62, (1 − a) × 0.72))より常に濃いか同じ', () => {
    for (let a = 0; a <= 1; a += 0.01) {
      expect(curtainAlpha(a)).toBeGreaterThanOrEqual(Math.min(0.62, (1 - a) * 0.72) - 1e-12);
    }
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
