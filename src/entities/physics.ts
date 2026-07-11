import { TILE, type Tile } from '../world/tiles';

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

function collides(tiles: TileLookup, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x);
  const x1 = Math.floor(x + w - EPS);
  const y0 = Math.floor(y);
  const y1 = Math.floor(y + h - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tiles(tx, ty) === TILE.SOLID) return true;
    }
  }
  return false;
}

function collidesSweptX(tiles: TileLookup, x_old: number, x_new: number, y: number, w: number, h: number): boolean {
  const x_min = Math.min(x_old, x_new);
  const x_max = Math.max(x_old, x_new) + w;
  const x0 = Math.floor(x_min);
  const x1 = Math.floor(x_max - EPS);
  const y0 = Math.floor(y);
  const y1 = Math.floor(y + h - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tiles(tx, ty) === TILE.SOLID) return true;
    }
  }
  return false;
}

function collidesSweptY(tiles: TileLookup, x: number, y_old: number, y_new: number, w: number, h: number): boolean {
  const y_min = Math.min(y_old, y_new);
  const y_max = Math.max(y_old, y_new) + h;
  const x0 = Math.floor(x);
  const x1 = Math.floor(x + w - EPS);
  const y0 = Math.floor(y_min);
  const y1 = Math.floor(y_max - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tiles(tx, ty) === TILE.SOLID) return true;
    }
  }
  return false;
}

/** 軸別に移動して衝突解決する。衝突した軸の速度は0になり、下方向の衝突でonGroundが立つ */
export function moveBody(body: Body, dt: number, tiles: TileLookup): void {
  // X軸
  let nx = body.x + body.vx * dt;
  if (collidesSweptX(tiles, body.x, nx, body.y, body.w, body.h)) {
    const step = Math.sign(body.vx) * STEP;
    nx = body.x;
    while (!collides(tiles, nx + step, body.y, body.w, body.h)) nx += step;
    body.vx = 0;
  }
  body.x = nx;

  // Y軸
  let ny = body.y + body.vy * dt;
  body.onGround = false;
  if (collidesSweptY(tiles, body.x, body.y, ny, body.w, body.h)) {
    const step = Math.sign(body.vy) * STEP;
    ny = body.y;
    while (!collides(tiles, body.x, ny + step, body.w, body.h)) ny += step;
    if (body.vy > 0) body.onGround = true;
    body.vy = 0;
  }
  body.y = ny;
}
