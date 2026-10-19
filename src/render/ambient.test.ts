import { describe, expect, it } from 'vitest';
import { restPointAt } from '../world/restpoint';
import { LAMP_COLOR, LAMP_PERIOD_MAX, LAMP_PERIOD_MIN, lampGlow, lampLightsInView, lampParams } from './ambient';

describe('lampParams / lampGlow', () => {
  it('周期は 2〜5 秒、位相は 0..1、灯ごとに異なる', () => {
    const a = lampParams(20260711, 0, 0, 0);
    const b = lampParams(20260711, 0, 0, 1);
    expect(a.period).toBeGreaterThanOrEqual(LAMP_PERIOD_MIN);
    expect(a.period).toBeLessThanOrEqual(LAMP_PERIOD_MAX);
    expect(a.phase).toBeGreaterThanOrEqual(0);
    expect(a.phase).toBeLessThan(1);
    expect(a.period !== b.period || a.phase !== b.phase).toBe(true);
  });
  it('明るさは 0..1、消える瞬間がある(1000 周期で 5〜20%)、周期の半ばは常に点いている', () => {
    const lamp = { period: 3, phase: 0.25 };
    let blackouts = 0;
    for (let n = 0; n < 1000; n++) {
      const t0 = (n - lamp.phase) * lamp.period; // 周期 n の先頭
      const g = lampGlow(t0 + 0.01, lamp, 1, 7);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(1);
      if (g === 0) blackouts++;
    }
    expect(blackouts).toBeGreaterThan(50);
    expect(blackouts).toBeLessThan(200);
    for (let n = 0; n < 100; n++) expect(lampGlow((n - lamp.phase + 0.5) * lamp.period, lamp, 1, 7)).toBeGreaterThan(0.5);
  });
});

describe('lampLightsInView', () => {
  it('視野に入る休憩点の灯ごとに灯+暈の 2 枚(消灯中は 0 枚)、視野外は返さない', () => {
    const seed = 20260711;
    const rp = restPointAt(seed, 0, 0);
    const rects = lampLightsInView(seed, rp.x, rp.floorY - 6, 60, 40, 0.37);
    expect(rects.length % 2).toBe(0);
    expect(rects.length).toBeLessThanOrEqual(rp.lamps.length * 2);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.color).toBe(LAMP_COLOR);
      expect(r.y1).toBe(rp.floorY);
      expect(rp.lamps.some((lx) => r.x0 <= lx && r.x1 > lx)).toBe(true);
    }
    expect(lampLightsInView(seed, rp.x + 2000, rp.floorY - 6, 60, 40, 0.37).some((r) => r.x0 <= rp.right)).toBe(false);
  });
});

import { BUILDER_MAX, BUILDER_SPEED, buildersInSlot, buildersInView } from './ambient';
import { interfaceBottom, PASSAGE_SLOT } from '../world/interface';

describe('buildersInSlot', () => {
  it('スロットごとに 0〜2 体、X はスロット内、Y は板の下面', () => {
    const seed = 20260711;
    let total = 0;
    for (let k = -5; k <= 5; k++) {
      const bs = buildersInSlot(seed, 0, k, 123.4);
      expect(bs.length).toBeLessThanOrEqual(BUILDER_MAX);
      total += bs.length;
      for (const b of bs) {
        expect(b.x).toBeGreaterThanOrEqual(k * PASSAGE_SLOT);
        expect(b.x).toBeLessThan((k + 1) * PASSAGE_SLOT);
        expect(b.y).toBe(interfaceBottom(seed, 0));
      }
    }
    expect(total).toBeGreaterThan(0);
  });
  it('位置 = 初期位置 + 速度 × simTime(0.3 タイル/秒)をスロット幅で折り返す', () => {
    const seed = 42;
    for (let k = -3; k <= 3; k++) {
      const at0 = buildersInSlot(seed, 1, k, 0);
      for (let i = 0; i < at0.length; i++) {
        const b0 = at0[i];
        const b1 = buildersInSlot(seed, 1, k, 10)[i];
        const wrapped = b1.x - b0.x - b0.dir * BUILDER_SPEED * 10;
        expect(Math.abs(wrapped) < 1e-9 || Math.abs(Math.abs(wrapped) - PASSAGE_SLOT) < 1e-9).toBe(true);
        expect(buildersInSlot(seed, 1, k, PASSAGE_SLOT / BUILDER_SPEED)[i].x).toBeCloseTo(b0.x, 6);
      }
    }
  });
  it('buildersInView は板の下面が視野(追従率 0.6 で広げた範囲)に入る層だけ返す', () => {
    const seed = 20260711;
    const y = interfaceBottom(seed, 0);
    const near = buildersInView(seed, 200, y, 44, 24, 5);
    expect(near.length).toBeGreaterThan(0);
    expect(near.every((b) => Math.abs(b.y - y) <= 24 / 2 / 0.6)).toBe(true);
    const far = buildersInView(seed, 200, y + 200, 44, 24, 5);
    expect(far.some((b) => b.y === y)).toBe(false);
  });
});

