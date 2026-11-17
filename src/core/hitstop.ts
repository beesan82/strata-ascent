import type { PartKind } from '../entities/parts';

/**
 * ヒットストップ(2.22、設計 2026-11-17-parts-overhaul §2)。部位が壊れた瞬間にシミュレーション時間だけを
 * 短く止める。描画は止めない(frame は毎回描き、固定ステップの update だけを見送る)。
 * main の固定ステップ(蓄積した実時間 acc を STEP_MS ずつ update へ払う)に合わせ、止める時間は
 * 「acc から先に差し引く残り時間」として持つ。止まっている間は simTime が進まないので、時刻から決まる
 * 演出(撃破エフェクト・点滅・シェイク)も同じ絵で止まる。純粋関数のみ(Math.random は使わない)。
 */

/** 通常敵の部位破壊で止める時間(ミリ秒) */
export const HITSTOP_PART_MS = 70;
/** ボスの脚の破壊で止める時間(ミリ秒) */
export const HITSTOP_BOSS_PART_MS = 100;

/** 部位破壊のヒットストップの長さ(ミリ秒) */
export function hitStopMsFor(kind: PartKind): number {
  return kind === 'boss' ? HITSTOP_BOSS_PART_MS : HITSTOP_PART_MS;
}

/**
 * ヒットストップを要求する。すでに止まっている最中なら足さず、長いほうを残す
 * (同じフレームに 2 つ壊れても止まる時間が積み上がらない)
 */
export function requestHitStop(remainingMs: number, ms: number): number {
  return Math.max(remainingMs, ms, 0);
}

/**
 * 蓄積した実時間 accMs から、止める時間 stopMs を先に払う。払ったぶんは update に回さない(捨てる)。
 * 返り値は払った後の両方の残り。stopMs が 0 なら何も変えない
 */
export function drainHitStop(accMs: number, stopMs: number): { accMs: number; stopMs: number } {
  if (stopMs <= 0 || accMs <= 0) return { accMs, stopMs: Math.max(0, stopMs) };
  const eaten = Math.min(accMs, stopMs);
  return { accMs: accMs - eaten, stopMs: stopMs - eaten };
}

/**
 * 固定ステップの消化(純粋関数)。蓄積 accMs を stepMs ずつ払い、1 ステップごとに step() を呼ぶ。
 * step() は「その update の中で新しく要求されたヒットストップ(ミリ秒、無ければ 0)」を返す。
 * 各ステップの前に止める時間を先に払うので、update の途中で要求された停止は次のステップから効く。
 * 返り値は残りの蓄積・残りの停止時間・実行したステップ数
 */
export function runFixedSteps(
  accMs: number,
  stopMs: number,
  stepMs: number,
  step: () => number,
): { accMs: number; stopMs: number; steps: number } {
  let acc = accMs;
  let stop = stopMs;
  let steps = 0;
  for (;;) {
    const d = drainHitStop(acc, stop);
    acc = d.accMs;
    stop = d.stopMs;
    if (acc < stepMs) break;
    stop = requestHitStop(stop, step());
    acc -= stepMs;
    steps++;
  }
  return { accMs: acc, stopMs: stop, steps };
}
