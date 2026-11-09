import { describe, expect, it } from 'vitest';
import {
  beamBands, chargeArcs, chargeColor, chargeCore, chargeGlow, chargeParticles, chargeRing,
  CHARGE_ARC_FROM, CHARGE_ARC_HZ, CHARGE_ARC_JITTER, CHARGE_ARC_REACH,
  CHARGE_ARC_SEG_MAX, CHARGE_ARC_SEG_MIN, CHARGE_ARC_STEP_MAX,
  CHARGE_PARTICLE_MAX, CHARGE_RING_R_MAX, CHARGE_RING_R_MIN, CHARGE_RING_TTL,
  debrisFragments, hexWithAlpha, muzzleFlash, DEBRIS_COUNT, DEBRIS_TTL,
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

describe('hexWithAlpha', () => {
  it('#rrggbb を rgba に変換する', () => {
    expect(hexWithAlpha('#caa64a', 0)).toBe('rgba(202,166,74,0)');
    expect(hexWithAlpha('#c7d0ce', 0.5)).toBe('rgba(199,208,206,0.5)');
  });
});

describe('chargeParticles', () => {
  const dist = (p: { dx: number; dy: number }) => Math.hypot(p.dx, p.dy);

  it('決定的: 同じ (ratio, timeSec) で同じ配置', () => {
    expect(chargeParticles(0.7, 1.23)).toEqual(chargeParticles(0.7, 1.23));
  });

  it('ratio 0 以下では出ず、満タンで CHARGE_PARTICLE_MAX 個、個数は ratio に対して単調', () => {
    expect(chargeParticles(0, 1)).toEqual([]);
    expect(chargeParticles(-1, 1)).toEqual([]);
    expect(chargeParticles(1, 1)).toHaveLength(CHARGE_PARTICLE_MAX);
    let prev = 0;
    for (const r of [0.05, 0.2, 0.4, 0.6, 0.8, 1]) {
      const n = chargeParticles(r, 1).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
  });

  it('時間が進むと各火花は銃口へ近づく(進みが巻き戻らない限り距離が縮む)', () => {
    const a = chargeParticles(0.5, 2.0);
    const b = chargeParticles(0.5, 2.02);
    let compared = 0;
    for (let i = 0; i < a.length; i++) {
      if (b[i].progress > a[i].progress) {
        expect(dist(b[i])).toBeLessThan(dist(a[i]));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('火花は出発半径の範囲内にあり、銃口に着く直前が最も明るい', () => {
    for (const p of chargeParticles(1, 0.37)) {
      expect(dist(p)).toBeLessThanOrEqual(32 + 1e-9);
      expect(dist(p)).toBeGreaterThanOrEqual(2 - 1e-9);
      expect(p.alpha).toBeGreaterThan(0);
      expect(p.alpha).toBeLessThanOrEqual(1);
    }
    const near = chargeParticles(1, 0).map((p) => ({ p: p.progress, a: p.alpha }));
    near.sort((x, y) => x.p - y.p);
    for (let i = 1; i < near.length; i++) expect(near[i].a).toBeGreaterThanOrEqual(near[i - 1].a);
  });

  it('色はすべてパレット実在色で、終盤は銃口近くが白くなる', () => {
    for (const r of [0.2, 0.5, 0.9, 1]) {
      for (const p of chargeParticles(r, 0.9)) expect(PIXEL_PALETTE).toContain(p.color);
    }
    const nearWhite = (r: number) =>
      chargeParticles(r, 0.9).some((p) => p.progress > 0.75 && p.color === '#c7d0ce');
    expect(nearWhite(1)).toBe(true);
    expect(nearWhite(0.2)).toBe(false);
  });

  it('溜めるほど速い(同じ時間差で進みが大きい。巻き戻りは 1 周として数える)', () => {
    const adv = (r: number) => {
      const a = chargeParticles(r, 0);
      const b = chargeParticles(r, 0.05);
      const d = b[0].progress - a[0].progress;
      return d < 0 ? d + 1 : d;
    };
    expect(adv(1)).toBeGreaterThan(adv(0.3));
  });
});

describe('chargeCore', () => {
  it('中心は白で、色止めは 0 から 1 へ昇順、端は透明', () => {
    for (const r of [0, 0.5, 1]) {
      const c = chargeCore(r);
      expect(c.stops[0].offset).toBe(0);
      expect(c.stops[0].color).toBe('#c7d0ce');
      for (let i = 1; i < c.stops.length; i++) {
        expect(c.stops[i].offset).toBeGreaterThan(c.stops[i - 1].offset);
      }
      expect(c.stops[c.stops.length - 1].offset).toBe(1);
      expect(c.stops[c.stops.length - 1].color).toMatch(/,0\)$/);
    }
  });

  it('溜めるほど半径・白芯・明るさが増す', () => {
    const c0 = chargeCore(0);
    const c1 = chargeCore(1);
    expect(c1.radius).toBeGreaterThan(c0.radius);
    expect(c1.stops[1].offset).toBeGreaterThan(c0.stops[1].offset);
    expect(c1.alpha).toBeGreaterThan(c0.alpha);
    expect(c1.alpha).toBeLessThanOrEqual(1);
  });

  it('中間色は溜め段の色(chargeColor)に揃う', () => {
    expect(chargeCore(0.3).stops[1].color).toBe(chargeColor(0.3));
    expect(chargeCore(0.9).stops[1].color).toBe(chargeColor(0.9));
  });
});

describe('chargeArcs', () => {
  it('CHARGE_ARC_FROM 未満では出ず、以降は本数が増える', () => {
    expect(chargeArcs(CHARGE_ARC_FROM - 0.01, 1)).toEqual([]);
    expect(chargeArcs(0, 1)).toEqual([]);
    const n0 = chargeArcs(CHARGE_ARC_FROM, 1).length;
    const n1 = chargeArcs(1, 1).length;
    expect(n0).toBeGreaterThanOrEqual(2);
    expect(n1).toBeGreaterThan(n0);
  });

  it('同じ tick では同じ形、tick が進むと形が変わる', () => {
    const tick0a = chargeArcs(1, 0.01);
    const tick0b = chargeArcs(1, 0.5 / CHARGE_ARC_HZ);
    expect(tick0a).toEqual(tick0b);
    expect(chargeArcs(1, 0)).not.toEqual(chargeArcs(1, 1));
  });

  it('各電弧はコア表面から始まり外へ向かって伸び、色はパレット実在色', () => {
    const coreR = chargeCore(1).radius;
    for (const arc of chargeArcs(1, 0.7)) {
      expect(arc.points.length).toBeGreaterThanOrEqual(CHARGE_ARC_SEG_MIN + 1);
      expect(arc.points.length).toBeLessThanOrEqual(CHARGE_ARC_SEG_MAX + 1);
      const d = arc.points.map((p) => Math.hypot(p.x, p.y));
      expect(d[0]).toBeLessThan(coreR);
      for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThan(d[i - 1]);
      expect(PIXEL_PALETTE).toContain(arc.color);
      expect(arc.alpha).toBeGreaterThan(0);
      expect(arc.alpha).toBeLessThanOrEqual(1);
    }
  });

  it('稲妻型: 主方向へ 1 セグメント最大 4px ずつ進み、垂直方向のジッターは ±2.5px 以内', () => {
    for (const [ratio, time] of [[1, 0.7], [1, 2.3], [0.8, 0.1], [CHARGE_ARC_FROM, 5.5]] as const) {
      for (const arc of chargeArcs(ratio, time)) {
        const p0 = arc.points[0];
        const len0 = Math.hypot(p0.x, p0.y);
        const ux = p0.x / len0;
        const uy = p0.y / len0;
        let prevAlong = len0;
        for (let i = 1; i < arc.points.length; i++) {
          const p = arc.points[i];
          const along = p.x * ux + p.y * uy;
          const perp = -p.x * uy + p.y * ux;
          expect(along - prevAlong).toBeGreaterThan(0);
          expect(along - prevAlong).toBeLessThanOrEqual(CHARGE_ARC_STEP_MAX + 1e-9);
          expect(Math.abs(perp)).toBeLessThanOrEqual(CHARGE_ARC_JITTER + 1e-9);
          prevAlong = along;
        }
      }
    }
  });

  it('全長はコア半径 + CHARGE_ARC_REACH 以内に収まる(地面まで垂れない)', () => {
    for (const ratio of [CHARGE_ARC_FROM, 0.8, 1]) {
      const limit = chargeCore(ratio).radius + CHARGE_ARC_REACH;
      for (let k = 0; k < 40; k++) {
        for (const arc of chargeArcs(ratio, k / CHARGE_ARC_HZ)) {
          for (const p of arc.points) expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(limit + 1e-9);
        }
      }
    }
  });

  it('決定的: 同じ (ratio, timeSec) で同じ形', () => {
    expect(chargeArcs(1, 0.37)).toEqual(chargeArcs(1, 0.37));
  });
});

describe('chargeRing', () => {
  it('満タン未満・寿命外では出ない', () => {
    expect(chargeRing(0.99, 0.1)).toBeNull();
    expect(chargeRing(1, -0.01)).toBeNull();
    expect(chargeRing(1, CHARGE_RING_TTL + 0.01)).toBeNull();
  });

  it('経過で半径が広がり、線幅と明るさが痩せる', () => {
    const a = chargeRing(1, 0.02)!;
    const b = chargeRing(1, CHARGE_RING_TTL * 0.8)!;
    expect(b.radius).toBeGreaterThan(a.radius);
    expect(b.width).toBeLessThan(a.width);
    expect(b.width).toBeGreaterThanOrEqual(1);
    expect(b.alpha).toBeLessThan(a.alpha);
    expect(b.alpha).toBeGreaterThan(0);
  });

  it('半径は CHARGE_RING_R_MIN から CHARGE_RING_R_MAX(13px)までで、プレイヤーを囲む大きさにならない', () => {
    expect(CHARGE_RING_R_MAX).toBe(13);
    expect(CHARGE_RING_TTL).toBeCloseTo(0.18);
    expect(chargeRing(1, 0)!.radius).toBeCloseTo(CHARGE_RING_R_MIN);
    expect(chargeRing(1, CHARGE_RING_TTL)!.radius).toBeCloseTo(CHARGE_RING_R_MAX);
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      expect(chargeRing(1, CHARGE_RING_TTL * f)!.radius).toBeLessThanOrEqual(CHARGE_RING_R_MAX);
    }
  });

  it('明るさは (1-p) の冪で線形より速く消える', () => {
    const half = chargeRing(1, CHARGE_RING_TTL * 0.5)!;
    expect(half.alpha).toBeLessThan(0.5);
    expect(half.alpha).toBeGreaterThan(0);
    expect(chargeRing(1, 0)!.alpha).toBeCloseTo(1);
    expect(chargeRing(1, CHARGE_RING_TTL)!.alpha).toBeCloseTo(0);
  });
});

describe('chargeGlow', () => {
  it('ratio 0 以下では出ず、溜めるほど大きく明るい', () => {
    expect(chargeGlow(0, 0)).toBeNull();
    const g1 = chargeGlow(0.3, 0)!;
    const g2 = chargeGlow(0.9, 0)!;
    expect(g2.radius).toBeGreaterThan(g1.radius);
    expect(g2.alpha).toBeGreaterThan(g1.alpha);
  });

  it('満タン直後は完了リングと同期して一瞬強まり、その後は定常値に戻る', () => {
    const burst = chargeGlow(1, 0.01)!;
    const steady = chargeGlow(1, CHARGE_RING_TTL + 1)!;
    expect(burst.alpha).toBeGreaterThan(steady.alpha);
    expect(steady.alpha).toBeLessThanOrEqual(1);
  });

  it('リング連動の半径増分はリングの広がりに追随し、基本半径(10 + 24t)は変わらない', () => {
    const steady = chargeGlow(1, CHARGE_RING_TTL + 1)!;
    expect(steady.radius).toBeCloseTo(34);
    const start = chargeGlow(1, 0)!;
    const mid = chargeGlow(1, CHARGE_RING_TTL * 0.5)!;
    const end = chargeGlow(1, CHARGE_RING_TTL)!;
    expect(start.radius).toBeCloseTo(steady.radius);
    expect(mid.radius).toBeGreaterThan(start.radius);
    expect(end.radius).toBeGreaterThan(mid.radius);
    expect(end.radius - steady.radius).toBeLessThanOrEqual(6 + 1e-9);
    // リングが最大半径に達した時点で増分も最大
    const ringEnd = chargeRing(1, CHARGE_RING_TTL)!;
    expect(end.radius - steady.radius).toBeCloseTo(
      6 * (ringEnd.radius - CHARGE_RING_R_MIN) / (CHARGE_RING_R_MAX - CHARGE_RING_R_MIN),
    );
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
