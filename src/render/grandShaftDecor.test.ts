import { describe, expect, it } from 'vitest';
import { BIOME_IDS, biomeCellAt, biomeIdForCell } from '../world/biomeCells';
import { GRAND_LAMP_EVERY, grandLampAt, grandShaftAt, type GrandShaft } from '../world/grandShaft';
import { CHUNK_SIZE } from '../world/tiles';
import { decorateChunk, grandShaftOps, type DecorOp } from './decor';
import { GRAND_SHAFT_COLORS, grandLampColor, grandVistaColor } from './grandShaftColors';
import { GRAND_VISTA_ALPHA, grandShaftLightsInView } from './landmarkLight';

/** 最初に見つかる大昇降機(world/grandShaft.test.ts と同じ走査範囲の一部) */
function firstGrand(): { seed: number; s: GrandShaft } {
  for (const seed of [1, 42, 20260711, 7, 99]) {
    for (const g of [-2, -1, 0, 1]) {
      for (let band = -3; band <= 3; band++) {
        const s = grandShaftAt(seed, band, g);
        if (s) return { seed, s };
      }
    }
  }
  throw new Error('大昇降機が見つからない');
}

/** シャフトの列を含むチャンク列の、行 [wy0, wy1) に掛かるチャンクの装飾(世界座標へ戻すための原点つき) */
function opsAlong(seed: number, s: GrandShaft, wy0: number, wy1: number): { op: DecorOp; bx: number; by: number }[] {
  const out: { op: DecorOp; bx: number; by: number }[] = [];
  const cx = Math.floor((s.x0 + 2) / CHUNK_SIZE);
  for (let cy = Math.floor(wy0 / CHUNK_SIZE); cy <= Math.floor((wy1 - 1) / CHUNK_SIZE); cy++) {
    const ops: DecorOp[] = [];
    grandShaftOps(ops, seed, cx * CHUNK_SIZE, cy * CHUNK_SIZE);
    for (const op of ops) out.push({ op, bx: cx * CHUNK_SIZE, by: cy * CHUNK_SIZE });
  }
  return out;
}

describe('大昇降機の焼き込み装飾', () => {
  it('決定論', () => {
    const { seed, s } = firstGrand();
    const a: DecorOp[] = [];
    const b: DecorOp[] = [];
    const bx = Math.floor(s.x0 / CHUNK_SIZE) * CHUNK_SIZE;
    const by = Math.floor((s.yTop + 40) / CHUNK_SIZE) * CHUNK_SIZE;
    grandShaftOps(a, seed, bx, by);
    grandShaftOps(b, seed, bx, by);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('案内レールはチャンク境界をまたいで途切れず、上の停止階から最下端まで続く', () => {
    const { seed, s } = firstGrand();
    // 案内レールの左の 1 本の世界座標の縦区間を集めて、隙間がないことを確かめる
    const spans = opsAlong(seed, s, s.yTop - 3, s.yBottom)
      .filter(({ op, bx }) => op.kind === 'rect' && op.color === GRAND_SHAFT_COLORS.rail && Math.abs(op.x + bx - (s.x0 + 0.55)) < 1e-9)
      .map(({ op, by }) => (op.kind === 'rect' ? [op.y + by, op.y + op.h + by] : [0, 0]))
      .sort((p, q) => p[0] - q[0]);
    expect(spans.length).toBeGreaterThan(1);
    expect(spans[0][0]).toBeLessThanOrEqual(s.yTop - 3);
    let reach = spans[0][1];
    for (const [y0, y1] of spans.slice(1)) {
      expect(y0).toBeLessThanOrEqual(reach);
      reach = Math.max(reach, y1);
    }
    expect(reach).toBeGreaterThanOrEqual(s.yBottom);
  });

  it('灯は一定間隔で両側の壁にあり、色は行の地区で切り替わる(板の上下で違う色)', () => {
    const { seed, s } = firstGrand();
    const lampColors = new Set(BIOME_IDS.map((id) => grandLampColor(id)));
    const seen = new Map<number, string>();
    for (const { op, by } of opsAlong(seed, s, s.yTop - 3, s.yBottom)) {
      if (op.kind !== 'dot' || !lampColors.has(op.color)) continue;
      const wy = Math.floor(op.y + by);
      expect(grandLampAt(seed, s, wy)).toBe(true);
      expect(((wy - s.yTop) % GRAND_LAMP_EVERY + GRAND_LAMP_EVERY) % GRAND_LAMP_EVERY).toBe(GRAND_LAMP_EVERY / 2);
      expect(op.color).toBe(grandLampColor(biomeIdForCell(seed, biomeCellAt(seed, wy))));
      seen.set(wy, op.color);
    }
    const p = s.plates[0];
    const above = [...seen].filter(([wy]) => wy < p.top).map(([, c]) => c);
    const below = [...seen].filter(([wy]) => wy >= p.bottom).map(([, c]) => c);
    expect(above.length).toBeGreaterThan(0);
    expect(below.length).toBeGreaterThan(0);
    expect(above[0]).not.toBe(below[0]);
  });

  it('decorateChunk にシャフトの装飾が載る(描画パスは足さず既存の装飾リストへ相乗り)', () => {
    const { seed, s } = firstGrand();
    const cx = Math.floor((s.x0 + 2) / CHUNK_SIZE);
    const cy = Math.floor((s.yTop + 30) / CHUNK_SIZE);
    const ops = decorateChunk(seed, cx, cy);
    expect(ops.some((op) => op.kind === 'rect' && op.color === GRAND_SHAFT_COLORS.rail)).toBe(true);
    expect(ops.some((op) => op.kind === 'line' && op.color === GRAND_SHAFT_COLORS.cable)).toBe(true);
  });
});

describe('大昇降機の光', () => {
  it('眺望区間は明るい例外: 区間ごとに 1 枚、地区の眺望色で張り出しから張り出しまで', () => {
    const { seed, s } = firstGrand();
    expect(s.vistas.length).toBeGreaterThan(0);
    const vy = s.vistas[0];
    const color = grandVistaColor(biomeIdForCell(seed, biomeCellAt(seed, vy)));
    const rects = grandShaftLightsInView(seed, s.x0 + 3, vy - 5, 60, 40).filter((r) => r.alpha === GRAND_VISTA_ALPHA);
    expect(rects.length).toBe(1);
    expect(rects[0].color).toBe(color);
    expect(rects[0].x0).toBeLessThan(s.x0 - 1);
    expect(rects[0].x1).toBeGreaterThan(s.x0 + s.width + 1);
    expect(rects[0].y1).toBe(vy);
    // シャフトから離れた視野には出ない
    expect(grandShaftLightsInView(seed, s.x0 + 3 + 400, vy - 5, 60, 40).length).toBe(0);
  });

  it('決定論', () => {
    const { seed, s } = firstGrand();
    const y = (s.yTop + s.yBottom) / 2;
    expect(grandShaftLightsInView(seed, s.x0 + 3, y, 60, 40)).toEqual(grandShaftLightsInView(seed, s.x0 + 3, y, 60, 40));
  });
});
