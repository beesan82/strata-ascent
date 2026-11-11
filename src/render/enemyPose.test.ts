import { describe, expect, it } from 'vitest';
import { FLYER_CHASE_SPEED, FLYER_PATROL_SPEED } from '../entities/enemy';
import { TURRET_FIRE_INTERVAL } from '../entities/turret';
import {
  flyerPose, kneeOf, turretPose, walkerPose, walkPhase,
  NAV_DUTY, NAV_HZ, TURRET_RECOIL_TIME, TURRET_WARN_WINDOW, WALKER_HIP_TO_GROUND, WALKER_STRIDE,
  WALKER_SWING, WALKER_THIGH, WALKER_LIMP_LURCH, WALKER_LIMP_SINK,
} from './enemyPose';

const PALETTE_LIGHTS = ['#5a3a24', '#9a6d32', '#caa64a', '#c7d0ce'];

describe('walkPhase(歩行位相)', () => {
  it('進んだ距離を歩幅で割った小数部(0..1)', () => {
    expect(walkPhase(0, 1)).toBe(0);
    expect(walkPhase(WALKER_STRIDE / 4, 1)).toBeCloseTo(0.25);
    expect(walkPhase(WALKER_STRIDE * 3 + WALKER_STRIDE / 2, 1)).toBeCloseTo(0.5);
    for (const x of [-37.3, -1, 0.2, 5.5, 1234.56]) {
      for (const d of [1, -1] as const) {
        const p = walkPhase(x, d);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThan(1);
      }
    }
  });

  it('左向きは x が減るほど位相が進む', () => {
    const a = walkPhase(10, -1);
    const b = walkPhase(10 - WALKER_STRIDE / 4, -1);
    expect(b - a).toBeCloseTo(0.25);
  });
});

describe('kneeOf(膝の位置)', () => {
  it('腿と脛の長さ(等長)を保つ', () => {
    for (const foot of [{ x: 0, y: 0.33 }, { x: 0.15, y: 0.3 }, { x: -0.16, y: 0.25 }]) {
      for (const d of [1, -1] as const) {
        const k = kneeOf(foot, d);
        expect(Math.hypot(k.x, k.y)).toBeCloseTo(WALKER_THIGH);
        expect(Math.hypot(foot.x - k.x, foot.y - k.y)).toBeCloseTo(WALKER_THIGH);
      }
    }
  });

  it('膝は進行方向の側へ曲がる', () => {
    const foot = { x: 0, y: WALKER_HIP_TO_GROUND };
    expect(kneeOf(foot, 1).x).toBeGreaterThan(0);
    expect(kneeOf(foot, -1).x).toBeLessThan(0);
  });

  it('届かない足では中点に置く', () => {
    const k = kneeOf({ x: 0, y: 1 }, 1);
    expect(k).toEqual({ x: 0, y: 0.5 });
  });
});

describe('walkerPose(歩行敵のポーズ)', () => {
  it('同じ入力なら同じポーズ(決定論)', () => {
    expect(walkerPose(12.34, 1)).toEqual(walkerPose(12.34, 1));
  });

  it('接地中の脚は床にあり、振り出し中の脚は持ち上がる', () => {
    // 位相 0.25: 奥の脚は接地の途中、手前の脚(+0.5)は振り出しの頂点
    const pose = walkerPose(WALKER_STRIDE * 0.25, 1);
    expect(pose.legs[0].foot.y).toBeCloseTo(WALKER_HIP_TO_GROUND);
    expect(pose.legs[1].foot.y).toBeLessThan(WALKER_HIP_TO_GROUND - 0.05);
  });

  it('2 本の脚は半周期ずれる(位相 0 で前後対称)', () => {
    const pose = walkerPose(0, 1);
    expect(pose.legs[0].foot.x).toBeCloseTo(WALKER_SWING);
    expect(pose.legs[1].foot.x).toBeCloseTo(-WALKER_SWING);
  });

  it('接地中の足は進むにつれて後ろへ送られる', () => {
    const a = walkerPose(WALKER_STRIDE * 0.1, 1).legs[0].foot.x;
    const b = walkerPose(WALKER_STRIDE * 0.3, 1).legs[0].foot.x;
    expect(b).toBeLessThan(a);
  });

  it('左向きは右向きの鏡像', () => {
    const r = walkerPose(3.21, 1);
    const l = walkerPose(-3.21, -1);
    for (let i = 0; i < 2; i++) {
      expect(l.legs[i].foot.x).toBeCloseTo(-r.legs[i].foot.x);
      expect(l.legs[i].foot.y).toBeCloseTo(r.legs[i].foot.y);
      expect(l.legs[i].knee.x).toBeCloseTo(-r.legs[i].knee.x);
      expect(l.legs[i].knee.y).toBeCloseTo(r.legs[i].knee.y);
    }
    expect(l.bob).toBeCloseTo(r.bob);
  });

  it('胴の上下動は小さく(0..0.03)、立ち止まった位置で変わらない', () => {
    for (let x = 0; x < 2; x += 0.07) {
      const b = walkerPose(x, 1).bob;
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(0.03 + 1e-9);
    }
  });

  it('既定(脚が健在)は従来どおり', () => {
    expect(walkerPose(5.67, -1, false)).toEqual(walkerPose(5.67, -1));
  });
});

