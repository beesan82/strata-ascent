import { describe, expect, it } from 'vitest';
import { PIXEL_PALETTE, paletteRgb, nearestIndex } from './palette';
import { relLum } from './steel';

describe('PIXEL_PALETTE', () => {
  it('contains 32 unique #rrggbb colors', () => {
    expect(PIXEL_PALETTE.length).toBe(32);
    expect(new Set(PIXEL_PALETTE).size).toBe(32);
    for (const color of PIXEL_PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('orders the first 28 industrial colors by increasing luminance', () => {
    for (let i = 1; i < 28; i++) {
      expect(relLum(PIXEL_PALETTE[i])).toBeGreaterThan(relLum(PIXEL_PALETTE[i - 1]));
    }
  });

  it('ends with the fixed rust and light accents', () => {
    expect(PIXEL_PALETTE.slice(28)).toEqual(['#3d2618', '#5a3a24', '#9a6d32', '#caa64a']);
  });
});

describe('paletteRgb', () => {
  it('returns RGB triples for all 32 colors', () => {
    const rgb = paletteRgb();
    expect(rgb.length).toBe(32 * 3);
    expect([rgb[0], rgb[1], rgb[2]]).toEqual([2, 4, 8]);
  });
});

describe('nearestIndex', () => {
  it('returns every palette color index for its exact RGB value', () => {
    const rgb = paletteRgb();
    for (let i = 0; i < PIXEL_PALETTE.length; i++) {
      const r = parseInt(PIXEL_PALETTE[i].slice(1, 3), 16);
      const g = parseInt(PIXEL_PALETTE[i].slice(3, 5), 16);
      const b = parseInt(PIXEL_PALETTE[i].slice(5, 7), 16);
      expect(nearestIndex(r, g, b, rgb)).toBe(i);
    }
  });

  it('maps black to the darkest color', () => {
    expect(nearestIndex(0, 0, 0, paletteRgb())).toBe(0);
  });

  it('maps pure white to the brightest steel color', () => {
    expect(nearestIndex(255, 255, 255, paletteRgb())).toBe(27);
  });

  it('maps rust to the second rust accent', () => {
    expect(nearestIndex(90, 58, 36, paletteRgb())).toBe(29);
  });

  it('retains the five visual-biome hue families through quantization', () => {
    const rgb = paletteRgb();
    const quantized = (hex: string): [number, number, number] => {
      const value = parseInt(hex.slice(1), 16);
      const index = nearestIndex((value >> 16) & 255, (value >> 8) & 255, value & 255, rgb);
      return [rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]];
    };

    const [coldR, coldG, coldB] = quantized('#5b7e9b');
    expect(coldB).toBeGreaterThan(coldG);
    expect(coldG).toBeGreaterThan(coldR);

    const [habitationR, habitationG, habitationB] = quantized('#3f9b83');
    expect(habitationG).toBeGreaterThan(habitationB);
    expect(habitationB).toBeGreaterThan(habitationR);

    const [disposalR, disposalG, disposalB] = quantized('#a26028');
    expect(disposalR).toBeGreaterThan(disposalG);
    expect(disposalG).toBeGreaterThan(disposalB);

    const [waterR, waterG, waterB] = quantized('#297cc4');
    expect(waterB).toBeGreaterThan(waterG);
    expect(waterG).toBeGreaterThan(waterR);

    const [powerR, powerG, powerB] = quantized('#8157c8');
    expect(powerB).toBeGreaterThan(powerR);
    expect(powerR).toBeGreaterThan(powerG);
  });
});
