import { describe, expect, it } from 'vitest';
import { farSilhouettes, rareLandmarkAt } from './background';

describe('farSilhouettes', () => {
  it('決定論: 同じ範囲・シードなら同じ配置', () => {
    expect(farSilhouettes(42, 0, 100000)).toEqual(farSilhouettes(42, 0, 100000));
  });
  it('広域で複数のシルエットが返る', () => {
    expect(farSilhouettes(42, 0, 200000).length).toBeGreaterThan(2);
  });
  it('各シルエットは種別・位置・大きさを持つ', () => {
    for (const s of farSilhouettes(42, 0, 200000)) {
      expect(['tower', 'dome', 'gantry', 'ring']).toContain(s.kind);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
    }
  });
});

describe('rareLandmarkAt', () => {
  it('決定論', () => {
    expect(rareLandmarkAt(42, 5)).toEqual(rareLandmarkAt(42, 5));
  });
  it('稀少: 大半のスロットは null だが一部存在', () => {
    let present = 0;
    const N = 200;
    for (let i = 0; i < N; i++) if (rareLandmarkAt(42, i)) present++;
    expect(present).toBeGreaterThan(0);
    expect(present).toBeLessThan(N * 0.25);
  });
});
