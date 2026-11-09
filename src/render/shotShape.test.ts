import { describe, expect, it } from 'vitest';
import { shotShape } from './shotShape';

const PPT = 427 / 34; // ズーム 1 の px/タイル(約 12.56)

describe('shotShape', () => {
  it('水平は角度 0 で軸合わせ、右向きも左向きも回転なしで描ける', () => {
    expect(shotShape(1, 0, PPT).angle).toBe(0);
    expect(shotShape(1, 0, PPT).axis).toBe('h');
    expect(shotShape(-1, 0, PPT).axis).toBe('h');
    expect(Math.abs(shotShape(-1, 0, PPT).angle)).toBeCloseTo(Math.PI);
  });

  it('垂直は ±π/2 で軸合わせ', () => {
    expect(shotShape(0, 1, PPT).angle).toBeCloseTo(Math.PI / 2);
    expect(shotShape(0, 1, PPT).axis).toBe('v');
    expect(shotShape(0, -1, PPT).angle).toBeCloseTo(-Math.PI / 2);
    expect(shotShape(0, -1, PPT).axis).toBe('v');
  });

  it('45° は π/4 で回転描画になる(従来の横向き固定にならない)', () => {
    const s = shotShape(1, 1, PPT);
    expect(s.angle).toBeCloseTo(Math.PI / 4);
    expect(s.axis).toBe('diag');
    const n = shotShape(Math.SQRT1_2, -Math.SQRT1_2, PPT);
    expect(n.angle).toBeCloseTo(-Math.PI / 4);
    expect(n.axis).toBe('diag');
  });

  it('ゼロベクトルは横向きフォールバック', () => {
    const s = shotShape(0, 0, PPT);
    expect(s.angle).toBe(0);
    expect(s.axis).toBe('h');
  });

  it('角度はベクトルの長さに依らない', () => {
    expect(shotShape(3, 4, PPT).angle).toBeCloseTo(shotShape(0.6, 0.8, PPT).angle);
  });

  it('外帯は芯より長く太く、ppt に対して単調に増える', () => {
    let prev = shotShape(1, 0, 4);
    for (const ppt of [6, 8, PPT, 16, 24]) {
      const s = shotShape(1, 0, ppt);
      expect(s.outerLen).toBeGreaterThan(s.coreLen);
      expect(s.outerWid).toBeGreaterThan(s.coreWid);
      expect(s.outerLen).toBeGreaterThanOrEqual(prev.outerLen);
      expect(s.outerWid).toBeGreaterThanOrEqual(prev.outerWid);
      expect(s.coreLen).toBeGreaterThanOrEqual(prev.coreLen);
      expect(s.coreWid).toBeGreaterThanOrEqual(prev.coreWid);
      prev = s;
    }
  });

  it('ズーム 1 では従来の寸法(外帯 8×3、芯 6×2 px)と一致する', () => {
    const s = shotShape(1, 0, PPT);
    expect(s.outerLen).toBe(8);
    expect(s.outerWid).toBe(3);
    expect(s.coreLen).toBe(6);
    expect(s.coreWid).toBe(2);
  });

  it('小さい ppt でも 1 px 未満にならない(最小寸法の保証)', () => {
    const s = shotShape(1, 1, 1);
    expect(s.outerLen).toBe(2);
    expect(s.outerWid).toBe(1);
    expect(s.coreLen).toBe(2);
    expect(s.coreWid).toBe(1);
  });
});
