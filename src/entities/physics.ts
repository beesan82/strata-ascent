import { isSolid, type Tile } from '../world/tiles';

/** 物理ボディ。座標はタイル単位、(x, y)は左上、yは下向きが正 */
export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  onGround: boolean;
}

export type TileLookup = (tx: number, ty: number) => Tile;

const EPS = 1e-9;
const STEP = 1 / 16;

/** タイル添字範囲 [x0..x1] × [y0..y1](両端含む、floor済み)に固体(SOLID/HARD)があるか */
function solidInRange(tiles: TileLookup, x0: number, x1: number, y0: number, y1: number): boolean {
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (isSolid(tiles(tx, ty))) return true;
    }
  }
  return false;
}

/** AABB (x, y, w, h) がSOLIDと重なるか */
function collides(tiles: TileLookup, x: number, y: number, w: number, h: number): boolean {
  return solidInRange(
    tiles,
    Math.floor(x),
    Math.floor(x + w - EPS),
    Math.floor(y),
    Math.floor(y + h - EPS),
  );
}

/** AABB (x, y, w, h) がSOLIDと重なるか(スポーン位置の埋没判定など、移動を伴わない確認用) */
export function bodyOverlapsSolid(
  tiles: TileLookup,
  x: number,
  y: number,
  w: number,
  h: number,
): boolean {
  return collides(tiles, x, y, w, h);
}

/** X方向にxOld→xNewへ掃引したAABBがSOLIDと重なるか(高速移動時のすり抜け防止) */
function collidesSweptX(
  tiles: TileLookup,
  xOld: number,
  xNew: number,
  y: number,
  w: number,
  h: number,
): boolean {
  return solidInRange(
    tiles,
    Math.floor(Math.min(xOld, xNew)),
    Math.floor(Math.max(xOld, xNew) + w - EPS),
    Math.floor(y),
    Math.floor(y + h - EPS),
  );
}

/** Y方向にyOld→yNewへ掃引したAABBがSOLIDと重なるか(高速移動時のすり抜け防止) */
function collidesSweptY(
  tiles: TileLookup,
  x: number,
  yOld: number,
  yNew: number,
  w: number,
  h: number,
): boolean {
  return solidInRange(
    tiles,
    Math.floor(x),
    Math.floor(x + w - EPS),
    Math.floor(Math.min(yOld, yNew)),
    Math.floor(Math.max(yOld, yNew) + h - EPS),
  );
}

// ---- 崖つかみ(設計 2026-11-09-ledge-grab §掴まりの成立) ----

/** 手が届く範囲: 体上端からこの距離だけ下まで(タイル) */
export const LEDGE_HAND_REACH = 0.7;
/** 壁面と体の側面の許容隙間(タイル)。moveBody の 1/16 刻み探索が残す隙間より少し広い */
const LEDGE_WALL_GAP = 0.1;
/** 掴まり中の体上端が縁の上面より下がる量(タイル)。手が縁にかかる見た目になる */
export const LEDGE_HANG_DEPTH = 0.25;

export interface Ledge {
  /** 縁タイルの列(壁側) */
  tx: number;
  /** 縁タイルの行(= 縁の上面の y) */
  ty: number;
  /** 縁がある側(1=右, -1=左) */
  side: 1 | -1;
  /** 掴まり時に置くべき body の左上 */
  x: number;
  y: number;
}

/**
 * body の side 側に掴まれる縁があるか。純粋関数で、以下をすべて満たすとき縁を返す:
 * - 壁側に隣接する列(側面から LEDGE_WALL_GAP 以内)に固体タイルがある
 * - そのタイルの上面 ty が手の届く範囲 [body.y, body.y + LEDGE_HAND_REACH] にある
 *   (整数行なので候補は高々 1 つ)
 * - そのタイルの上(ty-1)が固体でない(= 縁である)
 * - スナップ位置に置いた体が固体と重ならない
 * 落下中かどうか・入力の向きは呼び出し側(Player)が決める。梯子は固体でないので干渉しない。
 */
export function findLedge(body: Body, tiles: TileLookup, side: 1 | -1): Ledge | null {
  const tx = side === 1
    ? Math.floor(body.x + body.w + LEDGE_WALL_GAP)
    : Math.floor(body.x - LEDGE_WALL_GAP);
  const ty = Math.ceil(body.y);
  if (ty > body.y + LEDGE_HAND_REACH) return null;
  if (!isSolid(tiles(tx, ty))) return null;
  if (isSolid(tiles(tx, ty - 1))) return null;
  const x = side === 1 ? tx - body.w : tx + 1;
  const y = ty + LEDGE_HANG_DEPTH;
  if (collides(tiles, x, y, body.w, body.h)) return null;
  return { tx, ty, side, x, y };
}

/**
 * 軸別に移動して衝突解決する。衝突した軸の速度は0になり、下方向の衝突でonGroundが立つ。
 *
 * onGroundの契約: 接地フラグは「今フレームの下方向衝突」でのみ立つ。呼び出し側は
 * 接地中でも毎フレーム重力を適用すること。さもないとvyが0のままY軸衝突が起きず、
 * onGroundがfalseにフリッカーする。
 */
export function moveBody(body: Body, dt: number, tiles: TileLookup): void {
  // 埋まり開始ガード: 開始位置が既にSOLIDと重なっている場合は移動せず速度を0にして返す
  // (決定的なフリーズ)。スポーン/テレポートの不具合に対するセーフティネットで、
  // 実運用ではスポーンロジック側が非埋没開始を保証する。ガードなしでは下の
  // ステップ探索が停止しない(その場凍結または無限に走り去る)恐れがある。
  if (collides(tiles, body.x, body.y, body.w, body.h)) {
    body.vx = 0;
    body.vy = 0;
    return;
  }

  // X軸
  let nx = body.x + body.vx * dt;
  if (collidesSweptX(tiles, body.x, nx, body.y, body.w, body.h)) {
    const step = Math.sign(body.vx) * STEP;
    // 探索は意図した移動量を超えない(暴走防止の上限)
    const maxSteps = Math.ceil(Math.abs(body.vx * dt) / STEP) + 1;
    nx = body.x;
    let i = 0;
    while (i++ < maxSteps && !collides(tiles, nx + step, body.y, body.w, body.h)) nx += step;
    body.vx = 0;
  }
  body.x = nx;

  // Y軸
  let ny = body.y + body.vy * dt;
  body.onGround = false;
  if (collidesSweptY(tiles, body.x, body.y, ny, body.w, body.h)) {
    const step = Math.sign(body.vy) * STEP;
    const maxSteps = Math.ceil(Math.abs(body.vy * dt) / STEP) + 1;
    ny = body.y;
    let i = 0;
    while (i++ < maxSteps && !collides(tiles, body.x, ny + step, body.w, body.h)) ny += step;
    if (body.vy > 0) body.onGround = true;
    body.vy = 0;
  }
  body.y = ny;
}
