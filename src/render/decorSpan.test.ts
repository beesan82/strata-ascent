import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import { findSpawn, tileAt } from '../world/worldgen';
import {
  decorateChunk, sceneryGuarded, spanBlank, spanHangerAt, spanMarkAt, spanNumberAt,
  PALETTE, SCENERY_COLORS, SPAN_BLANK_RATE, SPAN_COLORS, SPAN_PITCH,
} from './decor';
import { GRAND_SHAFT_COLORS } from './grandShaftColors';
import { nearestIndex, paletteRgb } from './palette';

const SEED = 20260711;
const tileGet = (x: number, y: number): number => tileAt(SEED, x, y);

/** 合成世界: 床の行 floorY(その下も固体)、天井の行 ceilY、間は空気 */
function corridor(floorY: number, ceilY: number): (x: number, y: number) => number {
  return (_x: number, y: number): number => {
    if (y >= floorY || y === ceilY) return TILE.SOLID;
    return TILE.AIR;
  };
}

/** 合成世界でスパン標が立つ (seed, 芯列) を探す(保護範囲の抽選は実世界の seed で決まる) */
function findSyntheticMark(get: (x: number, y: number) => number, wy: number): { seed: number; sx: number } | null {
  for (let seed = 1; seed <= 400; seed++) {
    for (let sx = -240; sx <= 240; sx += SPAN_PITCH) {
      if (spanMarkAt(get, seed, sx, wy)) return { seed, sx };
    }
  }
  return null;
}

describe('基礎の層: 通し番号と欠番', () => {
  it('番号は SPAN_PITCH 列ごとに 1 ずつ増え、1000 で回る', () => {
    expect(spanNumberAt(0)).toBe(0);
    expect(spanNumberAt(SPAN_PITCH)).toBe(1);
    expect(spanNumberAt(2 * SPAN_PITCH)).toBe(2);
    expect(spanNumberAt(999 * SPAN_PITCH)).toBe(999);
    expect(spanNumberAt(1000 * SPAN_PITCH)).toBe(0);
  });

  it('負の列でも番号は 0〜999 に収まる', () => {
    expect(spanNumberAt(-SPAN_PITCH)).toBe(999);
    expect(spanNumberAt(-2 * SPAN_PITCH)).toBe(998);
  });

  it('欠番は決定論で、割合は SPAN_BLANK_RATE の近傍', () => {
    let blank = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const sx = i * SPAN_PITCH;
      expect(spanBlank(SEED, sx)).toBe(spanBlank(SEED, sx));
      if (spanBlank(SEED, sx)) blank++;
    }
    const rate = blank / n;
    expect(rate).toBeGreaterThan(SPAN_BLANK_RATE * 0.5);
    expect(rate).toBeLessThan(SPAN_BLANK_RATE * 1.6);
  });
});

describe('基礎の層: スパン標の条件(合成世界)', () => {
  const get = corridor(20, 7);

  it('床の上の芯列に立つ', () => {
    const found = findSyntheticMark(get, 20);
    expect(found).not.toBeNull();
  });

  it('芯でない列には立たない', () => {
    const found = findSyntheticMark(get, 20);
    expect(found).not.toBeNull();
    expect(spanMarkAt(get, found!.seed, found!.sx + 1, 20)).toBe(false);
    expect(spanMarkAt(get, found!.seed, found!.sx + SPAN_PITCH / 2, 20)).toBe(false);
  });

  it('上面が空気でない床には立たない', () => {
    const buried = corridor(20, 19);
    expect(findSyntheticMark(buried, 20)).toBeNull();
  });

  it('隣の列に床が無い(幅 1 の床)には立たない', () => {
    // 72 の列だけが床の行(天井と床下は全列共通)
    const colOnly = (x: number, y: number): number => {
      if (y === 7) return TILE.SOLID;
      if (y === 20) return x === 72 ? TILE.SOLID : TILE.AIR;
      if (y > 20) return TILE.SOLID;
      return TILE.AIR;
    };
    for (let seed = 1; seed <= 50; seed++) expect(spanMarkAt(colOnly, seed, 72, 20)).toBe(false);
  });

  it('梯子列とその隣には立たない', () => {
    const found = findSyntheticMark(get, 20);
    expect(found).not.toBeNull();
    const { seed, sx } = found!;
    const withLadder = (x: number, y: number): number => {
      if ((x === sx + 2 && y === 19) || (x === sx - 1 && y === 20)) return TILE.LADDER;
      return get(x, y);
    };
    expect(spanMarkAt(withLadder, seed, sx, 20)).toBe(false);
  });
});

