import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';

describe('makeRng', () => {
  it('同じ(seed,a,b)は同じ乱数列を返す', () => {
    const r1 = makeRng(7, 3, 5);
    const r2 = makeRng(7, 3, 5);
    const a = [r1(), r1(), r1(), r1()];
    const b = [r2(), r2(), r2(), r2()];
    expect(a).toEqual(b);
  });

  it('異なる(a,b)は異なる列になる', () => {
    const r1 = makeRng(7, 3, 5);
    const r2 = makeRng(7, 3, 6);
    expect(r1()).not.toEqual(r2());
  });

  it('値は常に[0,1)に収まる', () => {
    const r = makeRng(1, 2, 3);
    for (let i = 0; i < 100; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
