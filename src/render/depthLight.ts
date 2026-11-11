/**
 * 深さの明るさと懐中電灯モードの係数(設計 2026-11-09-steps-and-light §3、§4)、
 * 室内の暗さの係数(設計 2026-11-11-light-occlusion-ambient §2)、
 * 暗幕の濃さ(設計 2026-11-11-darkness-rework: 暗いのが既定、光は例外)。
 * Canvas に触らない純粋関数だけを置き、renderer と Lighting がこれを読む。
 */

/** 1 層ごとに環境光を下げる量(2.17 で 0.06 → 0.08) */
export const DEPTH_SHADE_PER_LAYER = 0.08;
/** 深さ係数の下限(最も深い層でも環境光をこれ以上は下げない。2.17 で 0.45 → 0.30) */
export const DEPTH_SHADE_MIN = 0.3;

/**
 * 層番号 → 環境光に掛ける係数。層 0 で 1.0、層番号が 1 増えるごとに DEPTH_SHADE_PER_LAYER ずつ下げ、
 * DEPTH_SHADE_MIN で止める。層番号が 0 未満でも 1.0 を超えない。
 * 地区(biome)ごとの明るさの個性はそのまま残し、この係数はその上に乗る
 */
export function depthShade(layer: number): number {
  const v = 1 - DEPTH_SHADE_PER_LAYER * Math.max(0, layer);
  return v < DEPTH_SHADE_MIN ? DEPTH_SHADE_MIN : v;
}

/**
 * 室内の暗さ(設計 2026-11-11-light-occlusion-ambient §2)。
 * 開放度(core/zoom.sampleOpenness をズーム用に 6 フレームおきに測り、時間平滑したもの)がこれ以上なら
 * 開けた場所として係数 1。2.17(設計 2026-11-11-darkness-rework §3)でズームの「閉塞・通路」の境
 * (OPENNESS_LO = 0.55)より手前の 0.7 から効かせる(通路程度の囲まれ方から暗くなり始める)
 */
export const ENCLOSURE_OPEN = 0.7;
/** 開放度がこれ以下なら最も囲まれている(囲まれ度 1) */
export const ENCLOSURE_CLOSED = 0.2;
/**
 * 囲まれ度 1 のときに環境光へ掛ける係数(暗さの下限。2.17 で 0.55 → 0.35)。
 * 暗幕の不透明度は CURTAIN_MAX で頭打ちになるので、真っ黒にはならない
 */
export const ENCLOSURE_SHADE_MIN = 0.35;

/**
 * 開放度(0..1) → 囲まれ度(0..1)。ENCLOSURE_OPEN 以上で 0、ENCLOSURE_CLOSED 以下で 1、間は線形。
 * 開放度の逆(開けているほど小さい)
 */
export function enclosure(openness: number): number {
  const t = (ENCLOSURE_OPEN - openness) / (ENCLOSURE_OPEN - ENCLOSURE_CLOSED);
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * 開放度 → 環境光に掛ける係数。開けた場所で 1、囲まれるほど下げ、ENCLOSURE_SHADE_MIN で止める。
 * depthShade と掛け合わせて使う(深さと囲まれ方の両方が効く)。開放度が未計測なら呼び出し側で 1 を渡す
 */
export function enclosureShade(openness: number): number {
  return 1 - (1 - ENCLOSURE_SHADE_MIN) * enclosure(openness);
}

/**
 * 暗幕の不透明度の上限(設計 2026-11-11-darkness-rework §2。旧 0.62)。
 * 光源のない場所でも地形のシルエットがかろうじて読める濃さに留める(真っ黒にはしない)
 */
export const CURTAIN_MAX = 0.86;
/** 暗幕の傾き: (1 − 環境光) に掛ける係数(旧 0.72) */
export const CURTAIN_SLOPE = 1.0;

/**
 * 環境光(地区 × 深さ × 囲まれ、0..1) → 暗幕の不透明度。明るいほど薄く、CURTAIN_MAX で止める。
 * 範囲外の環境光は 0..1 に丸める(負の不透明度を返さない)
 */
export function curtainAlpha(ambient: number): number {
  const a = ambient < 0 ? 0 : ambient > 1 ? 1 : ambient;
  const v = (1 - a) * CURTAIN_SLOPE;
  return v > CURTAIN_MAX ? CURTAIN_MAX : v;
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
