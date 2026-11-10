import { LANDING_REACH, SHAFT_WIDTH, type ElevatorShaft } from '../world/elevator';
import type { Platform } from './platform';

/**
 * 昇降機の足場(設計 2026-11-10-infrastructure §1)。位置はシャフトの定義と入力の履歴だけで決まる(乱数なし)。
 * 状態の遷移は純粋関数にし、乗り手の運搬は entities/platform の carryRider で行う(main が結線する)。
 *
 * 操作の裁定:
 * - 足場に立って ↑ で上の停止階へ、↓ で下の停止階へ動き出し、端で止まる。動いている間の逆入力は折り返す。
 * - 呼び戻し(設計書にない追加。詰まないための裁定): 足場が別の停止階にいて止まっているとき、
 *   プレイヤーが停止階(乗り場かシャフトの底)に立つと足場がその階へ来る。ボタンは足さない。
 * - 上昇中に乗り手の頭が天井に当たる(挟まる)ステップでは足場を動かさない(目標は保持し、
 *   乗り手が動いて挟まりが解ければ続きを動く)。下降で乗り手が段に引っかかったときは置いていく。
 */

/** 足場の速さ(タイル/秒) */
export const ELEVATOR_SPEED = 5;

export interface ElevatorState {
  shaft: ElevatorShaft;
  /** 足場の上面の Y */
  top: number;
  /** 向かっている停止階の床の行(止まっていれば null) */
  target: number | null;
}

/** セッションで初めて出会ったときの状態: 下の停止階で止まっている */
export function initialElevator(shaft: ElevatorShaft): ElevatorState {
  return { shaft, top: shaft.yBottom, target: null };
}

/** 足場の上面(運ぶ物理の Platform) */
export function elevatorPlatform(e: ElevatorState): Platform {
  return { id: e.shaft.id, x: e.shaft.x0, y: e.top, w: SHAFT_WIDTH };
}

/**
 * 呼び戻しの判定: 足元 feet(体の下端の Y)が停止階の床面にあり、中心 cx が乗り場〜シャフトの横の範囲にあれば
 * その停止階の行、なければ null。接地しているかは呼び出し側が見る
 */
export function elevatorCallStop(s: ElevatorShaft, cx: number, feet: number): number | null {
  if (cx < s.x0 - 1 - LANDING_REACH || cx > s.x0 + SHAFT_WIDTH + 1 + LANDING_REACH) return null;
  for (const stop of [s.yTop, s.yBottom]) {
    if (Math.abs(feet - stop) < 0.2) return stop;
  }
  return null;
}

export interface ElevatorControl {
  /** プレイヤーが足場の上に立っている */
  riding: boolean;
  up: boolean;
  down: boolean;
  /** 呼び戻しの停止階(elevatorCallStop。乗っていないときだけ渡す) */
  callStop: number | null;
}

/** 入力から次の目標を決める(乗っていれば ↑↓、乗っていなければ呼び戻し) */
export function commandElevator(e: ElevatorState, c: ElevatorControl): number | null {
  const s = e.shaft;
  if (c.riding) {
    if (c.up && !c.down && e.top > s.yTop) return s.yTop;
    if (c.down && !c.up && e.top < s.yBottom) return s.yBottom;
    return e.target;
  }
  if (e.target === null && c.callStop !== null && e.top !== c.callStop) return c.callStop;
  return e.target;
}

/**
 * 1 ステップの移動: 次の上面の Y と到着したか。到着のときは上面を目標の行ちょうどに置く
 * (浮動小数の誤差で停止階の床面とずれないように)
 */
export function advanceElevator(e: ElevatorState, dt: number): { top: number; arrived: boolean } {
  if (e.target === null) return { top: e.top, arrived: false };
  const d = e.target - e.top;
  const m = ELEVATOR_SPEED * dt;
  if (Math.abs(d) <= m) return { top: e.target, arrived: true };
  return { top: e.top + Math.sign(d) * m, arrived: false };
}
