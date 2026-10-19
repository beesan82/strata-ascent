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