describe('walkerPose の脚破壊(よろけ歩行、2.19)', () => {
  it('胴は常に沈み、1 周期に 1 回大きく倒れ込む', () => {
    let min = Infinity;
    let max = -Infinity;
    for (let x = 0; x < WALKER_STRIDE; x += WALKER_STRIDE / 40) {
      const b = walkerPose(x, 1, true).bob;
      min = Math.min(min, b);
      max = Math.max(max, b);
    }
    expect(min).toBeGreaterThanOrEqual(WALKER_LIMP_SINK - 1e-9);
    expect(max).toBeCloseTo(WALKER_LIMP_SINK + WALKER_LIMP_LURCH, 2);
    // 健在時の上下動(最大 0.03)より明らかに大きい
    expect(min).toBeGreaterThan(0.03);
  });

  it('奥の脚は後ろへ引きずられて床に着いたまま、手前の脚は半分の振り幅で踏み出す', () => {
    for (let x = 0; x < WALKER_STRIDE; x += WALKER_STRIDE / 16) {
      const pose = walkerPose(x, 1, true);
      expect(pose.legs[0].foot.x).toBeLessThan(0);
      expect(pose.legs[0].foot.y).toBeCloseTo(WALKER_HIP_TO_GROUND);
      expect(Math.abs(pose.legs[1].foot.x)).toBeLessThanOrEqual(WALKER_SWING / 2 + 1e-9);
    }
    expect(walkerPose(1, 1, true).legs[0].foot).toEqual(walkerPose(2, 1, true).legs[0].foot);
  });

  it('左向きは右向きの鏡像で、決定論', () => {
    const r = walkerPose(3.21, 1, true);
    const l = walkerPose(-3.21, -1, true);
    for (let i = 0; i < 2; i++) {
      expect(l.legs[i].foot.x).toBeCloseTo(-r.legs[i].foot.x);
      expect(l.legs[i].knee.x).toBeCloseTo(-r.legs[i].knee.x);
    }
    expect(walkerPose(3.21, 1, true)).toEqual(r);
  });
});

