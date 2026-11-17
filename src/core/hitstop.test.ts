import { describe, expect, it } from 'vitest';
import {
  drainHitStop, hitStopMsFor, requestHitStop, runFixedSteps, HITSTOP_BOSS_PART_MS, HITSTOP_PART_MS,
} from './hitstop';

const STEP = 1000 / 60;

describe('ヒットストップの長さ(2.22、設計 2026-11-17-parts-overhaul §2)', () => {
  it('通常敵の部位は 70 ミリ秒、ボスの脚は 100 ミリ秒', () => {
    expect(HITSTOP_PART_MS).toBe(70);
    expect(HITSTOP_BOSS_PART_MS).toBe(100);
    expect(hitStopMsFor('walker')).toBe(70);
    expect(hitStopMsFor('flyer')).toBe(70);
    expect(hitStopMsFor('turret')).toBe(70);
    expect(hitStopMsFor('boss')).toBe(100);
  });
});

describe('requestHitStop', () => {
  it('止まっていなければ要求した長さになる', () => {
    expect(requestHitStop(0, 70)).toBe(70);
  });

  it('止まっている最中は積み上げず、長いほうを残す', () => {
    expect(requestHitStop(40, 70)).toBe(70);
    expect(requestHitStop(90, 70)).toBe(90);
    expect(requestHitStop(70, 70)).toBe(70);
  });

  it('要求 0 は何も変えず、負にはならない', () => {
    expect(requestHitStop(30, 0)).toBe(30);
    expect(requestHitStop(0, 0)).toBe(0);
    expect(requestHitStop(-5, 0)).toBe(0);
  });
});

describe('drainHitStop', () => {
  it('止める時間が無ければ蓄積はそのまま', () => {
    expect(drainHitStop(33, 0)).toEqual({ accMs: 33, stopMs: 0 });
  });

  it('蓄積から止める時間を先に払う(払ったぶんは捨てる)', () => {
    expect(drainHitStop(100, 70)).toEqual({ accMs: 30, stopMs: 0 });
    expect(drainHitStop(20, 70)).toEqual({ accMs: 0, stopMs: 50 });
  });

  it('蓄積が無ければ止める時間は減らない', () => {
    expect(drainHitStop(0, 70)).toEqual({ accMs: 0, stopMs: 70 });
  });
});

describe('runFixedSteps(固定ステップの消化)', () => {
  it('ヒットストップが無ければ従来どおり、蓄積を STEP ずつ払う', () => {
    let n = 0;
    const r = runFixedSteps(STEP * 3 + 1, 0, STEP, () => { n++; return 0; });
    expect(n).toBe(3);
    expect(r.steps).toBe(3);
    expect(r.accMs).toBeCloseTo(1, 9);
    expect(r.stopMs).toBe(0);
  });

  it('蓄積が 1 ステップに満たなければ何もしない', () => {
    const r = runFixedSteps(STEP / 2, 0, STEP, () => { throw new Error('呼ばれないはず'); });
    expect(r).toEqual({ accMs: STEP / 2, stopMs: 0, steps: 0 });
  });

  it('止まっている間は update を呼ばず、時間だけが過ぎる', () => {
    let n = 0;
    const r = runFixedSteps(50, 70, STEP, () => { n++; return 0; });
    expect(n).toBe(0);
    expect(r.accMs).toBe(0);
    expect(r.stopMs).toBe(20);
  });

  it('update の中で要求された停止は、同じフレームの残りのステップから効く', () => {
    let n = 0;
    // 3 ステップぶんの蓄積。1 ステップ目で 70 ms を要求 → 残り 2 ステップぶん(約 33 ms)は停止に払われる
    const r = runFixedSteps(STEP * 3, 0, STEP, () => { n++; return n === 1 ? 70 : 0; });
    expect(n).toBe(1);
    expect(r.accMs).toBeCloseTo(0, 9);
    expect(r.stopMs).toBeCloseTo(70 - STEP * 2, 9);
  });

  it('60 Hz で回すと、停止の長さぶんだけシミュレーション時間が実時間より遅れる(描画フレームは毎回来る)', () => {
    for (const ms of [HITSTOP_PART_MS, HITSTOP_BOSS_PART_MS]) {
      let acc = 0;
      let stop = 0;
      let sim = 0;
      let renders = 0;
      const frames = 120;
      for (let f = 0; f < frames; f++) {
        acc += STEP;
        const fired = f === 10;
        const r = runFixedSteps(acc, stop, STEP, () => {
          sim += STEP;
          return fired ? ms : 0;
        });
        acc = r.accMs;
        stop = r.stopMs;
        renders++; // 描画は止めない
      }
      expect(renders).toBe(frames);
      expect(stop).toBe(0);
      // 実時間 − シミュレーション時間 − 未消化の蓄積 = 止めた時間
      expect(frames * STEP - sim - acc).toBeCloseTo(ms, 6);
    }
  });

  it('止まっている最中に次の停止が来ても積み上がらない', () => {
    let acc = 0;
    let stop = 0;
    let sim = 0;
    let calls = 0;
    for (let f = 0; f < 60; f++) {
      acc += STEP;
      const r = runFixedSteps(acc, stop, STEP, () => {
        sim += STEP;
        calls++;
        return calls <= 2 ? 70 : 0; // 最初の 2 回の update がどちらも要求する
      });
      acc = r.accMs;
      stop = r.stopMs;
    }
    // 1 回目の 70 ms が明けた直後の update がもう一度 70 ms を要求する → 合計 140 ms(同時なら 70 のまま)
    expect(60 * STEP - sim - acc).toBeCloseTo(140, 6);
  });
});