describe('基礎の層: 吊り材(合成世界)', () => {
  it('空気が 15 行で天井に届く通路では 15 を返す', () => {
    // 床 20、天井 4: 空気は 5〜19 の 15 行
    const get = corridor(20, 4);
    let hit = 0;
    for (let seed = 1; seed <= 400 && hit === 0; seed++) {
      for (let sx = -240; sx <= 240; sx += SPAN_PITCH) {
        if (spanHangerAt(get, seed, sx, 20) === 15) { hit++; break; }
      }
    }
    expect(hit).toBe(1);
  });

  it('空気が 16 行以上続く吹き抜けでは引かない', () => {
    const get = corridor(20, 3); // 空気 4〜19 の 16 行
    for (let seed = 1; seed <= 50; seed++) {
      for (let sx = -240; sx <= 240; sx += SPAN_PITCH) {
        expect(spanHangerAt(get, seed, sx, 20)).toBe(0);
      }
    }
  });

  it('天井が無い(ずっと空気)では引かない', () => {
    const get = (_x: number, y: number): number => (y >= 20 ? TILE.SOLID : TILE.AIR);
    for (let seed = 1; seed <= 50; seed++) {
      expect(spanHangerAt(get, seed, 0, 20)).toBe(0);
    }
  });

  it('空気が 1 行だけ(天井が近い)では引かない', () => {
    const get = corridor(20, 18); // 空気は 19 の 1 行
    for (let seed = 1; seed <= 50; seed++) {
      expect(spanHangerAt(get, seed, 0, 20)).toBe(0);
    }
  });

  it('空気の列に梯子があると引かない', () => {
    const base = corridor(20, 10);
    const get = (x: number, y: number): number => (x === 0 && y === 15 ? TILE.LADDER : base(x, y));
    for (let seed = 1; seed <= 50; seed++) {
      expect(spanHangerAt(get, seed, 0, 20)).toBe(0);
    }
  });
});

describe('基礎の層: 実世界と焼き込み', () => {
  it('標準シードの実世界にスパン標と吊り材が存在する', () => {
    let marks = 0;
    let hangers = 0;
    for (let sx = -480; sx <= 480; sx += SPAN_PITCH) {
      for (let wy = 40; wy <= 420; wy++) {
        if (spanMarkAt(tileGet, SEED, sx, wy)) marks++;
        if (spanHangerAt(tileGet, SEED, sx, wy) > 0) hangers++;
      }
    }
    expect(marks).toBeGreaterThan(0);
    expect(hangers).toBeGreaterThan(0);
  });

  it('開始地点の保護範囲の中でもスパン標を描く(裁定 J3)', () => {
    // 開始地点の床(前室の連続床)で、開始地点の保護範囲に掛かるスパン標を探す
    let proven: { sx: number; wy: number } | null = null;
    for (let seed = 1; seed <= 300 && !proven; seed++) {
      const get = (x: number, y: number): number => tileAt(seed, x, y);
      const spawn = findSpawn(seed);
      const floorY = Math.round(spawn.y + 1.9);
      for (let sx = Math.floor((spawn.x - 14) / SPAN_PITCH) * SPAN_PITCH; sx <= spawn.x + 14; sx += SPAN_PITCH) {
        if (!spanMarkAt(get, seed, sx, floorY)) continue;
        // この標の範囲が「開始地点の保護範囲で守られている」ことを示せれば、J3 の証拠になる
        if (sceneryGuarded(seed, sx - 1, sx + 2, floorY - 2, floorY + 2, true)) proven = { sx, wy: floorY };
      }
    }
    expect(proven).not.toBeNull();
  });

  it('decorateChunk がスパン標の面と番号の ops を出す', () => {
    // 実世界でスパン標のあるチャンクを探して焼き込みを見る
    let found: { cx: number; cy: number } | null = null;
    outer: for (let sx = -480; sx <= 480; sx += SPAN_PITCH) {
      for (let wy = 40; wy <= 420; wy++) {
        if (spanMarkAt(tileGet, SEED, sx, wy) && !spanBlank(SEED, sx)) {
          found = { cx: Math.floor(sx / 64), cy: Math.floor(wy / 64) };
          break outer;
        }
      }
    }
    expect(found).not.toBeNull();
    const ops = decorateChunk(SEED, found!.cx, found!.cy);
    expect(ops.some((o) => 'color' in o && o.color === SPAN_COLORS.face)).toBe(true);
    expect(ops.some((o) => 'color' in o && o.color === SPAN_COLORS.ink)).toBe(true);
    // 決定論: 同じチャンクは同じ ops
    expect(decorateChunk(SEED, found!.cx, found!.cy)).toEqual(ops);
  });

  it('新色は既存の色集合と重ならず、量子化の索引が想定どおり', () => {
    const existing = new Set<string>([
      ...Object.values(PALETTE), ...Object.values(SCENERY_COLORS), ...Object.values(GRAND_SHAFT_COLORS),
    ]);
    expect(existing.has(SPAN_COLORS.face)).toBe(false);
    expect(existing.has(SPAN_COLORS.ink)).toBe(false);
    const pal = paletteRgb();
    const idx = (hex: string): number => {
      const p = parseInt(hex.slice(1), 16);
      return nearestIndex((p >> 16) & 255, (p >> 8) & 255, p & 255, pal);
    };
    expect(idx(SPAN_COLORS.face)).toBe(17);
    expect(idx(SPAN_COLORS.ink)).toBe(27);
  });
});