import { beaconsInView } from './beacon';
import { biomeIdForCell } from '../world/biomeCells';
import { DROP_SPEED, DROPS_MAX, fallingDropsInView, isWaterLayer } from './ambient';

describe('fallingDropsInView', () => {
  // seed 1〜200 から水系の層を探す(biomeIdForCell が waterVoid の cell)
  const water = (() => {
    for (let seed = 1; seed < 200; seed++) for (let cell = -4; cell <= 4; cell++) if (biomeIdForCell(seed, cell) === 'waterVoid') return { seed, cell };
    throw new Error('no water layer');
  })();
  const beaconOf = (seed: number, cell: number) => beaconsInView(seed, 192, interfaceBottom(seed, cell) + 10, 400, 60).find((b) => b.cell === cell)!;
  it('水系の層の光柱の中にだけ粒があり、X は柱の幅、Y は板の下面〜床', () => {
    const { seed, cell } = water;
    expect(isWaterLayer(seed, cell)).toBe(true);
    const bc = beaconOf(seed, cell);
    const rects = fallingDropsInView(seed, bc.x, (bc.top + bc.floor) / 2, 30, bc.floor - bc.top + 4, 3.3);
    expect(rects.length).toBeGreaterThan(0);
    for (const r of rects) {
      expect(r.x0).toBeGreaterThanOrEqual(bc.x - 12);
      expect(r.x1).toBeLessThanOrEqual(bc.x + 12);
      expect(r.y0).toBeGreaterThanOrEqual(bc.top);
      expect(r.y0).toBeLessThan(bc.floor);
      expect(r.color).toBe(bc.color);
    }
  });
  it('水系でない層には粒が無い', () => {
    const seed = 20260711;
    for (let cell = -3; cell <= 3; cell++) {
      if (isWaterLayer(seed, cell)) continue;
      const bc = beaconOf(seed, cell);
      expect(fallingDropsInView(seed, bc.x, (bc.top + bc.floor) / 2, 30, 60, 1).length).toBe(0);
    }
  });
  it('1 画面 12 個まで(視野に光柱が何本入っても)', () => {
    const { seed, cell } = water;
    const bc = beaconOf(seed, cell);
    expect(fallingDropsInView(seed, bc.x, bc.top + 24, 3000, 100, 2).length).toBeLessThanOrEqual(DROPS_MAX);
    expect(fallingDropsInView(seed, bc.x, bc.top + 24, 3000, 100, 2).length).toBe(DROPS_MAX);
  });
  it('粒は時間で下へ動き(14 タイル/秒)、床で折り返す', () => {
    const { seed, cell } = water;
    const bc = beaconOf(seed, cell);
    const H = bc.floor - bc.top;
    const a = fallingDropsInView(seed, bc.x, bc.top + H / 2, 30, H * 2, 0)[0];
    const b = fallingDropsInView(seed, bc.x, bc.top + H / 2, 30, H * 2, 0.1).find((r) => r.x0 === a.x0)!;
    const d = b.y0 - a.y0;
    expect(Math.abs(d - DROP_SPEED * 0.1) < 1e-6 || Math.abs(d - DROP_SPEED * 0.1 + H) < 1e-6).toBe(true);
  });
});
