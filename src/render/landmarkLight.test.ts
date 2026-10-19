import { describe, expect, it } from 'vitest';
import { landmarkAt, rampTopY, type Landmark } from '../world/landmark';
import { restPointAt } from '../world/restpoint';
import { biomeForCell } from './biome';
import {
  landmarkLightsInView, REST_WARM_ALPHA, REST_WARM_COLOR, RIFT_ALPHA, TOWER_BLINK_COLOR, TOWER_BLINK_DUTY,
  TOWER_BLINK_PERIOD, towerBlink,
} from './landmarkLight';
import { ambientDelta, REST_AMBIENT } from './beacon';

const seeds = [1, 42, 20260711];
const landmarks = (): { seed: number; lm: Landmark }[] =>
  seeds.flatMap((seed) => [-2, 1].flatMap((cell) => [-3, 0, 3].map((k) => ({ seed, lm: landmarkAt(seed, cell, k)! }))));

describe('towerBlink', () => {
  it('周期 1.6 秒で約 15% 点灯し、k で位相がずれる', () => {
    let on = 0;
    const N = 160;
    for (let i = 0; i < N; i++) if (towerBlink((i / N) * TOWER_BLINK_PERIOD, 0)) on++;
    expect(on / N).toBeCloseTo(TOWER_BLINK_DUTY, 1);
    let differs = false;
    for (let i = 0; i < N; i++) if (towerBlink((i / N) * TOWER_BLINK_PERIOD, 0) !== towerBlink((i / N) * TOWER_BLINK_PERIOD, 1)) differs = true;
    expect(differs).toBe(true);
    expect(towerBlink(0.3, 2)).toBe(towerBlink(0.3 + TOWER_BLINK_PERIOD, 2));
  });
});

describe('landmarkLightsInView', () => {
  it('塔: 点灯中だけ 2 枚、頂部の床の上に。消灯中は無し', () => {
    let towers = 0;
    for (const { seed, lm } of landmarks()) {
      if (lm.kind !== 'tower') continue;
      towers++;
      let tOn = 0, tOff = 0;
      for (let t = 0; t < TOWER_BLINK_PERIOD; t += 0.01) { if (towerBlink(t, lm.k)) tOn = t; else tOff = t; }
      const on = landmarkLightsInView(seed, lm.x, lm.top, 60, 40, tOn).filter((r) => r.color === TOWER_BLINK_COLOR);
      expect(on.length).toBe(2);
      for (const r of on) {
        expect(r.x0).toBeGreaterThanOrEqual(lm.x - 4);
        expect(r.x1).toBeLessThanOrEqual(lm.x + 4);
        expect(r.y0).toBeGreaterThanOrEqual(lm.top - 12);
        expect(r.y1).toBeLessThanOrEqual(lm.top - 8);
        expect(r.alpha).toBeGreaterThan(0);
      }
      expect(landmarkLightsInView(seed, lm.x, lm.top, 60, 40, tOff).filter((r) => r.color === TOWER_BLINK_COLOR).length).toBe(0);
      // 視野外
      expect(landmarkLightsInView(seed, lm.x + 500, lm.top, 60, 40, tOn).filter((r) => r.color === TOWER_BLINK_COLOR).length).toBe(0);
    }
    expect(towers).toBeGreaterThan(0);
  });
  it('崩落: 上の層の accent の帯 3 本が裂け目の中、板の上 6 行から斜路の上面まで', () => {
    let collapses = 0;
    for (const { seed, lm } of landmarks()) {
      if (lm.kind !== 'collapse') continue;
      collapses++;
      const color = biomeForCell(seed, lm.cell - 1).accent;
      const rays = landmarkLightsInView(seed, lm.x, lm.top + 20, 400, 200, 1).filter((r) => r.color === color);
      expect(rays.length).toBe(3);
      for (const r of rays) {
        expect(r.x0).toBeGreaterThanOrEqual(lm.gapLeft);
        expect(r.x1).toBeLessThanOrEqual(lm.gapRight);
        expect(r.y0).toBe(lm.top - 6);
        expect(r.y1).toBe(rampTopY(lm, Math.floor((r.x0 + r.x1) / 2)));
        expect(r.alpha).toBeGreaterThan(0);
        expect(r.alpha).toBeLessThanOrEqual(RIFT_ALPHA * 1.2);
      }
      expect(landmarkLightsInView(seed, lm.x, lm.top + 600, 400, 200, 1).filter((r) => r.color === color).length).toBe(0);
    }
    expect(collapses).toBeGreaterThan(0);
  });
  it('休憩点: 視野内の箱の内側に 1 枚', () => {
    const rp = restPointAt(20260711, 0, 0);
    const warm = landmarkLightsInView(20260711, rp.x, rp.floorY, 60, 40, 0).filter((r) => r.color === REST_WARM_COLOR);
    expect(warm.length).toBe(1);
    expect(warm[0]).toEqual({ x0: rp.left + 1, y0: rp.floorY - 12, x1: rp.right, y1: rp.floorY, alpha: REST_WARM_ALPHA, color: REST_WARM_COLOR });
    expect(landmarkLightsInView(20260711, rp.x + 200, rp.floorY, 60, 40, 0).filter((r) => r.color === REST_WARM_COLOR).length).toBe(0);
  });
  it('決定論', () => {
    const { seed, lm } = landmarks()[0];
    expect(landmarkLightsInView(seed, lm.x, lm.top, 200, 100, 0.5)).toEqual(landmarkLightsInView(seed, lm.x, lm.top, 200, 100, 0.5));
  });
});

describe('ambientDelta の休憩点補正', () => {
  it('箱の中で +0.12、12 タイル先で 0', () => {
    const rp = restPointAt(20260711, 0, 0);
    expect(ambientDelta(20260711, rp.x, rp.floorY - 5)).toBeCloseTo(REST_AMBIENT, 5);
    expect(ambientDelta(20260711, rp.right + 6, rp.floorY - 5)).toBeCloseTo(REST_AMBIENT / 2, 5);
    expect(ambientDelta(20260711, rp.right + 12, rp.floorY - 5)).toBe(0);
  });
});
