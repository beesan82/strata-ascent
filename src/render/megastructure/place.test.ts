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

  it('uses signed Y cells for bounded, non-monotonic damage', () => {
    const damage = [-100000, -10000, 0, 10000, 100000].map((worldY) =>
      damageFor(SEED, 12, 0, worldY),
    );
    for (const value of damage) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(damage).not.toEqual([...damage].sort((a, b) => a - b));
    expect(damage).not.toEqual([...damage].sort((a, b) => b - a));
  });

  it('keeps extreme signed coordinates within [0,1]', () => {
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

  it('biomechフラグは稀(全スロットの15%未満)だが皆無ではない', () => {
    let total = 0;
    let bio = 0;
    for (let cx = 0; cx < 3000; cx += 400) {
      for (const s of slotsInView(SEED, cx, 2000, 0)) {
        total++;
        if (s.biomech) bio++;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(bio).toBeGreaterThan(0);
    expect(bio / total).toBeLessThan(0.15);
  });

  it('biomechフラグも決定論', () => {
    const a = slotsInView(SEED, 1000, 800, -3000).map((s) => s.biomech);
    const b = slotsInView(SEED, 1000, 800, -3000).map((s) => s.biomech);
    expect(a).toEqual(b);
  });
});
