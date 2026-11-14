import { LANDING_REACH, SHAFT_WIDTH } from '../world/elevator';
import type { Platform } from './platform';

/**
 * 昇降機の足場(設計 2026-11-10-infrastructure §1)。位置はシャフトの定義と入力の履歴だけで決まる(乱数なし)。
 * 状態の遷移は純粋関数にし、乗り手の運搬は entities/platform の carryRider で行う(main が結線する)。
 *
 * 操作の裁定:
 * - 足場に立って ↑ で 1 つ上の停止階へ、↓ で 1 つ下の停止階へ動き出し、そこで止まる。動いている間の逆入力は折り返す。
 *   押し続けると到着の次のステップで次の停止階へ動き続ける(停止階が 2 つの通常の昇降機では端で止まるだけ)。
 * - 呼び戻し(設計書にない追加。詰まないための裁定): 足場が別の停止階にいて止まっているとき、
 *   プレイヤーが停止階(乗り場かシャフトの底)に立つと足場がその階へ来る。ボタンは足さない。
 * - 上昇中に乗り手の頭が天井に当たる(挟まる)ステップでは足場を動かさない(目標は保持し、
 *   乗り手が動いて挟まりが解ければ続きを動く)。下降で乗り手が段に引っかかったときは置いていく。
 * - 大昇降機(設計 2026-11-12-mega-structures、world/grandShaft)も同じ仕組みを使う。停止階の列(stops)・
 *   幅(width)・呼び戻しの X 範囲(landX0/landX1)を持つシャフトとして扱い、持たない通常の昇降機は
 *   上下 2 つの停止階・幅 SHAFT_WIDTH・乗り場 LANDING_REACH の既定で読む。
 */

/** 足場の速さ(タイル/秒) */
export const ELEVATOR_SPEED = 5;

/** 足場が動くシャフト(通常の昇降機 ElevatorShaft と大昇降機 GrandShaft の共通部分) */
export interface LiftShaft {
  id: string;
  /** 内側の左端列(足場の左端) */
  x0: number;
  /** 上の停止階の床の行 */
  yTop: number;
  /** 下の停止階の床の行(シャフトの底) */
  yBottom: number;
  /** 内側の幅(既定 SHAFT_WIDTH) */
  width?: number;
  /** 停止階の行(上から下へ昇順。既定 [yTop, yBottom]) */
  stops?: readonly number[];
  /** 呼び戻しの X 範囲 [landX0, landX1](既定は壁の外 LANDING_REACH 列まで) */
  landX0?: number;
  landX1?: number;
}

/** 内側の幅(= 足場の幅) */
export function liftWidth(s: LiftShaft): number {
  return s.width ?? SHAFT_WIDTH;
}

/** 停止階の行(上から下へ昇順) */
export function liftStops(s: LiftShaft): readonly number[] {
  return s.stops ?? [s.yTop, s.yBottom];
}

export interface ElevatorState {
  shaft: LiftShaft;
  /** 足場の上面の Y */
  top: number;
  /** 向かっている停止階の床の行(止まっていれば null) */
  target: number | null;
}

/** セッションで初めて出会ったときの状態: 下の停止階で止まっている */
export function initialElevator(shaft: LiftShaft): ElevatorState {
  return { shaft, top: shaft.yBottom, target: null };
}

/** 足場の上面(運ぶ物理の Platform) */
export function elevatorPlatform(e: ElevatorState): Platform {
  return { id: e.shaft.id, x: e.shaft.x0, y: e.top, w: liftWidth(e.shaft) };
}

/**
 * 呼び戻しの判定: 足元 feet(体の下端の Y)が停止階の床面にあり、中心 cx が乗り場〜シャフトの横の範囲にあれば
 * その停止階の行、なければ null。接地しているかは呼び出し側が見る
 */
export function elevatorCallStop(s: LiftShaft, cx: number, feet: number): number | null {
  const w = liftWidth(s);
  const x0 = s.landX0 ?? s.x0 - 1 - LANDING_REACH;
  const x1 = s.landX1 ?? s.x0 + w + 1 + LANDING_REACH;
  if (cx < x0 || cx > x1) return null;
  for (const stop of liftStops(s)) {
    if (Math.abs(feet - stop) < 0.2) return stop;
  }
  return null;
}

/** top より上(行が小さい)で最も近い停止階。無ければ null */
function stopAbove(s: LiftShaft, top: number): number | null {
  let best: number | null = null;
  for (const st of liftStops(s)) if (st < top && (best === null || st > best)) best = st;
  return best;
}

/** top より下(行が大きい)で最も近い停止階。無ければ null */
function stopBelow(s: LiftShaft, top: number): number | null {
  let best: number | null = null;
  for (const st of liftStops(s)) if (st > top && (best === null || st < best)) best = st;
  return best;
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
    if (c.up && !c.down) return stopAbove(s, e.top) ?? e.target;
    if (c.down && !c.up) return stopBelow(s, e.top) ?? e.target;
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