describe('flyerPose(飛行ドローンのポーズ)', () => {
  it('同じ入力なら同じポーズ(決定論)', () => {
    expect(flyerPose(3.3, 1.2, 1.5, 0.2, false, 4, 1)).toEqual(flyerPose(3.3, 1.2, 1.5, 0.2, false, 4, 1));
  });

  it('ローターの羽根は 0..1 で、2 枚は 90° ずれる', () => {
    for (let t = 0; t < 1; t += 0.013) {
      const p = flyerPose(t, 0.4, 0, 0, false, 0, 0);
      expect(p.rotorA).toBeGreaterThanOrEqual(0);
      expect(p.rotorA).toBeLessThanOrEqual(1);
      expect(p.rotorA * p.rotorA + p.rotorB * p.rotorB).toBeCloseTo(1);
    }
  });

  it('航行灯は時刻から点滅し、点灯の割合はおよそ NAV_DUTY', () => {
    let on = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) if (flyerPose(i / (n * NAV_HZ) * 8, 0, 0, 0, false, 0, 0).navOn) on++;
    expect(on / n).toBeCloseTo(NAV_DUTY, 1);
  });

  it('個体の位相で航行灯の点滅がずれる', () => {
    let differ = 0;
    for (let i = 0; i < 200; i++) {
      const t = i * 0.01;
      if (flyerPose(t, 0, 0, 0, false, 0, 0).navOn !== flyerPose(t, Math.PI, 0, 0, false, 0, 0).navOn) differ++;
    }
    expect(differ).toBeGreaterThan(0);
  });

  it('追尾中のセンサーアイはプレイヤーを向く', () => {
    const p = flyerPose(0, 0, 1, 1, true, -3, 4);
    expect(p.eyeX).toBeCloseTo(-0.6);
    expect(p.eyeY).toBeCloseTo(0.8);
  });

  it('巡回中のアイは進行方向の斜め下、止まっていれば真下', () => {
    const r = flyerPose(0, 0, FLYER_PATROL_SPEED, 0, false, -3, 4);
    expect(r.eyeX).toBeGreaterThan(0);
    expect(r.eyeY).toBeGreaterThan(0);
    const l = flyerPose(0, 0, -FLYER_PATROL_SPEED, 0, false, 3, 4);
    expect(l.eyeX).toBeLessThan(0);
    const s = flyerPose(0, 0, 0, 0, false, 3, 4);
    expect(s).toMatchObject({ eyeX: 0, eyeY: 1 });
  });

  it('スラスターは速度と逆向きに焚き、止まっていれば焚かない', () => {
    const p = flyerPose(0.5, 0, FLYER_CHASE_SPEED, 0, true, 5, 0);
    expect(p.thrust).toBeGreaterThan(0.7);
    expect(p.thrust).toBeLessThanOrEqual(1);
    expect(p.thrustX).toBeCloseTo(-1);
    expect(p.thrustY).toBeCloseTo(0);
    expect(flyerPose(0.5, 0, 0, 0, false, 5, 0).thrust).toBe(0);
  });

  it('速いほどスラスターが強い(同じ時刻・位相)', () => {
    const slow = flyerPose(0.7, 1, FLYER_PATROL_SPEED, 0, false, 0, 0).thrust;
    const fast = flyerPose(0.7, 1, FLYER_CHASE_SPEED, 0, true, 0, 0).thrust;
    expect(fast).toBeGreaterThan(slow);
  });
});

describe('turretPose(固定砲台のポーズ)', () => {
  it('狙えていなければ警告 0・暗い灯・後退なし', () => {
    expect(turretPose(0.1, false, 1)).toEqual({ warn: 0, lightColor: '#5a3a24', halo: false, recoil: 0 });
    expect(turretPose(TURRET_FIRE_INTERVAL, false, 1).recoil).toBe(0);
  });

  it('発射まで遠いうちは警告 0 で錆色に灯る', () => {
    const p = turretPose(TURRET_WARN_WINDOW + 0.2, true, 1);
    expect(p.warn).toBe(0);
    expect(p.lightColor).toBe('#9a6d32');
  });

  it('警告は発射が近づくほど強まる(単調)', () => {
    let prev = -1;
    for (let c = TURRET_WARN_WINDOW; c >= 0; c -= 0.02) {
      const w = turretPose(c, true, 0).warn;
      expect(w).toBeGreaterThanOrEqual(prev);
      prev = w;
    }
    expect(turretPose(0, true, 0).warn).toBe(1);
  });

  it('発射直前は白く灯り続けて暈が出る', () => {
    for (let t = 0; t < 1; t += 0.05) {
      const p = turretPose(0.05, true, t);
      expect(p.lightColor).toBe('#c7d0ce');
      expect(p.halo).toBe(true);
    }
  });

  it('警告中は時刻で点滅する(金と錆が両方出る)', () => {
    const colors = new Set<string>();
    for (let t = 0; t < 1; t += 0.01) colors.add(turretPose(TURRET_WARN_WINDOW * 0.6, true, t).lightColor);
    expect(colors.has('#caa64a')).toBe(true);
    expect(colors.has('#5a3a24')).toBe(true);
  });

  it('灯の色はパレット実在色だけ', () => {
    for (let c = 0; c <= TURRET_FIRE_INTERVAL; c += 0.05) {
      for (const a of [true, false]) {
        expect(PALETTE_LIGHTS).toContain(turretPose(c, a, c * 7.3).lightColor);
      }
    }
  });

  it('発射直後に砲身が後退し、TURRET_RECOIL_TIME で戻る', () => {
    expect(turretPose(TURRET_FIRE_INTERVAL, true, 0).recoil).toBeCloseTo(1);
    expect(turretPose(TURRET_FIRE_INTERVAL - TURRET_RECOIL_TIME / 2, true, 0).recoil).toBeCloseTo(0.5);
    expect(turretPose(TURRET_FIRE_INTERVAL - TURRET_RECOIL_TIME, true, 0).recoil).toBe(0);
    expect(turretPose(0.3, true, 0).recoil).toBe(0);
  });
});
