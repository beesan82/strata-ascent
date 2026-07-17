import { describe, expect, it } from 'vitest';
import { hazeFactor, hazeColor } from './atmosphere';
import { mixHex } from '../biome';

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
  it('環境色を霞色(#3a4653)へ半分混ぜた色を返す', () => {
    expect(hazeColor('#000000')).toBe(mixHex('#000000', '#3a4653', 0.5));
    expect(hazeColor('#3a588a')).toMatch(/^#[0-9a-f]{6}$/);
  });
});
