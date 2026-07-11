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
});
