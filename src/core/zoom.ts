import { TILE } from '../world/tiles';

/** ズーム下限(最大ズームアウト)。0.5 = 標準の2倍のタイルが横に入る(≒横88タイル) */
export const MIN_ZOOM = 0.5;
/** ズーム上限(標準表示。横44タイル) */
export const MAX_ZOOM = 1;

/** 開放度サンプリングの既定半径(タイル) */
export const OPENNESS_RADIUS = 22;
/** サンプリングの既定間引き(2=1タイルおき。tileAt呼び出しを1/4に減らす) */
export const OPENNESS_STEP = 2;

/** この開放度以下は標準ズーム(閉塞・通路) */
export const OPENNESS_LO = 0.55;
/** この開放度以上は最大ズームアウト(大空洞) */
export const OPENNESS_HI = 0.9;

/**
 * (cx,cy)中心の (2r+1)^2 タイル格子を step 間引きで走査し「非SOLIDの割合」(0..1)を返す。
 * AIR/LADDER を開放、SOLID を閉塞とみなす。tileAt は破壊反映済みの経路(store.tileAt)を渡す。
 * 純粋関数: 同じ tileAt・座標なら常に同じ出力。
 */
export function sampleOpenness(
  tileAt: (x: number, y: number) => number,
  cx: number,
  cy: number,
  r: number = OPENNESS_RADIUS,
  step: number = OPENNESS_STEP,
): number {
  let open = 0;
  let total = 0;
  // サンプル格子はプレイヤーではなく「ワールドの固定格子(stepの倍数)」にアンカーする。
  // floor(cx)-r 起点だと1タイル歩くたびにサンプル列の偶奇が丸ごと入れ替わり(step>1)、
  // 別の列集合を測るため開放度が鋸歯状に振動→ズームがぐわんぐわんする。固定格子なら
  // 移動しても同じ世界列を測り続け、端で列が1本出入りするだけの滑らかな変化になる。
  const x0 = Math.floor((Math.floor(cx) - r) / step) * step;
  const y0 = Math.floor((Math.floor(cy) - r) / step) * step;
  const x1 = Math.floor(cx) + r;
  const y1 = Math.floor(cy) + r;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      total++;
      if (tileAt(x, y) !== TILE.SOLID) open++;
    }
  }
  return total === 0 ? 0 : open / total;
}

/**
 * 開放度(0..1) → 目標ズーム。開放なほどズームアウト(小さいzoom)。
 * openness<=OPENNESS_LO は MAX_ZOOM、>=OPENNESS_HI は MIN_ZOOM、間は線形補間。
 * 範囲外は [MIN_ZOOM, MAX_ZOOM] にクランプ。
 */
export function targetZoomForOpenness(openness: number): number {
  const t = (openness - OPENNESS_LO) / (OPENNESS_HI - OPENNESS_LO);
  const clamped = Math.max(0, Math.min(1, t));
  return MAX_ZOOM + (MIN_ZOOM - MAX_ZOOM) * clamped;
}
