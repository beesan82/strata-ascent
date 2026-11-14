import { describe, expect, it } from 'vitest';
import {
  advanceElevator,
  commandElevator,
  elevatorCallStop,
  elevatorPlatform,
  ELEVATOR_SPEED,
  initialElevator,
  liftStops,
  liftWidth,
  type ElevatorState,
  type LiftShaft,
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

describe('大昇降機の足場(停止階の列・設計 2026-11-12-mega-structures)', () => {
  // 上端 100、途中駅 300(板の上面)と 340(板の直下)、下端 520。幅 6、乗り場は左 8 列・右は梯子列 120 まで
  const GRAND: LiftShaft = {
    id: 'g:0,0', x0: 100, yTop: 100, yBottom: 520, width: 6, stops: [100, 300, 340, 520], landX0: 91, landX1: 121,
  };
  const g = (top: number, target: number | null = null): ElevatorState => ({ shaft: GRAND, top, target });

  it('初めは最下端で止まり、足場の幅はシャフトの内側の幅', () => {
    const e = initialElevator(GRAND);
    expect(e.top).toBe(520);
    expect(liftWidth(GRAND)).toBe(6);
    expect(liftStops(GRAND)).toEqual([100, 300, 340, 520]);
    expect(elevatorPlatform(e)).toEqual({ id: 'g:0,0', x: 100, y: 520, w: 6 });
  });

  it('↑↓ は 1 つ隣の停止階へ。途中では最寄りの停止階へ折り返す', () => {
    expect(commandElevator(g(520), { ...NONE, riding: true, up: true })).toBe(340);
    expect(commandElevator(g(340), { ...NONE, riding: true, up: true })).toBe(300);
    expect(commandElevator(g(300), { ...NONE, riding: true, up: true })).toBe(100);
    expect(commandElevator(g(100), { ...NONE, riding: true, up: true })).toBeNull();
    expect(commandElevator(g(300), { ...NONE, riding: true, down: true })).toBe(340);
    // 300 → 100 へ上昇中(200)に ↓ で 300 へ、↑ のままなら目標は 100 のまま
    expect(commandElevator(g(200, 100), { ...NONE, riding: true, down: true })).toBe(300);
    expect(commandElevator(g(200, 100), { ...NONE, riding: true, up: true })).toBe(100);
    expect(commandElevator(g(200, 100), { ...NONE, riding: true })).toBe(100);
  });

  it('↑ を押し続けると、到着の次のステップで次の停止階へ動き続ける', () => {
    const dt = 1 / 60;
    let e = g(520);
    const visited: number[] = [];
    for (let i = 0; i < 60 * 120; i++) {
      e = { ...e, target: commandElevator(e, { ...NONE, riding: true, up: true }) };
      const r = advanceElevator(e, dt);
      e = { ...e, top: r.top, target: r.arrived ? null : e.target };
      if (r.arrived) visited.push(r.top);
      if (e.top === 100 && e.target === null) break;
    }
    expect(visited).toEqual([340, 300, 100]);
    // 420 タイルを 5 タイル/秒で約 84 秒
  });

  it('呼び戻しは途中駅でも効き、範囲は landX0〜landX1', () => {
    expect(elevatorCallStop(GRAND, 95, 300)).toBe(300);
    expect(elevatorCallStop(GRAND, 120.5, 340.1)).toBe(340);
    expect(elevatorCallStop(GRAND, 90.5, 300)).toBeNull();
    expect(elevatorCallStop(GRAND, 121.5, 300)).toBeNull();
    expect(elevatorCallStop(GRAND, 103, 320)).toBeNull();
    expect(commandElevator(g(520), { ...NONE, callStop: 300 })).toBe(300);
    expect(commandElevator(g(400, 520), { ...NONE, callStop: 300 })).toBe(520);
  });
});
