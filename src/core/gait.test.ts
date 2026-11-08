import { describe, expect, it } from 'vitest';
import {
  FOOT_LIFT_TILES,
  STANCE_FRACTION,
  WALK_STRIDE_TILES,
  footCyclePosition,
  gaitBodyOffset,
  gaitFoot,
  stepFraction,
  walkPhaseAdvance,
} from './gait';

describe('walkPhaseAdvance(位相と歩幅の関係)', () => {
  it('歩幅 1 タイルの移動で位相が π 進む', () => {
    expect(WALK_STRIDE_TILES).toBe(1.0);
    expect(walkPhaseAdvance(0)).toBe(0);
    expect(walkPhaseAdvance(WALK_STRIDE_TILES)).toBeCloseTo(Math.PI);
    expect(walkPhaseAdvance(2 * WALK_STRIDE_TILES)).toBeCloseTo(2 * Math.PI);
    expect(walkPhaseAdvance(0.5 * WALK_STRIDE_TILES)).toBeCloseTo(Math.PI / 2);
  });
});

describe('gaitFoot(歩容プロファイル)', () => {
  it('着地の瞬間(u=0)は足が最前方で接地している', () => {
    const foot = gaitFoot(0);
    expect(foot.lift).toBe(0);
    expect(foot.forward).toBeCloseTo(STANCE_FRACTION * WALK_STRIDE_TILES);
  });

  it('接地期は足が持ち上がらず、地面に対して静止する(足裏が滑らない)', () => {
    for (const u of [0, 0.1, 0.27, 0.54]) {
      expect(gaitFoot(u).lift).toBe(0);
    }
    // 接地期に体が進む距離と、足が体に対して後方へ流れる距離が一致する = 対地速度 0
    const u1 = 0.1;
    const u2 = 0.3;
    const bodyAdvance = 2 * WALK_STRIDE_TILES * (u2 - u1);
    const footDrift = gaitFoot(u2).forward - gaitFoot(u1).forward;
    expect(bodyAdvance + footDrift).toBeCloseTo(0);
  });

  it('接地期の終わりで足は最後方に来て、遊脚へ連続につながる', () => {
    const foot = gaitFoot(STANCE_FRACTION);
    expect(foot.forward).toBeCloseTo(-STANCE_FRACTION * WALK_STRIDE_TILES);
    expect(foot.lift).toBeCloseTo(0);
  });

  it('遊脚期は足が持ち上がり、前方へ単調に戻る', () => {
    const start = STANCE_FRACTION;
    const mid = start + (1 - start) / 2;
    expect(gaitFoot(mid).lift).toBeCloseTo(FOOT_LIFT_TILES);
    let prev = -Infinity;
    for (let v = 0; v <= 1.001; v += 0.1) {
      const u = start + (1 - start) * Math.min(v, 1);
      const { forward } = gaitFoot(u >= 1 ? u - 1 : u);
      if (u < 1) {
        expect(forward).toBeGreaterThanOrEqual(prev);
        prev = forward;
      }
    }
    // 遊脚の終わり(次の着地)では最前方へ戻っている
    expect(gaitFoot(0.999).forward).toBeCloseTo(STANCE_FRACTION * WALK_STRIDE_TILES, 1);
  });

  it('周期は 1 で、負の入力も同じ周期に畳む', () => {
    expect(gaitFoot(1)).toEqual(gaitFoot(0));
    expect(gaitFoot(-0.25).forward).toBeCloseTo(gaitFoot(0.75).forward);
    expect(gaitFoot(-0.25).lift).toBeCloseTo(gaitFoot(0.75).lift);
  });

  it('どの位相でも、左右どちらかの足は必ず接地している(接地期 > 半周期のため)', () => {
    for (let phase = 0; phase < 2 * Math.PI; phase += 0.05) {
      const left = gaitFoot(footCyclePosition(phase, 0));
      const right = gaitFoot(footCyclePosition(phase, Math.PI));
      expect(Math.min(left.lift, right.lift)).toBe(0);
    }
  });
});

describe('着地と位相の関係(足音の π 跨ぎ規則との整合)', () => {
  it('π の倍数の位相で、その歩の足がちょうど着地する', () => {
    for (const k of [0, 1, 2, 3]) {
      const phase = k * Math.PI;
      const landingOffset = k % 2 === 0 ? 0 : Math.PI;
      const foot = gaitFoot(footCyclePosition(phase, landingOffset));
      expect(foot.lift).toBe(0);
      expect(footCyclePosition(phase, landingOffset)).toBeCloseTo(0);
    }
  });

  it('stepFraction は歩(位相 π)の中の位置を返す', () => {
    expect(stepFraction(0)).toBe(0);
    expect(stepFraction(Math.PI / 2)).toBeCloseTo(0.5);
    expect(stepFraction(Math.PI)).toBeCloseTo(0);
    expect(stepFraction((3 * Math.PI) / 2)).toBeCloseTo(0.5);
  });
});

describe('gaitBodyOffset(体の上下)', () => {
  it('着地の瞬間は沈み込みが最大、歩の中点では体が最も上がる', () => {
    expect(gaitBodyOffset(0)).toBeCloseTo(0.03);
    expect(gaitBodyOffset(0.5)).toBeCloseTo(-0.06);
    expect(gaitBodyOffset(0.15)).toBeLessThan(gaitBodyOffset(0));
    expect(gaitBodyOffset(0.15)).toBeGreaterThan(gaitBodyOffset(0.5));
  });
});
