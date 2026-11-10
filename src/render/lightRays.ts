import { CHUNK_SIZE, isSolid } from '../world/tiles';

/**
 * ライトの壁遮蔽(設計 2026-11-10-enemy-visuals-light-occlusion §1)。
 * プレイヤーの補助光(円)とライトコーン(扇)の消去形状を、レイを飛ばして固体タイルで止めた
 * 多角形にするための純粋関数だけを置く。Canvas には触らない(描画は Lighting)。
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
