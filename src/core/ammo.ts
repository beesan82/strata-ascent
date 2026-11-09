import { addCarry, initialCarry, removeCarry, type CarryState } from './carry';

/**
 * 弾薬(設計書 2026-11-09-ammo-armory-design §1)。
 * 両武器とも弾薬アイテム制で、弾薬は携行(CarryState)の種別 shell / pulsecell として
 * 素材と枠を共有する。ここは消費と装填の純粋な遷移だけを置き、武器の状態機械
 * (Graviton の溜め、PulseGun の連射間隔)と発射の判定は呼び出し側(main)が結ぶ。
 *
 * - 重粒子砲: 1 発ごとに携行の shell を 1 個消費する。自動回復は無い。
 * - パルス: 装填中の残発数 loaded から 1 発ずつ減らし、尽きたら携行の pulsecell を
 *   1 個装填して(枠が 1 個空く)そのまま撃つ。どちらも無ければ撃てない。
 */

/** パルス弾セル 1 個の発数 */
export const PULSE_SHOTS_PER_CELL = 20;
/** 開始時に携行しているパルス弾セルの個数(砲弾はゼロから現地調達) */
export const INITIAL_PULSE_CELLS = 2;

/** 開始時の携行: パルス弾セル INITIAL_PULSE_CELLS 個だけ */
export function initialAmmoCarry(): CarryState {
  let s = initialCarry();
  for (let i = 0; i < INITIAL_PULSE_CELLS; i++) s = addCarry(s, 'pulsecell');
  return s;
}

/** パルスの残弾総数(装填中 + 携行セル × 20)。箱画面の表示用 */
export function pulseShotsTotal(loaded: number, carry: CarryState): number {
  return loaded + carry.carried.pulsecell * PULSE_SHOTS_PER_CELL;
}

/** パルスを 1 発撃てるか(装填中があるか、装填できるセルがあるか) */
export function canFirePulse(loaded: number, carry: CarryState): boolean {
  return loaded > 0 || carry.carried.pulsecell > 0;
}

export interface PulseFireResult {
  loaded: number;
  carry: CarryState;
  /** 1 発撃てたか(false のときは loaded / carry とも元のまま) */
  fired: boolean;
  /** この 1 発でセルを新しく装填したか(装填の合図用) */
  reloaded: boolean;
}

/**
 * パルスの 1 発消費。装填中があればそれを減らす。無ければ携行の pulsecell を 1 個装填し、
 * 装填と同時に 1 発消費する(loaded は 20 − 1 = 19 になる)。どちらも無ければ撃てない。
 */
export function firePulse(loaded: number, carry: CarryState): PulseFireResult {
  if (loaded > 0) return { loaded: loaded - 1, carry, fired: true, reloaded: false };
  if (carry.carried.pulsecell <= 0) return { loaded, carry, fired: false, reloaded: false };
  return {
    loaded: PULSE_SHOTS_PER_CELL - 1,
    carry: removeCarry(carry, 'pulsecell'),
    fired: true,
    reloaded: true,
  };
}

/** 重粒子砲を 1 発撃てるか(携行の砲弾が 1 個以上あるか) */
export function canFireCannon(carry: CarryState): boolean {
  return carry.carried.shell > 0;
}

/** 重粒子砲の 1 発消費。砲弾が無ければ同じ state を返す(呼び出し側は canFireCannon で先に止める) */
export function fireCannon(carry: CarryState): CarryState {
  return removeCarry(carry, 'shell');
}
