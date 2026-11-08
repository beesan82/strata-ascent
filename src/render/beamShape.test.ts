import { describe, expect, it } from 'vitest';
import {
  beamBands, chargeColor, chargeSegment, CHARGE_SEGMENTS,
  debrisFragments, muzzleFlash, DEBRIS_COUNT, DEBRIS_TTL,
} from './beamShape';
import { PIXEL_PALETTE } from './palette';

describe('beamBands', () => {
  it('発射直後は外帯が最も太く、帯は幅の降順に並ぶ', () => {
    const bands = beamBands(1);
    expect(bands.length).toBeGreaterThanOrEqual(3);
    expect(bands[0].width).toBeGreaterThan(2.5);
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].width).toBeLessThan(bands[i - 1].width);
    }
  });

  it('すべての帯の色がパレット実在色', () => {
    for (const a of [1, 0.7, 0.4, 0.15]) {
      for (const band of beamBands(a)) {
        expect(PIXEL_PALETTE).toContain(band.color);
      }
    }
  });

  it('芯は白で、最後まで残る', () => {
    for (const a of [1, 0.5, 0.2, 0.05]) {
      const bands = beamBands(a);
      const last = bands[bands.length - 1];
      expect(last.color).toBe('#c7d0ce');
    }
  });

  it('残光の後半は外帯と熱帯が消え、芯と中帯だけが残る', () => {
    const colors = beamBands(0.1).map((b) => b.color);
    expect(colors).not.toContain('#9a6d32');
    expect(colors).not.toContain('#caa64a');
    expect(colors).toContain('#c7d0ce');
    expect(colors).toContain('#51728d');
  });

  it('alpha が下がるほど帯は太くならない(最大幅と芯幅の単調性)', () => {
    let prevMax = Infinity;
    let prevCore = Infinity;
    for (const a of [1, 0.8, 0.6, 0.4, 0.2, 0.05]) {
      const bands = beamBands(a);
      const max = Math.max(...bands.map((b) => b.width));
      const core = bands[bands.length - 1].width;
      expect(max).toBeLessThanOrEqual(prevMax);
      expect(core).toBeLessThanOrEqual(prevCore);
      prevMax = max;
      prevCore = core;
    }
  });

  it('alpha 0 以下では何も描かない', () => {
    expect(beamBands(0)).toEqual([]);
    expect(beamBands(-0.5)).toEqual([]);
  });
});

describe('muzzleFlash', () => {
  it('寿命の後半では出ない', () => {
    expect(muzzleFlash(0.55)).toBeNull();
    expect(muzzleFlash(0.2)).toBeNull();
  });

  it('発射直後が最大で、単調に縮む', () => {
    const f1 = muzzleFlash(1)!;
    const f2 = muzzleFlash(0.8)!;
    expect(f1.length).toBeGreaterThan(f2.length);
    expect(f1.width).toBeGreaterThan(f2.width);
    expect(f1.alpha).toBeGreaterThan(f2.alpha);
  });
});

describe('chargeColor', () => {
  it('溜めの段階で鋼→錆→金と切り替わり、すべてパレット実在色', () => {
    expect(chargeColor(0)).toBe('#51728d');
    expect(chargeColor(0.44)).toBe('#51728d');
    expect(chargeColor(0.45)).toBe('#9a6d32');
    expect(chargeColor(0.79)).toBe('#9a6d32');
    expect(chargeColor(0.8)).toBe('#caa64a');
    expect(chargeColor(1)).toBe('#caa64a');
    for (const r of [0, 0.3, 0.6, 0.9, 1]) expect(PIXEL_PALETTE).toContain(chargeColor(r));
  });
});

describe('chargeSegment', () => {
  it('6 本すべて異なる角度で、溜めるほど銃口へ寄って伸びる', () => {
    const angles = new Set<number>();
    for (let i = 0; i < CHARGE_SEGMENTS; i++) {
      const s0 = chargeSegment(0, i);
      const s1 = chargeSegment(1, i);
      angles.add(s0.angle);
      expect(s1.dist).toBeLessThan(s0.dist);
      expect(s1.len).toBeGreaterThan(s0.len);
    }
    expect(angles.size).toBe(CHARGE_SEGMENTS);
  });
});

describe('debrisFragments', () => {
  it('決定的: 同じ (key, angle, age) で同じ配置', () => {
    expect(debrisFragments(7, 0.3, 0.1)).toEqual(debrisFragments(7, 0.3, 0.1));
  });

  it('key が違うと配置が変わる', () => {
    expect(debrisFragments(7, 0.3, 0.1)).not.toEqual(debrisFragments(8, 0.3, 0.1));
  });

  it('寿命外では空、寿命内では DEBRIS_COUNT 個', () => {
    expect(debrisFragments(1, 0, -0.01)).toEqual([]);
    expect(debrisFragments(1, 0, DEBRIS_TTL + 0.01)).toEqual([]);
    expect(debrisFragments(1, 0, 0.1)).toHaveLength(DEBRIS_COUNT);
  });

  it('age 0 では全断片が原点にあり、時間が進むと平均で下へ落ちる', () => {
    for (const f of debrisFragments(3, 0, 0)) {
      expect(Math.abs(f.dx)).toBe(0);
      expect(Math.abs(f.dy)).toBe(0);
    }
    const meanDy = (age: number) =>
      debrisFragments(3, 0, age).reduce((s, f) => s + f.dy, 0) / DEBRIS_COUNT;
    expect(meanDy(0.25)).toBeGreaterThan(meanDy(0.05));
  });

  it('色はすべてパレット実在色で、後半は薄れる', () => {
    for (const f of debrisFragments(5, 1.2, 0.1)) {
      expect(PIXEL_PALETTE).toContain(f.color);
      expect(f.size).toBeGreaterThan(0);
    }
    const early = debrisFragments(5, 1.2, 0.05)[0].alpha;
    const late = debrisFragments(5, 1.2, DEBRIS_TTL * 0.95)[0].alpha;
    expect(late).toBeLessThan(early);
  });
});
