import { CHUNK_SIZE, isSolid } from '../world/tiles';

/**
 * ライトの壁遮蔽(設計 2026-11-10-enemy-visuals-light-occlusion §1)。
 * プレイヤーの補助光(円)とライトコーン(扇)の消去形状を、レイを飛ばして固体タイルで止めた
 * 多角形にするための純粋関数だけを置く。Canvas には触らない(描画は Lighting と occludedFill)。
 * 2.16(設計 2026-11-11-light-occlusion-ambient §1)で、暗幕の上の光源(光柱・塔の灯・裂け目の光条・
 * 休憩点の灯と暖色・落下粒)の遮蔽にも同じレイを使う: 縦の光は列ごとの平行なレイ、点光源は全周のレイ。
 * 座標はすべてワールドのタイル座標。レイは中心・半径・角度だけから決まる(乱数なし)。
 */

/** 円(補助光)のレイ本数 */
export const CIRCLE_RAYS = 48;
/** コーンのレイ本数(扇の両端を含む) */
export const CONE_RAYS = 40;
/**
 * 壁面の照らし代(タイル)。レイは固体タイルへ入った点(壁の表面)からこの深さまで進めて止める。
 * 表面ちょうどで止めると壁の縁の画素が 1 つも照らされず、壁面が光を受けて見えないため
 */
export const WALL_SKIN = 0.3;

/** タイル座標 (tx, ty) が光を遮る固体か */
export type SolidAt = (tx: number, ty: number) => boolean;

/**
 * 中心 (cx, cy) から単位方向 (dx, dy) へレイを飛ばし、止まった距離を返す(最大 maxDist)。
 * タイル格子を境界ごとに辿り(DDA)、最初に入った固体タイルの表面までの距離に skin を足す。
 * 刻み幅のサンプリングと違い、壁の表面の位置は刻みに依らず正確に決まる。
 * 中心のタイル自体は見ない(体が壁にめり込んでいても光が消えない)。
 */
export function rayDistance(
  cx: number, cy: number, dx: number, dy: number, maxDist: number,
  solidAt: SolidAt, skin = WALL_SKIN,
): number {
  let tx = Math.floor(cx);
  let ty = Math.floor(cy);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx > 0 ? (tx + 1 - cx) / dx : dx < 0 ? (cx - tx) / -dx : Infinity;
  let tMaxY = dy > 0 ? (ty + 1 - cy) / dy : dy < 0 ? (cy - ty) / -dy : Infinity;
  for (;;) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      tx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      ty += stepY;
    }
    if (!(t < maxDist)) return maxDist;
    if (solidAt(tx, ty)) return Math.min(maxDist, t + skin);
  }
}

/**
 * 全周のレイ(円の補助光)。角度 0 から 2π/count 刻みで count 本を飛ばし、
 * 端点を [x0, y0, x1, y1, ...] で返す(長さ 2×count)。out を渡すとそこへ書く(割り当てを避ける)。
 * 開けた場所では端点はすべて半径 radius の円周上に乗る。
 */
export function circleRays(
  cx: number, cy: number, radius: number, count: number, solidAt: SolidAt,
  out: Float64Array = new Float64Array(count * 2),
): Float64Array {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const d = rayDistance(cx, cy, dx, dy, radius, solidAt);
    out[i * 2] = cx + dx * d;
    out[i * 2 + 1] = cy + dy * d;
  }
  return out;
}

/**
 * 扇のレイ(ライトコーン)。angle − half から angle + half までを両端を含めて count 本(count ≥ 2)で刻み、
 * 端点を [x0, y0, ...] で返す。扇の外へはレイを飛ばさない。
 */
export function coneRays(
  cx: number, cy: number, radius: number, angle: number, half: number, count: number, solidAt: SolidAt,
  out: Float64Array = new Float64Array(count * 2),
): Float64Array {
  const n = Math.max(2, count);
  for (let i = 0; i < n; i++) {
    const a = angle - half + (2 * half * i) / (n - 1);
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const d = rayDistance(cx, cy, dx, dy, radius, solidAt);
    out[i * 2] = cx + dx * d;
    out[i * 2 + 1] = cy + dy * d;
  }
  return out;
}

