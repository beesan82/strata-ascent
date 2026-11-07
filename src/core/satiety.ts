/**
 * 満腹度(サバイバル要素 段階 1、設計書 2026-11-07-survival-design §4)。
 * 状態メーターはこの 1 本だけに統合する(空腹・寒さ・疲労を分けない)。
 * 更新は純関数で、消耗は線形・自動摂取と飢餓ダメージは閾値イベントとして返すため、
 * dt の刻み方で結果が変わらない。
 */

import type { BiomeId } from '../world/biomeCells';

/**
 * 地区ごとの満腹度消耗倍率(段階 2 で有効化、設計 §4 の地区表)。
 * 地区の読み(守られた生活空間では少なく、生体異物区が最も身体に悪い)を数値にしたもの。
 */
export const SATIETY_BIOME_MUL: Record<BiomeId, number> = {
  coldSteel: 1.0,
  habitation: 0.85,
  disposal: 1.05,
  waterVoid: 1.15,
  power: 1.0,
  foundry: 1.1,
  biomech: 1.25,
};

export function satietyBiomeMulFor(biomeId: BiomeId): number {
  return SATIETY_BIOME_MUL[biomeId];
}

export const SATIETY_MAX = 100;
/** 基礎消耗(満腹度/秒)。標準地区で約 12 分で 0 になる速度。調整はこの 1 定数で */
export const SATIETY_DRAIN_PER_SEC = 100 / 720;
/** 静止中の活動倍率(眺望や景色を見る時間を過度に罰しないための差) */
export const STILL_ACTIVITY_MUL = 0.7;
/** 糧食の所持上限 */
export const MAX_RATIONS = 2;
/** 自動摂取が発動する満腹度(以下) */
export const AUTO_EAT_THRESHOLD = 20;
/** 糧食 1 個の回復量 */
export const RATION_RESTORE = 45;
/** 飢餓の猶予(秒)。0 になってからこの間は HP が減らない */
export const STARVE_GRACE_SEC = 30;
/** 飢餓ダメージの間隔(秒) */
export const STARVE_INTERVAL_SEC = 20;
/** 死亡時に戻る満腹度(全回復はしない) */
export const SATIETY_ON_DEATH = 35;
/** セッション開始時の所持糧食(最初の低下で仕組みを体験できるように 1 個持たせる) */
export const INITIAL_RATIONS = 1;

export type SatietyLevel = 'ok' | 'low' | 'critical' | 'starving';

export interface SatietyState {
  /** 0..SATIETY_MAX */
  value: number;
  /** 所持糧食(0..MAX_RATIONS) */
  rations: number;
  /** 満腹度 0 で経過した秒数(猶予とダメージ間隔の計測。0 でなくなれば 0 に戻る) */
  starveT: number;
}

export function initialSatiety(): SatietyState {
  return { value: SATIETY_MAX, rations: INITIAL_RATIONS, starveT: 0 };
}

export function satietyLevel(value: number): SatietyLevel {
  if (value <= 0) return 'starving';
  if (value <= AUTO_EAT_THRESHOLD) return 'critical';
  if (value <= 50) return 'low';
  return 'ok';
}

export interface SatietyStepInput {
  dt: number;
  /** 安全圏(休憩点の箱の中・スポーン保護範囲)では減らない */
  inSafeZone: boolean;
  /** 静止中は活動倍率 0.7 */
  still: boolean;
  /** 地区倍率(段階 2 で有効化。satietyBiomeMulFor で引いた値を渡す) */
  biomeMul?: number;
}

export interface SatietyStepResult {
  state: SatietyState;
  /** このステップで糧食を自動摂取したか */
  ateRation: boolean;
  /** 飢餓で減る HP。敵ダメージとは別経路(ノックバック・無敵なし)で適用すること */
  hpDamage: number;
}

export function stepSatiety(state: SatietyState, input: SatietyStepInput): SatietyStepResult {
  let value = state.value;
  let rations = state.rations;
  let starveT = state.starveT;
  let ateRation = false;

  // 消耗(安全圏では 0)。線形なので dt の分割で結果が変わらない
  if (!input.inSafeZone && value > 0) {
    const activity = input.still ? STILL_ACTIVITY_MUL : 1;
    value = Math.max(0, value - SATIETY_DRAIN_PER_SEC * (input.biomeMul ?? 1) * activity * input.dt);
  }

  // 自動摂取: 閾値以下なら所持糧食を 1 個だけ食べる(手動ボタンは作らない)。
  // 0 になった場合もまず摂取が優先し、糧食がある限り飢餓には入らない
  if (value <= AUTO_EAT_THRESHOLD && rations > 0) {
    rations -= 1;
    value = Math.min(SATIETY_MAX, value + RATION_RESTORE);
    ateRation = true;
  }

  // 飢餓: 猶予 30 秒の後、20 秒ごとに HP -1。閾値の跨ぎ回数で数えるため dt 分割に一致する
  let hpDamage = 0;
  if (value <= 0) {
    const prev = starveT;
    starveT += input.dt;
    for (
      let t = STARVE_GRACE_SEC;
      t <= starveT;
      t += STARVE_INTERVAL_SEC
    ) {
      if (t > prev) hpDamage++;
    }
  } else {
    starveT = 0;
  }

  return { state: { value, rations, starveT }, ateRation, hpDamage };
}

/**
 * 死亡時のリセット: 満腹度は 35 に戻す(全回復はしない)。
 * 糧食は保持せず 0 にする。所持糧食は遺留品として最後の安定接地点へ落ちる
 * (段階 3、設計 §8。段階 1 の「死亡時は糧食を保持する」裁定はここで置き換えた)。
 * 遺留品の出現そのものは main 側がこのリセットの前に行う。
 */
export function resetSatietyOnDeath(_state: SatietyState): SatietyState {
  return { value: SATIETY_ON_DEATH, rations: 0, starveT: 0 };
}
