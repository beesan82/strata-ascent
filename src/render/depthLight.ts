/**
 * 深さの明るさと懐中電灯モードの係数(設計 2026-11-09-steps-and-light §3、§4)。
 * Canvas に触らない純粋関数だけを置き、renderer と Lighting がこれを読む。
 */

/** 1 層ごとに環境光を下げる量 */
export const DEPTH_SHADE_PER_LAYER = 0.06;
/** 深さ係数の下限(最も深い層でも環境光をこれ以上は下げない) */
export const DEPTH_SHADE_MIN = 0.45;

/**
 * 層番号 → 環境光に掛ける係数。層 0 で 1.0、層番号が 1 増えるごとに DEPTH_SHADE_PER_LAYER ずつ下げ、
 * DEPTH_SHADE_MIN で止める。層番号が 0 未満でも 1.0 を超えない。
 * 地区(biome)ごとの明るさの個性はそのまま残し、この係数はその上に乗る
 */
export function depthShade(layer: number): number {
  const v = 1 - DEPTH_SHADE_PER_LAYER * Math.max(0, layer);
  return v < DEPTH_SHADE_MIN ? DEPTH_SHADE_MIN : v;
}

/** 懐中電灯モードでのコーン半径の倍率 */
export const FLASHLIGHT_RADIUS_MULT = 1.3;

export interface ConeParams {
  /** コーン半径の倍率(通常 1) */
  radiusMult: number;
  /** 暗幕を消す強さ: 中心(グラデーションの 0)と中間(0.7)の不透明度 */
  centerAlpha: number;
  midAlpha: number;
}

/**
 * 補助光のコーンの係数。boost は懐中電灯モードの強さ(0 = 通常、1 = 懐中電灯モード)。
 * 半径を最大 FLASHLIGHT_RADIUS_MULT 倍にし、中心と中間の明るさを上げる(新しい描画パスは足さない)
 */
export function coneParams(boost: number): ConeParams {
  const b = boost < 0 ? 0 : boost > 1 ? 1 : boost;
  return {
    radiusMult: 1 + (FLASHLIGHT_RADIUS_MULT - 1) * b,
    centerAlpha: 0.8 + 0.15 * b,
    midAlpha: 0.35 + 0.2 * b,
  };
}
