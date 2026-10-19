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

  it('整数距離の総当たりでも、厳密な同距離の入力は浮動小数の参照実装と同じ色を選ぶ', () => {
    // scripts/quantties.ts の列挙: [r,g,b,Bayer位置, 浮動小数の答え, 整数の先勝ちが選ぶ添字]。
    // 2^24×16 入力のうち最近傍が同距離になる 205 件中、先勝ちだと答えが割れる 46 件すべて。
    const divergent: number[][] = [[6,77,78,2,16,14],[0,71,72,3,16,14],[3,74,75,7,16,14],[35,70,175,8,20,16],[29,64,169,9,20,16],[26,61,166,12,20,16],[32,67,172,13,20,16],[26,104,105,0,19,18],[20,98,99,1,19,18],[17,95,96,4,19,18],[23,101,102,5,19,18],[34,98,99,8,19,18],[28,92,93,9,19,18],[1,103,116,10,19,18],[42,88,101,10,19,18],[36,82,95,11,19,18],[25,89,90,12,19,18],[31,95,96,13,19,18],[33,79,92,14,19,18],[39,85,98,15,19,18],[10,110,166,2,25,19],[4,104,160,3,25,19],[1,101,157,6,25,19],[7,107,163,7,25,19],[0,92,220,8,25,19],[46,99,163,8,25,19],[40,93,157,9,25,19],[37,90,154,12,25,19],[43,96,160,13,25,19],[38,254,97,2,27,23],[32,248,91,3,27,23],[29,245,88,6,27,23],[35,251,94,7,27,23],[62,245,48,8,27,23],[56,239,42,9,27,23],[53,236,39,12,27,23],[59,242,45,13,27,23],[5,254,137,14,27,23],[99,200,58,0,31,23],[93,194,52,1,31,23],[90,191,49,4,31,23],[96,197,55,5,31,23],[86,218,66,10,31,23],[80,212,60,11,31,23],[77,209,57,14,31,23],[83,215,63,15,31,23]];
    expect(divergent.length).toBe(46);
    for (const [r, g, b, bi, want, naive] of divergent) {
      const x = bi & 3;
      const y = bi >> 2;
      // 4×4 画像の (x,y) にだけこの色を置く(他は黒)。近道・キャッシュを通っても参照実装と一致すること
      const data = new Uint8ClampedArray(4 * 4 * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      const o = (y * 4 + x) * 4;
      data[o] = r; data[o + 1] = g; data[o + 2] = b;
      const d = bayerOffset(x, y) * DITHER_STRENGTH;
      expect(nearestIndex(r + d, g + d, b + d, rgb)).toBe(want);
      expect(want).not.toBe(naive);
      quantizeRgba(data, 4, 4, rgb, DITHER_STRENGTH);
      expect([data[o], data[o + 1], data[o + 2]]).toEqual([rgb[want * 3], rgb[want * 3 + 1], rgb[want * 3 + 2]]);
    }
  });

  it('キャッシュに無い色ばかりの画像(総当たりが毎画素走る)でも参照実装と一致する', () => {
    // 2^18 キャッシュへ初めて入る色を大量に流し、整数距離のミス経路を広く踏む
    const w = 256;
    const h = 64;
    const src = new Uint8ClampedArray(w * h * 4);
    let s = 987654321;
    for (let i = 0; i < src.length; i += 4) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      src[i] = s & 255; src[i + 1] = (s >>> 8) & 255; src[i + 2] = (s >>> 16) & 255; src[i + 3] = 255;
    }
    const fast = src.slice();
    quantizeRgba(fast, w, h, rgb, DITHER_STRENGTH);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const d = bayerOffset(x, y) * DITHER_STRENGTH;
        const idx = nearestIndex(src[o] + d, src[o + 1] + d, src[o + 2] + d, rgb);
        if (fast[o] !== rgb[idx * 3] || fast[o + 1] !== rgb[idx * 3 + 1] || fast[o + 2] !== rgb[idx * 3 + 2]) {
          throw new Error(`mismatch at (${x},${y}) src=${src[o]},${src[o + 1]},${src[o + 2]}`);
        }
      }
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
