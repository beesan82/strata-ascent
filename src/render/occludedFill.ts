import {
  circleRays, clipPolygonToRect, columnReach, haloRadius, raysBlocked, reachRuns, type SolidAt,
} from './lightRays';

/**
 * 暗幕の上の光(Lighting の overlay)を壁で遮って塗る Canvas 側の補助(設計 2026-11-11-light-occlusion-ambient §1)。
 * 幾何(レイ・区間・多角形の切り取り)は lightRays の純粋関数が決め、ここはワールド座標を画面へ写して塗るだけ。
 * 合成モード・色・アルファは呼び出し側が設定する(ここは触らない)。テスト対象外(Canvas)。
 */

/** 描画先の視野: カメラ中心(ワールドのタイル座標)と画面の寸法・1 タイルの px */
export interface LightView {
  camX: number;
  camY: number;
  w: number;
  h: number;
  ppt: number;
}

/** 列ごとの到達位置(columnReach の結果)。視野に入るタイル列 tx0..tx0+n-1 だけを持つ */
export interface ColumnLight {
  reach: Float64Array;
  tx0: number;
  n: number;
  down: boolean;
}

/** ワールド座標の矩形が画面に掛かるか */
export function rectOnScreen(v: LightView, x0: number, y0: number, x1: number, y1: number): boolean {
  const sx0 = (x0 - v.camX) * v.ppt + v.w / 2;
  const sy0 = (y0 - v.camY) * v.ppt + v.h / 2;
  const sx1 = (x1 - v.camX) * v.ppt + v.w / 2;
  const sy1 = (y1 - v.camY) * v.ppt + v.h / 2;
  return sx1 > 0 && sx0 < v.w && sy1 > 0 && sy0 < v.h;
}

/** ワールド座標の矩形 [x0,x1)×[y0,y1) を画面内の部分だけ塗る(lighter の画素数を最小に) */
export function fillWorldRect(
  ctx: CanvasRenderingContext2D, v: LightView, x0: number, y0: number, x1: number, y1: number,
): void {
  const sx0 = (x0 - v.camX) * v.ppt + v.w / 2;
  const sy0 = (y0 - v.camY) * v.ppt + v.h / 2;
  const sx1 = (x1 - v.camX) * v.ppt + v.w / 2;
  const sy1 = (y1 - v.camY) * v.ppt + v.h / 2;
  const xa = Math.max(0, sx0), xb = Math.min(v.w, sx1);
  const ya = Math.max(0, sy0), yb = Math.min(v.h, sy1);
  if (xb <= xa || yb <= ya) return;
  ctx.fillRect(xa, ya, xb - xa, yb - ya);
}

/**
 * 横 [x0, x1) の縦の平行光を start から end へ飛ばし、列ごとの到達位置を求める。
 * 画面外の列はレイを飛ばさない(視野の横幅で切る)。buf が足りなければ作り直して返す
 */
export function castColumns(
  v: LightView, x0: number, x1: number, start: number, end: number, solidAt: SolidAt, buf?: Float64Array,
): ColumnLight {
  const half = v.w / 2 / v.ppt;
  const tx0 = Math.floor(Math.max(x0, v.camX - half));
  const n = Math.max(0, Math.ceil(Math.min(x1, v.camX + half)) - tx0);
  const reach = buf && buf.length >= n ? buf : new Float64Array(Math.max(n, 64));
  columnReach(tx0, n, start, end, solidAt, reach);
  return { reach, tx0, n, down: end >= start };
}

/**
 * 矩形 [x0,x1)×[y0,y1) のうち、縦の平行光(col)が届く部分だけを塗る。下向きなら各列の到達位置より上、
 * 上向きなら下だけ。到達位置の同じ列はまとめて 1 枚の矩形にする(開けた場所では従来どおり 1 枚)
 */
export function fillLitRect(
  ctx: CanvasRenderingContext2D, v: LightView, col: ColumnLight,
  x0: number, y0: number, x1: number, y1: number,
): void {
  for (const run of reachRuns(col.reach, col.tx0, col.n, x0, x1)) {
    if (col.down) fillWorldRect(ctx, v, run.x0, y0, run.x1, Math.min(y1, run.reach));
    else fillWorldRect(ctx, v, run.x0, Math.max(y0, run.reach), run.x1, y1);
  }
}

/**
 * 点光源 (ox, oy) の暈(矩形)を、全周 rays 本のレイで壁に遮った多角形の内側だけ塗る。
 * どのレイも壁に当たらなければ従来どおり矩形 1 枚(多角形のパスを作らない)。buf はレイの端点の作業配列
 */
export function fillPointLit(
  ctx: CanvasRenderingContext2D, v: LightView,
  x0: number, y0: number, x1: number, y1: number,
  ox: number, oy: number, rays: number, solidAt: SolidAt, buf: Float64Array,
): void {
  const radius = haloRadius(ox, oy, x0, y0, x1, y1, rays);
  const pts = circleRays(ox, oy, radius, rays, solidAt, buf);
  if (!raysBlocked(pts, rays, ox, oy, radius)) {
    fillWorldRect(ctx, v, x0, y0, x1, y1);
    return;
  }
  const poly = clipPolygonToRect(pts, rays, x0, y0, x1, y1);
  if (poly.length < 6) return;
  ctx.beginPath();
  for (let i = 0; i < poly.length; i += 2) {
    const sx = (poly[i] - v.camX) * v.ppt + v.w / 2;
    const sy = (poly[i + 1] - v.camY) * v.ppt + v.h / 2;
    if (i === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.closePath();
  ctx.fill();
}
