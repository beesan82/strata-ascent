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
