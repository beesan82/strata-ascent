import { describe, expect, it } from 'vitest';
import {
  advanceElevator,
  commandElevator,
  elevatorCallStop,
  elevatorPlatform,
  ELEVATOR_SPEED,
  initialElevator,
  liftSpeed,
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

describe('足場の速さと初めの位置(2.20 原作準拠スケール)', () => {
  // 大昇降機と同じく speed 3・callSpeed 40 を持つシャフト(上端 0、途中駅 1000 / 1040、下端 3000)
  const LONG: LiftShaft = {
    id: 'g:1,0', x0: 100, yTop: 0, yBottom: 3000, width: 6, stops: [0, 1000, 1040, 3000], landX0: 91, landX1: 121,
    speed: 3, callSpeed: 40,
  };
  const l = (top: number, target: number | null = null): ElevatorState => ({ shaft: LONG, top, target });

  it('速さを持たない通常の昇降機は、乗っていてもいなくても ELEVATOR_SPEED(従来どおり)', () => {
    expect(liftSpeed(SHAFT, true)).toBe(ELEVATOR_SPEED);
    expect(liftSpeed(SHAFT, false)).toBe(ELEVATOR_SPEED);
    const dt = 1 / 60;
    expect(advanceElevator(at(232, 200), dt, false).top).toBeCloseTo(232 - ELEVATOR_SPEED * dt, 9);
    expect(advanceElevator(at(232, 200), dt, true).top).toBeCloseTo(232 - ELEVATOR_SPEED * dt, 9);
  });

  it('乗っているときはシャフトの speed、乗り手がいないときは callSpeed で動く', () => {
    expect(liftSpeed(LONG, true)).toBe(3);
    expect(liftSpeed(LONG, false)).toBe(40);
    const dt = 1 / 60;
    expect(advanceElevator(l(3000, 1040), dt).top).toBeCloseTo(3000 - 3 * dt, 9);
    expect(advanceElevator(l(3000, 1040), dt, true).top).toBeCloseTo(3000 - 3 * dt, 9);
    expect(advanceElevator(l(3000, 1040), dt, false).top).toBeCloseTo(3000 - 40 * dt, 9);
  });

  it('乗って下端から上端まで ↑ を押し続けると 3000 タイルを 3 タイル/秒で約 1000 秒(約 17 分)', () => {
    const dt = 1 / 60;
    let e = l(3000);
    let steps = 0;
    for (; steps < 60 * 1200; steps++) {
      e = { ...e, target: commandElevator(e, { ...NONE, riding: true, up: true }) };
      const r = advanceElevator(e, dt, true);
      e = { ...e, top: r.top, target: r.arrived ? null : e.target };
      if (e.top === 0 && e.target === null) break;
    }
    expect(e.top).toBe(0);
    // 停止階ごとに到着の 1 ステップ(と浮動小数の誤差)の分だけ前後する
    expect(steps / 60).toBeGreaterThan(995);
    expect(steps / 60).toBeLessThan(1005);
  });

  it('乗り手のいない呼び戻しは下端から上端まで 75 秒で来る', () => {
    const dt = 1 / 60;
    let e = l(3000);
    e = { ...e, target: commandElevator(e, { ...NONE, callStop: 0 }) };
    let steps = 0;
    for (; steps < 60 * 200; steps++) {
      const r = advanceElevator(e, dt, false);
      e = { ...e, top: r.top, target: r.arrived ? null : e.target };
      if (r.arrived) break;
    }
    expect(e.top).toBe(0);
    expect(steps / 60).toBeGreaterThan(74);
    expect(steps / 60).toBeLessThan(76);
  });

  it('初めの位置: 行を渡すと最寄りの停止階、渡さなければ下端(通常の昇降機は従来どおり)', () => {
    expect(initialElevator(SHAFT).top).toBe(232);
    expect(initialElevator(LONG).top).toBe(3000);
    expect(initialElevator(LONG, 10).top).toBe(0);
    expect(initialElevator(LONG, 1010).top).toBe(1000);
    expect(initialElevator(LONG, 1030).top).toBe(1040);
    expect(initialElevator(LONG, 2900).top).toBe(3000);
    expect(initialElevator(LONG, 1010).target).toBeNull();
  });
});
