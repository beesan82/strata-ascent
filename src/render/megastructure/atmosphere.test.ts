import { describe, expect, it } from 'vitest';
import { hazeFactor, hazeColor, structureFill } from './atmosphere';
import { SYSTEM_BIOME } from '../biome';
import { STEEL, relLum, mixHex } from '../steel';

describe('hazeFactor', () => {
  it('遠い(depth=0)ほどかすみが強く、近い(depth=1)ほど弱い(単調減少)', () => {
    expect(hazeFactor(0)).toBeGreaterThan(hazeFactor(0.5));
    expect(hazeFactor(0.5)).toBeGreaterThan(hazeFactor(1));
  });

  it('常に[0,1]に収まり、範囲外入力はクランプ', () => {
    for (const d of [-2, 0, 0.3, 1, 3]) {
      const f = hazeFactor(d);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe('hazeColor', () => {
  it('環境色を暗鋼の霞色(STEEL.hanger)へ35%寄せた色を返す', () => {
    expect(hazeColor('#000000')).toBe(mixHex('#000000', STEEL.hanger, 0.35));
    expect(hazeColor('#3a588a')).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('structureFill(超構造のトーン整合)', () => {
  const ambients = Object.values(SYSTEM_BIOME).map((b) => b.ambientColor);

  it('全系統・全トーン・全かすみで、近景タイル基調(fillMid)より暗い(奥行きの明度順)', () => {
    // 近景タイルの最暗基準: 全系統の fillMid の最小輝度と比較しても暗いこと
    const minFillMid = Math.min(
      ...Object.values(SYSTEM_BIOME).map((b) => relLum(b.palette.fillMid)),
    );
    for (const amb of ambients) {
      for (const tone of ['far', 'mid', 'near'] as const) {
        for (const hf of [0, 0.3, 0.6]) {
          expect(relLum(structureFill(amb, tone, hf))).toBeLessThan(minFillMid);
        }
      }
    }
  });

  it('トーンは far < mid < near の単調(同一ambient・同一hf)', () => {
    for (const amb of ambients) {
      const f = relLum(structureFill(amb, 'far', 0.3));
      const m = relLum(structureFill(amb, 'mid', 0.3));
      const n = relLum(structureFill(amb, 'near', 0.3));
      expect(f).toBeLessThan(m);
      expect(m).toBeLessThan(n);
    }
  });

  it('黒潰れしない(far でも純黒より明るい)', () => {
    for (const amb of ambients) {
      expect(relLum(structureFill(amb, 'far', 0.6))).toBeGreaterThan(relLum('#020408'));
    }
  });
});
