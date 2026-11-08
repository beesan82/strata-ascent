/**
 * 歩容(見た目改善 段階 2、設計 §4.2)。純粋関数のみ。
 *
 * 位相は時間ではなく移動距離で進める。1 歩(位相 π)で体がちょうど歩幅ぶん進む
 * ように位相を決めると、接地期の足は地面に対して静止し、足裏の滑りが消える。
 * 足音の発火条件(位相の π 跨ぎ=着地、audio/params の footstepCrossed)は、
 * 着地を π の倍数に置くこの位相でもそのまま成り立つ。
 */

/** 1 歩あたりの歩幅(タイル)。位相 π ぶんの移動距離 */
export const WALK_STRIDE_TILES = 1.0;
/** 足の持ち上げ(タイル)。内部解像度(約 12.6px/タイル)で約 1.8px 読める量 */
export const FOOT_LIFT_TILES = 0.14;
/** 各足の周期のうち接地期が占める割合。0.5 より大きいので両足接地の時間が生まれる */
export const STANCE_FRACTION = 0.55;
/** 体の上下動(タイル)。歩の中点で最大 */
export const BODY_RISE_TILES = 0.06;
/** 着地直後の沈み込み(タイル) */
export const LANDING_DIP_TILES = 0.03;
/** 沈み込みが解けるまでの歩の割合 */
const DIP_SPAN = 0.3;

/** 移動距離(タイル)から歩行位相の進み(ラジアン)を返す。歩幅 1 タイル = 位相 π */
export function walkPhaseAdvance(distanceTiles: number): number {
  return (Math.PI * distanceTiles) / WALK_STRIDE_TILES;
}

export interface GaitFoot {
  /** 体に対する足の前後位置(タイル、+ が前方)。接地期は地面に対して静止する */
  forward: number;
  /** 足の持ち上げ(タイル、0 = 接地) */
  lift: number;
}

const smoothstep = (v: number): number => {
  const t = v < 0 ? 0 : v > 1 ? 1 : v;
  return t * t * (3 - 2 * t);
};

/**
 * 1 足ぶんの歩容プロファイル。u はその足の周期位置 [0,1) で、0 = 着地の瞬間(足が最前方)。
 * 接地期(u < STANCE_FRACTION)は足が体の後方へ一定速度で流れ(地面に対して静止)、
 * 遊脚期は足を持ち上げて速く前へ戻す、非対称プロファイルにする。
 * 前後の振幅は STANCE_FRACTION × 歩幅 で、接地足の対地速度がちょうど 0 になる値。
 */
export function gaitFoot(u: number): GaitFoot {
  const pos = u - Math.floor(u);
  const amplitude = STANCE_FRACTION * WALK_STRIDE_TILES;
  if (pos < STANCE_FRACTION) {
    return { forward: amplitude * (1 - (2 * pos) / STANCE_FRACTION), lift: 0 };
  }
  const v = (pos - STANCE_FRACTION) / (1 - STANCE_FRACTION);
  return {
    forward: amplitude * (-1 + 2 * smoothstep(v)),
    lift: FOOT_LIFT_TILES * Math.sin(Math.PI * v),
  };
}

/**
 * 体の上下方向オフセット(タイル、+ が沈む向き)。着地(s=0)で沈み込みが最大になり、
 * 歩の中点(s=0.5)で体が最も上がる。s は歩(位相 π)の中の位置 [0,1)。
 */
export function gaitBodyOffset(stepFraction: number): number {
  const s = stepFraction - Math.floor(stepFraction);
  const rise = BODY_RISE_TILES * Math.sin(Math.PI * s);
  const dip = LANDING_DIP_TILES * Math.max(0, 1 - s / DIP_SPAN);
  return dip - rise;
}

/** 歩行位相から「歩の中の位置 [0,1)」を返す。0 = 着地の瞬間 */
export function stepFraction(walkPhase: number): number {
  const s = (walkPhase / Math.PI) % 1;
  return s < 0 ? s + 1 : s;
}

/** 歩行位相から、その足の周期位置 [0,1) を返す。landingPhase はその足が着地する位相 */
export function footCyclePosition(walkPhase: number, landingPhase: number): number {
  const u = ((walkPhase - landingPhase) / (2 * Math.PI)) % 1;
  return u < 0 ? u + 1 : u;
}