/**
 * 点光源の暈(塔系の頂部の灯の暈、設計 2026-11-11-light-occlusion-ambient §1)のレイ本数。
 * 暈は半径 4〜6 タイルで、16 本なら縁でのレイの間隔は最大約 2 タイル
 */
export const HALO_RAYS = 16;
/** 休憩点の灯の暈(3×2 タイル、半径約 2 タイル)のレイ本数。縁での間隔は約 1 タイル */
export const LAMP_HALO_RAYS = 12;

/** 平行光(光柱・光条)の進む向き。'down' は上端から下へ、'up' は下端から上へ */
export type ColumnDir = 'down' | 'up';

/**
 * 平行光の列ごとの到達位置(設計 2026-11-11-light-occlusion-ambient §1)。
 * タイル列 tx0..tx0+n-1 のそれぞれで、列の中央 (tx+0.5, start) から真下(end > start)または真上へ
 * レイを飛ばし(rayDistance)、最初に入った固体タイルの表面+照らし代で止めた Y を out[i] に書く(最大 end)。
 * 起点の行が固体なら光はその列に入らない(out[i] = start)。光柱・光条は「地形で止まる」ので、
 * 壁の上面(下向き)や天井の下面(上向き)は照らされ、その奥・その先は照らされない。
 */
export function columnReach(
  tx0: number, n: number, start: number, end: number, solidAt: SolidAt,
  out: Float64Array = new Float64Array(n),
): Float64Array {
  const down = end >= start;
  // 起点の点が入っている行(上向きで start が整数なら、その 1 つ上の行)
  const row = down ? Math.floor(start) : Math.ceil(start) - 1;
  const maxDist = Math.abs(end - start);
  for (let i = 0; i < n; i++) {
    const tx = tx0 + i;
    if (solidAt(tx, row)) {
      out[i] = start;
      continue;
    }
    const d = rayDistance(tx + 0.5, start, 0, down ? 1 : -1, maxDist, solidAt);
    out[i] = down ? start + d : start - d;
  }
  return out;
}

/** 到達位置が同じタイル列の連続(ワールド X の [x0, x1))と、その到達位置 */
export interface ReachRun {
  x0: number;
  x1: number;
  reach: number;
}

/**
 * 列ごとの到達位置(reach[i] はタイル列 tx0+i)を、横 [x0, x1) に掛かる「同じ到達位置の連続」へまとめる。
 * 区間の両端は x0, x1 で切る(端の列が一部だけ掛かる矩形もそのまま扱える)。reach の外の列は返さない。
 * 開けた場所では全列が同じ値になり 1 区間(矩形 1 枚)で済む。
 */
export function reachRuns(reach: ArrayLike<number>, tx0: number, n: number, x0: number, x1: number): ReachRun[] {
  const out: ReachRun[] = [];
  const a = Math.max(tx0, Math.floor(x0));
  const b = Math.min(tx0 + n, Math.ceil(x1));
  let i = a;
  while (i < b) {
    const v = reach[i - tx0];
    let j = i + 1;
    while (j < b && reach[j - tx0] === v) j++;
    out.push({ x0: Math.max(x0, i), x1: Math.min(x1, j), reach: v });
    i = j;
  }
  return out;
}

/**
 * 全周のレイ(circleRays の端点、count 本)のどれかが壁で半径より手前に止まったか。
 * 止まったものが無ければ点光源の暈は従来どおりの矩形 1 枚で描ける(多角形の切り取りを省く)
 */
export function raysBlocked(pts: ArrayLike<number>, count: number, cx: number, cy: number, radius: number): boolean {
  const r2 = (radius - 1e-6) * (radius - 1e-6);
  for (let i = 0; i < count; i++) {
    const dx = pts[i * 2] - cx;
    const dy = pts[i * 2 + 1] - cy;
    if (dx * dx + dy * dy < r2) return true;
  }
  return false;
}

