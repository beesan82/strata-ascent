import { describe, expect, it } from 'vitest';
import { hash2, valueNoise2 } from './noise';

describe('hash2', () => {
  it('同じ入力なら同じ値を返す(決定論)', () => {
    expect(hash2(42, 10, -5)).toBe(hash2(42, 10, -5));
  });

  it('値は [0, 1) に収まる', () => {
    for (let i = 0; i < 1000; i++) {
      const v = hash2(7, i * 31, -i * 17);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('シードが違えば分布が変わる', () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) {
      if (hash2(1, i, i) !== hash2(2, i, i)) diff++;
    }
    expect(diff).toBeGreaterThan(90);
  });

  it('seed=0 でも縮退しない(値が十分に分散する)', () => {
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(hash2(0, i * 13, -i * 7));
    }
    expect(values.size).toBeGreaterThanOrEqual(90);
  });
});

describe('valueNoise2', () => {
  it('同じ入力なら同じ値(決定論)', () => {
    expect(valueNoise2(42, 3.7, -1.2)).toBe(valueNoise2(42, 3.7, -1.2));
  });

  it('値は [0, 1] に収まり、なめらかに変化する', () => {
    let prev = valueNoise2(9, 0, 0);
    for (let i = 1; i <= 200; i++) {
      const v = valueNoise2(9, i * 0.05, 0);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.2); // 隣接サンプルが急変しない
      prev = v;
    }
  });

  it('負座標でも [0, 1] に収まり、なめらかに変化する', () => {
    let prev = valueNoise2(9, -10, -3.3);
    for (let i = 1; i <= 200; i++) {
      const v = valueNoise2(9, -10 + i * 0.1, -3.3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.2); // 負の格子境界でも急変しない
      prev = v;
    }
  });

  it('整数格子点では hash2 と一致する(負座標を含む)', () => {
    const coords: Array<[number, number]> = [
      [3, 4],
      [-2, 5],
      [-7, -7],
    ];
    for (const [x, y] of coords) {
      expect(valueNoise2(42, x, y)).toBe(hash2(42, x, y));
    }
  });
});
