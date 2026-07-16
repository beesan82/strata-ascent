import { describe, expect, it } from 'vitest';
import { SYSTEMS } from '../../world/hierarchy';
import { slotsInView, damageFor, BANDS } from './place';

const SEED = 20260711;

describe('damageFor', () => {
  it('常に[0,1]に収まる', () => {
    for (let x = -50; x < 50; x++) {
      const d = damageFor(SEED, x, 0, 0);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('高度が上がるほど平均損傷は増える(崩壊寄りバイアス・単調)', () => {
    const avg = (alt: number) => {
      let s = 0;
      for (let x = 0; x < 200; x++) s += damageFor(SEED, x, 0, alt);
      return s / 200;
    };
    expect(avg(4000)).toBeGreaterThanOrEqual(avg(0));
    expect(avg(20000)).toBeGreaterThanOrEqual(avg(4000));
  });

  it('高度が極端でも[0,1]にクランプ', () => {
    expect(damageFor(SEED, 3, 0, 1e9)).toBeLessThanOrEqual(1);
    expect(damageFor(SEED, 3, 0, -1e9)).toBeGreaterThanOrEqual(0);
  });

  it('決定論: 同じ引数は同じ値', () => {
    expect(damageFor(SEED, 12, 1, 5000)).toBe(damageFor(SEED, 12, 1, 5000));
  });
});

describe('slotsInView', () => {
  it('決定論: 同じ引数は同じスロット列', () => {
    const a = slotsInView(SEED, 1000, 800, -3000);
    const b = slotsInView(SEED, 1000, 800, -3000);
    expect(a).toEqual(b);
  });

  it('各バンドのスロットを返し、typeは既知の系統', () => {
    const slots = slotsInView(SEED, 0, 2000, 0);
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      expect(SYSTEMS).toContain(s.type);
      expect(s.damage).toBeGreaterThanOrEqual(0);
      expect(s.damage).toBeLessThanOrEqual(1);
      expect(BANDS.map((b) => b.depth)).toContain(s.depth);
    }
  });

  it('画面幅が広いほどスロットは増える(または同数)', () => {
    const narrow = slotsInView(SEED, 0, 500, 0).length;
    const wide = slotsInView(SEED, 0, 5000, 0).length;
    expect(wide).toBeGreaterThanOrEqual(narrow);
  });
});