/**
 * 点光源の暈(矩形 [x0,x1]×[y0,y1])を全周のレイで覆うのに要る半径。中心から矩形の最も遠い角までの距離を、
 * count 角形の弦が角を内側へ削らないよう 1/cos(π/count) 倍し、少し足す。
 * 開けた場所ではレイの多角形が矩形を必ず含む(=遮蔽しても形が変わらない)。
 */
export function haloRadius(cx: number, cy: number, x0: number, y0: number, x1: number, y1: number, count: number): number {
  const dx = Math.max(Math.abs(x0 - cx), Math.abs(x1 - cx));
  const dy = Math.max(Math.abs(y0 - cy), Math.abs(y1 - cy));
  return Math.hypot(dx, dy) / Math.cos(Math.PI / count) + 0.05;
}

/** clipPolygonToRect の 1 辺ぶん(Sutherland–Hodgman)。axis 0=X、1=Y。keepAbove は bound 以上を残す */
function clipAxis(src: number[], axis: 0 | 1, bound: number, keepAbove: boolean): number[] {
  const out: number[] = [];
  const m = src.length / 2;
  for (let i = 0; i < m; i++) {
    const ax = src[i * 2], ay = src[i * 2 + 1];
    const j = i + 1 === m ? 0 : i + 1;
    const bx = src[j * 2], by = src[j * 2 + 1];
    const av = axis === 0 ? ax : ay;
    const bv = axis === 0 ? bx : by;
    const aIn = keepAbove ? av >= bound : av <= bound;
    const bIn = keepAbove ? bv >= bound : bv <= bound;
    if (aIn) out.push(ax, ay);
    if (aIn !== bIn) {
      const t = (bound - av) / (bv - av);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

/**
 * 多角形(端点列 [x0,y0,...]、n 点)を軸平行の矩形 [rx0,rx1]×[ry0,ry1] で切り取り、[x0,y0,...] で返す
 * (Sutherland–Hodgman)。点光源の暈(矩形)を、レイで壁に遮った多角形の内側だけに縮めるのに使う。
 * 切り取り窓が凸(矩形)なので、レイの多角形(星形)でも正しく切れる。重ならなければ空配列。
 */
export function clipPolygonToRect(
  pts: ArrayLike<number>, n: number, rx0: number, ry0: number, rx1: number, ry1: number,
): number[] {
  let poly: number[] = [];
  for (let i = 0; i < n * 2; i++) poly.push(pts[i]);
  poly = clipAxis(poly, 0, rx0, true);
  if (poly.length > 0) poly = clipAxis(poly, 0, rx1, false);
  if (poly.length > 0) poly = clipAxis(poly, 1, ry0, true);
  if (poly.length > 0) poly = clipAxis(poly, 1, ry1, false);
  return poly;
}

/**
 * チャンクのタイル配列からの固体判定。peek は生成済みチャンクだけを返す関数(ChunkStore.peekChunk)で、
 * 未生成のチャンクは空気として扱う(描画のためにチャンクを生成しない)。レイは同じチャンクを
 * 続けて引くので、直前のチャンクを覚えて Map 参照(と文字列キーの生成)を省く。
 * 返す関数は 1 フレームの間だけ使う(破壊でチャンク配列が差し替わっても次のフレームで作り直す)。
 */
export function chunkSolidLookup(peek: (cx: number, cy: number) => Uint8Array | undefined): SolidAt {
  let lastCx = NaN;
  let lastCy = NaN;
  let last: Uint8Array | undefined;
  return (tx, ty) => {
    const cx = Math.floor(tx / CHUNK_SIZE);
    const cy = Math.floor(ty / CHUNK_SIZE);
    if (cx !== lastCx || cy !== lastCy) {
      lastCx = cx;
      lastCy = cy;
      last = peek(cx, cy);
    }
    if (!last) return false;
    return isSolid(last[(ty - cy * CHUNK_SIZE) * CHUNK_SIZE + (tx - cx * CHUNK_SIZE)]);
  };
}
