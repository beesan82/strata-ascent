import { describe, expect, it } from 'vitest';
import { mixHex, relLum, STEEL, steelPalette } from './steel';

describe('mixHex(移設)', () => {
  it('端点と中点', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('relLum', () => {
  it('黒=0、白=1、単調', () => {
    expect(relLum('#000000')).toBe(0);
    expect(relLum('#ffffff')).toBeCloseTo(1, 5);
    expect(relLum('#404040')).toBeLessThan(relLum('#808080'));
  });
});

describe('STEEL ランプ', () => {
  it('定義順で輝度が単調増加(モックの明度4段設計)', () => {
    const names = Object.keys(STEEL) as (keyof typeof STEEL)[];
    for (let i = 1; i < names.length; i++) {
      expect(relLum(STEEL[names[i]])).toBeGreaterThan(relLum(STEEL[names[i - 1]]));
    }
  });
  it('最暗〜基調はほぼ黒(闇が主役)', () => {
    expect(relLum(STEEL.base)).toBeLessThan(0.01);
    expect(relLum(STEEL.rib)).toBeLessThan(0.02);
  });
});

describe('steelPalette', () => {
  it('任意ティントで fillDark < fillMid < fillLight < edge の順序を保存', () => {
    for (const tint of ['#b07a45', '#7fc0ac', '#8fb4e6', '#d06a3c', '#b6b6e0']) {
      const p = steelPalette(tint);
      expect(relLum(p.fillDark)).toBeLessThan(relLum(p.fillMid));
      expect(relLum(p.fillMid)).toBeLessThan(relLum(p.fillLight));
      expect(relLum(p.fillLight)).toBeLessThan(relLum(p.edge));
    }
  });
  it('基調はほぼ黒・縁は可読(モックのトーン上限内)', () => {
    const p = steelPalette('#b07a45');
    expect(relLum(p.fillMid)).toBeLessThan(0.03);
    expect(relLum(p.edge)).toBeLessThan(0.2);
    expect(relLum(p.edge)).toBeGreaterThan(0.05);
  });
  it('決定論: 同じティントなら同じパレット', () => {
    expect(steelPalette('#7fc0ac')).toEqual(steelPalette('#7fc0ac'));
  });
});
