import { describe, expect, it } from 'vitest';
import { BAYER4, bayerOffset } from './dither';

describe('BAYER4', () => {
  it('16要素・0..15の置換(重複なし)', () => {
    expect(BAYER4.length).toBe(16);
    expect([...BAYER4].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, i) => i),
    );
  });
});

describe('bayerOffset', () => {
  it('範囲は [-0.5, 0.5)', () => {
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const o = bayerOffset(x, y);
        expect(o).toBeGreaterThanOrEqual(-0.5);
        expect(o).toBeLessThan(0.5);
      }
    }
  });
  it('4×4周期(負座標でも一致)', () => {
    expect(bayerOffset(0, 0)).toBe(bayerOffset(4, 4));
    expect(bayerOffset(1, 2)).toBe(bayerOffset(-3, -2));
  });
  it('16マスすべて異なる値(単調な閾値分布)', () => {
    const vals = new Set<number>();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) vals.add(bayerOffset(x, y));
    expect(vals.size).toBe(16);
  });
});
