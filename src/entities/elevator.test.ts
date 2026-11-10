import { describe, expect, it } from 'vitest';
import {
  advanceElevator,
  commandElevator,
  elevatorCallStop,
  elevatorPlatform,
  ELEVATOR_SPEED,
  initialElevator,
  type ElevatorState,
} from './elevator';
import { LANDING_REACH, SHAFT_WIDTH, type ElevatorShaft } from '../world/elevator';

const SHAFT: ElevatorShaft = { id: 'e:0,0', cell: 0, k: 0, x0: 100, yTop: 200, yBottom: 232, spacing: 8 };
const NONE = { riding: false, up: false, down: false, callStop: null };

function at(top: number, target: number | null = null): ElevatorState {
  return { shaft: SHAFT, top, target };
}

describe('昇降機の足場(状態遷移)', () => {
  it('初めは下の停止階で止まっていて、足場の上面はシャフトの内側の幅', () => {
    const e = initialElevator(SHAFT);
    expect(e.top).toBe(232);
    expect(e.target).toBeNull();
    expect(elevatorPlatform(e)).toEqual({ id: 'e:0,0', x: 100, y: 232, w: SHAFT_WIDTH });
  });

  it('乗って ↑ で上の停止階へ、↓ で下の停止階へ。端ではその向きに動かない', () => {
    expect(commandElevator(at(232), { ...NONE, riding: true, up: true })).toBe(200);
    expect(commandElevator(at(200), { ...NONE, riding: true, down: true })).toBe(232);
    expect(commandElevator(at(200), { ...NONE, riding: true, up: true })).toBeNull();
    expect(commandElevator(at(232), { ...NONE, riding: true, down: true })).toBeNull();
    // 動いている途中の逆入力は折り返し、入力が無ければ目標を保つ
    expect(commandElevator(at(216, 200), { ...NONE, riding: true, down: true })).toBe(232);
    expect(commandElevator(at(216, 200), { ...NONE, riding: true })).toBe(200);
    // ↑↓ 同時押しは無視
    expect(commandElevator(at(232), { ...NONE, riding: true, up: true, down: true })).toBeNull();
  });

  it('乗っていないときは ↑↓ に反応せず、止まっていれば呼び戻しの停止階へ向かう', () => {
    expect(commandElevator(at(232), { ...NONE, up: true })).toBeNull();
    expect(commandElevator(at(232), { ...NONE, callStop: 200 })).toBe(200);
    expect(commandElevator(at(232), { ...NONE, callStop: 232 })).toBeNull();
    // 動いている間は呼び戻しで目標を変えない
    expect(commandElevator(at(216, 232), { ...NONE, callStop: 200 })).toBe(232);
  });

  it('1 ステップに ELEVATOR_SPEED × dt だけ動き、到着のステップでは停止階の行ちょうどに置く', () => {
    const dt = 1 / 60;
    const s1 = advanceElevator(at(232, 200), dt);
    expect(s1.top).toBeCloseTo(232 - ELEVATOR_SPEED * dt, 9);
    expect(s1.arrived).toBe(false);
    let e = at(232, 200);
    let steps = 0;
    for (; steps < 1000; steps++) {
      const r = advanceElevator(e, dt);
      e = { ...e, top: r.top, target: r.arrived ? null : e.target };
      if (r.arrived) break;
    }
    expect(e.top).toBe(200);
    expect(e.target).toBeNull();
    // 32 タイルを 5 タイル/秒で約 6.4 秒(浮動小数の累積誤差で到着のステップが 1 つ前後し得る)
    expect(steps).toBeGreaterThanOrEqual(382);
    expect(steps).toBeLessThanOrEqual(385);
    expect(advanceElevator(at(200), dt)).toEqual({ top: 200, arrived: false });
  });

  it('呼び戻しの範囲は停止階の床面に立つ乗り場〜シャフトの横の範囲だけ', () => {
    expect(elevatorCallStop(SHAFT, 102, 232)).toBe(232);
    expect(elevatorCallStop(SHAFT, 102, 200.05)).toBe(200);
    expect(elevatorCallStop(SHAFT, 100 - 1 - LANDING_REACH, 232)).toBe(232);
    expect(elevatorCallStop(SHAFT, 100 - 2 - LANDING_REACH, 232)).toBeNull();
    expect(elevatorCallStop(SHAFT, 102, 216)).toBeNull();
  });
});
