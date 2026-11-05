import { describe, expect, it } from 'vitest';
import { landmarkAt, rampTopY, type Landmark, type LandmarkKind } from '../world/landmark';
import { restPointAt } from '../world/restpoint';
import { biomeForCell } from './biome';
import {
  COOLING_BEAM_HEIGHT, DISCHARGE_DUTY, dischargeOn, landmarkLightsInView, REST_WARM_ALPHA, REST_WARM_COLOR, restLampColor, RIFT_ALPHA,
} from './landmarkLight';
import { ambientDelta, REST_AMBIENT } from './beacon';

const seeds = [1, 42, 20260711];
const landmarks = (): { seed: number; lm: Landmark }[] =>
  seeds.flatMap((seed) => [-3, -2, -1, 0, 1, 2, 3].flatMap((cell) =>
    [-4, -3, -2, -1, 0, 1, 2, 3, 4].flatMap((k) => {
      const lm = landmarkAt(seed, cell, k);
      return lm ? [{ seed, lm }] : [];
    })));
const byKind = (kind: LandmarkKind): { seed: number; lm: Landmark }[] => landmarks().filter(({ lm }) => lm.kind === kind);

describe('dischargeOn', () => {
  it('点灯率は DISCHARGE_DUTY 前後で、k でずれ、決定論', () => {
    let on = 0;
    const N = 900;
    for (let i = 0; i < N; i++) if (dischargeOn(i / 90, 0)) on++;
    expect(on / N).toBeGreaterThan(DISCHARGE_DUTY - 0.12);
    expect(on / N).toBeLessThan(DISCHARGE_DUTY + 0.12);
    let differs = false;
    for (let i = 0; i < N; i++) if (dischargeOn(i / 90, 0) !== dischargeOn(i / 90, 1)) differs = true;
    expect(differs).toBe(true);
    expect(dischargeOn(0.3, 2)).toBe(dischargeOn(0.3, 2));
  });
});

describe('landmarkLightsInView', () => {
  it('冷却塔: 青い光柱 + 灯 + 暈の 3 枚が常時、地区の accent で', () => {
    const list = byKind('cooling');
    expect(list.length).toBeGreaterThan(0);
    for (const { seed, lm } of list) {
      const color = biomeForCell(seed, lm.cell).accent;
      const rects = landmarkLightsInView(seed, lm.x, lm.top - 20, 120, 120, 0).filter((r) => r.color === color);
      expect(rects.length).toBe(3);
      const beam = rects.find((r) => r.y0 === lm.top - COOLING_BEAM_HEIGHT);
      expect(beam).toBeDefined();
      expect(beam!.x0).toBe(lm.x - 2);
      expect(beam!.x1).toBe(lm.x + 2);
      // 視野外では出ない
      expect(landmarkLightsInView(seed, lm.x + 500, lm.top, 60, 40, 0).filter((r) => r.color === color).length).toBe(0);
    }
  });
  it('変圧塔: 放電が点いている間だけ 2 枚、消えている間は無し', () => {
    const list = byKind('transformer');
    expect(list.length).toBeGreaterThan(0);
    for (const { seed, lm } of list) {
      const color = biomeForCell(seed, lm.cell).accent;
      let tOn = -1, tOff = -1;
      for (let t = 0; t < 10 && (tOn < 0 || tOff < 0); t += 1 / 90) {
        if (dischargeOn(t, lm.k)) { if (tOn < 0) tOn = t; } else if (tOff < 0) tOff = t;
      }
      expect(tOn).toBeGreaterThanOrEqual(0);
      expect(tOff).toBeGreaterThanOrEqual(0);
      const on = landmarkLightsInView(seed, lm.x, lm.top, 60, 40, tOn).filter((r) => r.color === color);
      expect(on.length).toBe(2);
      for (const r of on) {
        expect(r.y0).toBeGreaterThanOrEqual(lm.top - 12);
        expect(r.y1).toBeLessThanOrEqual(lm.top - 8);
        expect(r.alpha).toBeGreaterThan(0);
      }
      expect(landmarkLightsInView(seed, lm.x, lm.top, 60, 40, tOff).filter((r) => r.color === color).length).toBe(0);
    }
  });
  it('煙突塔: 常時点灯の 2 枚、椎骨柱: 脈打つ 2 枚。どちらも地区の accent', () => {
    for (const kind of ['chimney', 'vertebra'] as const) {
      const list = byKind(kind);
      expect(list.length).toBeGreaterThan(0);
      for (const { seed, lm } of list) {
        const color = biomeForCell(seed, lm.cell).accent;
        for (const t of [0, 0.7, 2.3]) {
          const rects = landmarkLightsInView(seed, lm.x, lm.top, 60, 40, t).filter((r) => r.color === color);
          expect(rects.length).toBe(2);
          for (const r of rects) expect(r.alpha).toBeGreaterThan(0);
        }
      }
    }
  });
  it('大桁橋・吹き抜けホールは無光', () => {
    for (const kind of ['girder', 'atrium'] as const) {
      for (const { seed, lm } of byKind(kind)) {
        // 視野は層の内側だけに絞る(上下の層の崩落・塔系の光が色で混ざらないように)
        const spanY = Math.min(200, lm.floor - lm.top - 40);
        const rects = landmarkLightsInView(seed, lm.x, (lm.top + lm.floor) / 2, 300, spanY, 1);
        const color = biomeForCell(seed, lm.cell).accent;
        expect(rects.filter((r) => r.color === color).length).toBe(0);
      }
    }
  });
  it('崩落: 上の層の accent の帯 3 本が裂け目の中、板の上 6 行から斜路の上面まで', () => {
    const list = byKind('collapse');
    expect(list.length).toBeGreaterThan(0);
    for (const { seed, lm } of list) {
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
  });
  it('休憩点: 視野内の箱の内側に 1 枚、色は地区 accent と暖色の中間', () => {
    const rp = restPointAt(20260711, 0, 0);
    const color = restLampColor(20260711, rp.cell);
    const warm = landmarkLightsInView(20260711, rp.x, rp.floorY, 60, 40, 0).filter((r) => r.color === color);
    expect(warm.length).toBe(1);
    expect(warm[0]).toEqual({ x0: rp.left + 1, y0: rp.floorY - 12, x1: rp.right, y1: rp.floorY, alpha: REST_WARM_ALPHA, color });
    expect(landmarkLightsInView(20260711, rp.x + 200, rp.floorY, 60, 40, 0).filter((r) => r.color === color).length).toBe(0);
  });
  it('決定論', () => {
    const { seed, lm } = landmarks()[0];
    expect(landmarkLightsInView(seed, lm.x, lm.top, 200, 100, 0.5)).toEqual(landmarkLightsInView(seed, lm.x, lm.top, 200, 100, 0.5));
  });
});

describe('restLampColor(段階 3: 灯色の地区 accent 追随)', () => {
  it('地区 accent と暖色の中間色で、地区ごとに異なる', () => {
    const colors = new Set<string>();
    for (let cell = -14; cell < 14; cell++) {
      const expected = biomeForCell(20260711, cell).accent;
      const c = restLampColor(20260711, cell);
      // 暖色と accent の中間: どちらとも一致しない(両成分が混ざる)
      expect(c).not.toBe(REST_WARM_COLOR);
      expect(c).not.toBe(expected);
      colors.add(c);
    }
    expect(colors.size).toBeGreaterThanOrEqual(5);
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
