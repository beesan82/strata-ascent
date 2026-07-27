import { describe, expect, it } from 'vitest';
import { quantizeRgba } from './pixel';
import { paletteRgb, PIXEL_PALETTE, nearestIndex } from './palette';

describe('quantizeRgba', () => {
  const rgb = paletteRgb();
  it('各画素をパレット色に置換する(全画素がパレット内)', () => {
    const data = new Uint8ClampedArray([
      100, 100, 100, 255,
      10, 20, 30, 255,
      200, 160, 70, 255,
      90, 58, 36, 255,
    ]);
    quantizeRgba(data, 4, 1, rgb, 0);
    const palSet = new Set(PIXEL_PALETTE.map((c) => c.slice(1)));
    for (let i = 0; i < 4; i++) {
      const hex = ((data[i * 4] << 16) | (data[i * 4 + 1] << 8) | data[i * 4 + 2])
        .toString(16).padStart(6, '0');
      expect(palSet.has(hex)).toBe(true);
    }
    expect(nearestIndex(90, 58, 36, rgb)).toBe(16);
  });

  it('アルファは保持する', () => {
    const data = new Uint8ClampedArray([100, 100, 100, 200]);
    quantizeRgba(data, 1, 1, rgb, 0);
    expect(data[3]).toBe(200);
  });

  it('決定論: 同じ入力は同じ出力', () => {
    const a = new Uint8ClampedArray([123, 45, 67, 255]);
    const b = new Uint8ClampedArray([123, 45, 67, 255]);
    quantizeRgba(a, 1, 1, rgb, 1);
    quantizeRgba(b, 1, 1, rgb, 1);
    expect([...a]).toEqual([...b]);
  });

  it('ディザ強度>0で、同色の帯が隣接画素で異なる色に割れうる(バンド散らし)', () => {
    const w = 16;
    const data = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) {
      data[x * 4] = 45; data[x * 4 + 1] = 55; data[x * 4 + 2] = 70; data[x * 4 + 3] = 255;
    }
    quantizeRgba(data, w, 1, rgb, 32);
    const colors = new Set<string>();
    for (let x = 0; x < w; x++) {
      colors.add(`${data[x * 4]},${data[x * 4 + 1]},${data[x * 4 + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(1);
  });
});
