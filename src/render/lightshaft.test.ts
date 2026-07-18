import { describe, expect, it } from 'vitest';
import { shaftsInView, AMBIENT_MAX, ZOOM_OPEN } from './lightshaft';

const SEED = 20260711;

describe('shaftsInView', () => {
  it('決定論: 同じ引数は同じ結果', () => {
    const a = shaftsInView(SEED, 500, 90, 0.36, 0.6);
    const b = shaftsInView(SEED, 500, 90, 0.36, 0.6);
    expect(a).toEqual(b);
  });

  it('明るいバイオーム(ambient>=AMBIENT_MAX)では光条なし', () => {
    expect(shaftsInView(SEED, 500, 90, AMBIENT_MAX, 0.6)).toEqual([]);
    expect(shaftsInView(SEED, 500, 90, 0.72, 0.6)).toEqual([]);
  });

  it('閉塞(zoom>=ZOOM_OPEN)では光条なし', () => {
    expect(shaftsInView(SEED, 500, 90, 0.36, ZOOM_OPEN)).toEqual([]);
    expect(shaftsInView(SEED, 500, 90, 0.36, 1.0)).toEqual([]);
  });

  it('暗く開けた場所では光条が出る(ただし疎ら)', () => {
    const shafts = shaftsInView(SEED, 0, 400, 0.36, 0.55);
    expect(shafts.length).toBeGreaterThan(0);
    expect(shafts.length).toBeLessThan(7);
    for (const s of shafts) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.intensity).toBeGreaterThan(0);
      expect(s.intensity).toBeLessThanOrEqual(1);
    }
  });

  it('視野が広いほど光条数は増える(または同数)', () => {
    const narrow = shaftsInView(SEED, 0, 120, 0.36, 0.55).length;
    const wide = shaftsInView(SEED, 0, 1200, 0.36, 0.55).length;
    expect(wide).toBeGreaterThanOrEqual(narrow);
  });
});
