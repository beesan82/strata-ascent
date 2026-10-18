import { describe, expect, it } from 'vitest';
import {
  computePixelLayout,
  DITHER_STRENGTH,
  HIGH_FIDELITY_TILE_PX,
  quantizeRgba,
} from './pixel';
import { paletteRgb, PIXEL_PALETTE, nearestIndex } from './palette';
import { bayerOffset } from './dither';

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
    expect(nearestIndex(90, 58, 36, rgb)).toBe(29);
    // The fourth pixel starts at offset 12 and must use rust palette index 29.
    const i29 = 29 * 3;
    expect([data[12], data[13], data[14]]).toEqual([rgb[i29], rgb[i29 + 1], rgb[i29 + 2]]);
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

  it('キャッシュ経由でも総当たりの参照実装と全画素一致する(強度を跨いでも)', () => {
    const w = 37;
    const h = 23;
    const src = new Uint8ClampedArray(w * h * 4);
    let s = 12345;
    for (let i = 0; i < src.length; i++) {
      s = (s * 1103515245 + 12345) >>> 0;
      // 同色の繰り返し(キャッシュヒット)と多様な色(ミス)の両方を混ぜる
      src[i] = i % 8 < 4 ? (s >>> 24) : (i * 7) & 255;
    }
    for (const strength of [0, 1, DITHER_STRENGTH, DITHER_STRENGTH, 40]) {
      const fast = src.slice();
      quantizeRgba(fast, w, h, rgb, strength);
      const ref = src.slice();
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const o = (y * w + x) * 4;
          const d = bayerOffset(x, y) * strength;
          const idx = nearestIndex(ref[o] + d, ref[o + 1] + d, ref[o + 2] + d, rgb);
          ref[o] = rgb[idx * 3];
          ref[o + 1] = rgb[idx * 3 + 1];
          ref[o + 2] = rgb[idx * 3 + 2];
        }
      }
      expect([...fast]).toEqual([...ref]);
    }
  });

  it('production strength disperses a representative color band', () => {
    const w = 16;
    const data = new Uint8ClampedArray(w * 4);
    for (let x = 0; x < w; x++) {
      data[x * 4] = 45; data[x * 4 + 1] = 55; data[x * 4 + 2] = 70; data[x * 4 + 3] = 255;
    }
    quantizeRgba(data, w, 1, rgb, DITHER_STRENGTH);
    const colors = new Set<string>();
    for (let x = 0; x < w; x++) {
      colors.add(`${data[x * 4]},${data[x * 4 + 1]},${data[x * 4 + 2]}`);
    }
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('computePixelLayout', () => {
  it('uses the high-fidelity tile size and softer dither strength', () => {
    expect(HIGH_FIDELITY_TILE_PX).toBe(12);
    expect(DITHER_STRENGTH).toBe(12);
  });

  it('computes a three-times nearest-neighbor layout for 1280 by 720', () => {
    expect(computePixelLayout(1280, 720, 34, 12)).toEqual({
      bufW: 427,
      bufH: 240,
      scale: 3,
    });
  });

  it('clamps a small viewport to the minimum buffer dimensions', () => {
    expect(computePixelLayout(100, 50, 34, 12)).toEqual({
      bufW: 160,
      bufH: 90,
      scale: 1,
    });
  });
});
