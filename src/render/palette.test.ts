import { describe, expect, it } from 'vitest';
import { PIXEL_PALETTE, paletteRgb, nearestIndex } from './palette';
import { relLum } from './steel';

describe('PIXEL_PALETTE', () => {
  it('18色(寒色16+暖色2)・重複なし', () => {
    expect(PIXEL_PALETTE.length).toBe(18);
    expect(new Set(PIXEL_PALETTE).size).toBe(18);
  });
  it('寒色ランプ(先頭16)は輝度が概ね単調増加', () => {
    for (let i = 1; i < 16; i++) {
      expect(relLum(PIXEL_PALETTE[i])).toBeGreaterThan(relLum(PIXEL_PALETTE[i - 1]));
    }
  });
  it('全色 #rrggbb 形式', () => {
    for (const c of PIXEL_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('paletteRgb', () => {
  it('18×3のUint8Arrayを返し、先頭色と一致', () => {
    const rgb = paletteRgb();
    expect(rgb.length).toBe(18 * 3);
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([2, 4, 8]);
  });
});

describe('nearestIndex', () => {
  it('パレット色そのものはその添字を返す', () => {
    const rgb = paletteRgb();
    for (let i = 0; i < PIXEL_PALETTE.length; i++) {
      const r = parseInt(PIXEL_PALETTE[i].slice(1, 3), 16);
      const g = parseInt(PIXEL_PALETTE[i].slice(3, 5), 16);
      const b = parseInt(PIXEL_PALETTE[i].slice(5, 7), 16);
      expect(nearestIndex(r, g, b, rgb)).toBe(i);
    }
  });
  it('純黒は最暗色(添字0)へ', () => {
    expect(nearestIndex(0, 0, 0, paletteRgb())).toBe(0);
  });
  it('純白は最明色(添字15)へ', () => {
    expect(nearestIndex(255, 255, 255, paletteRgb())).toBe(15);
  });
  it('決定論: 同じ入力は同じ添字', () => {
    const rgb = paletteRgb();
    expect(nearestIndex(90, 58, 36, rgb)).toBe(nearestIndex(90, 58, 36, rgb));
  });
});
