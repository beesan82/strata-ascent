import { biomeCellAt } from './biomeCells';
import { groupLadderX, interfaceBottom, interfaceTop, PASSAGE_SLOT, passageX } from './interface';
import { hash2 } from './noise';
import { TILE, type Tile } from './tiles';

/**
 * 休憩点(設計書 §5.4)。孔スロットごとに 1 つ、層の中腹にある灯のともる安全な足場。純粋関数のみ。
 *
 * 座標の約束: Y は下向き正。層 cell は [interfaceTop(cell), interfaceTop(cell+1)) で、天井の板が cell
 * (孔 passageX(seed, cell, k) で上の層へ)、床の板が cell+1(孔 passageX(seed, cell+1, k) で下から来た)。
 * 設計書の「下の界面の孔 passageX(seed, cell−1, k)」はこの向きでは passageX(seed, cell+1, k) と読む(裁定)。
 */

/** 幅 32 */
export const REST_HALF_WIDTH = 16;
/** 床の上の空気の行数 */
export const REST_HEIGHT = 12;
/** 中点からの揺らぎ(±)。梯子列を入れるずらし(≤16)と合わせて ±64 以内 */
export const REST_JITTER = 48;
/** 痕跡の出現率を 5 倍にする範囲(箱からの距離、タイル) */
export const REST_HALO = 24;
/** 両端の壁の下 3 行は出入口(AIR) */
export const REST_DOOR_ROWS = 3;
/** 暖色の補正が箱の外へ消えるまでの距離(タイル) */
export const REST_WARM_FADE = 12;

export interface RestPoint {
  cell: number;
  k: number;
  /** 中心 X */
  x: number;
  /** 床の行(SOLID)。空間は [floorY−12, floorY)、天井は floorY−13 */
  floorY: number;
  /** 左の壁の列 = x − 16 */
  left: number;
  /** 右の壁の列 = x + 15 */
  right: number;
  /** 灯を置く X(3〜5 個、床の 1 段上 floorY−1 に描く) */
  lamps: number[];
  /** 荷袋の X(床の 1 段上) */
  packX: number;
  /** 刻印の行(左の壁 left の内側の面) */
  tallyY: number;
}

/** 層 cell・スロット k の休憩点 */
export function restPointAt(seed: number, cell: number, k: number): RestPoint {
  const bottom = interfaceBottom(seed, cell);
  const H = interfaceTop(seed, cell + 1) - bottom;
  const floorY = bottom + Math.round(H * (0.4 + 0.2 * hash2(seed + 9101, cell, k)));
  // X: 上下の孔の中点 ± 48。箱(32 幅)に 32 タイル梯子列が 1 本も入らない配置(2 グループにまたがる)なら
  // 最寄りの列が入る最小のずらし(≤16)で動かし、通路として到達できるようにする。
  let x = Math.round((passageX(seed, cell + 1, k) + passageX(seed, cell, k)) / 2)
    + Math.floor(hash2(seed + 9102, cell, k) * (REST_JITTER * 2 + 1)) - REST_JITTER;
  const left0 = x - REST_HALF_WIDTH;
  const right0 = x + REST_HALF_WIDTH - 1;
  const lA = groupLadderX(seed, left0);
  const lB = groupLadderX(seed, right0);
  if (!(lA >= left0 && lA <= right0) && !(lB >= left0 && lB <= right0)) {
    // 左のグループの列は箱の左、右のグループの列は箱の右にある。近い方へ寄せる
    const dl = left0 - lA;
    const dr = lB - right0;
    x = dl <= dr ? lA + REST_HALF_WIDTH : lB - REST_HALF_WIDTH + 1;
  }
  const left = x - REST_HALF_WIDTH;
  const right = x + REST_HALF_WIDTH - 1;
  const n = 3 + Math.floor(hash2(seed + 9103, cell, k) * 3);
  const lamps: number[] = [];
  for (let i = 0; i < n; i++) {
    let lx = left + 3 + Math.round((i * 26) / (n - 1));
    if (lx === groupLadderX(seed, lx)) lx++;
    lamps.push(lx);
  }
  // 荷袋は右の壁の内側 3 列。そこが 32 タイル梯子列なら 1 列左へ(床が LADDER だと描かれない。段階4 の保留)
  const packX = right - 3 === groupLadderX(seed, right - 3) ? right - 4 : right - 3;
  return { cell, k, x, floorY, left, right, lamps, packX, tallyY: floorY - 6 };
}

/**
 * 層 cell の休憩点の箱(天井〜床)が取り得る Y の帯 [y0, y1]。床は層の 40〜60% なので、この帯の外では
 * nearestRestPoint(restPointAt 3 回)を呼ばずに棄却できる(チャンク生成の restPointTileAt / traceAt が軽くなる)。
 */
export function restPointBand(seed: number, cell: number): { y0: number; y1: number } {
  const bottom = interfaceBottom(seed, cell);
  const H = interfaceTop(seed, cell + 1) - bottom;
  return { y0: bottom + Math.round(H * 0.4) - REST_HEIGHT - 1, y1: bottom + Math.round(H * 0.6) };
}

/** (x, y) の層で x に最寄りの休憩点(k0 とその両隣から選ぶ) */
export function nearestRestPoint(seed: number, x: number, y: number): RestPoint {
  const cell = biomeCellAt(seed, y);
  const k0 = Math.floor(x / PASSAGE_SLOT);
  let best = restPointAt(seed, cell, k0 - 1);
  for (let k = k0; k <= k0 + 1; k++) {
    const rp = restPointAt(seed, cell, k);
    if (Math.abs(rp.x - x) < Math.abs(best.x - x)) best = rp;
  }
  return best;
}

/**
 * 休憩点の箱のタイル(箱の外は null)。床と天井は SOLID、両端の壁は上 10 行 SOLID・下 3 行 AIR(出入口)、
 * 中は AIR。32 タイル梯子列は床・天井も貫いて残す(通路)。
 */
export function restPointTileAt(seed: number, x: number, y: number): Tile | null {
  const band = restPointBand(seed, biomeCellAt(seed, y));
  if (y < band.y0 || y > band.y1) return null;
  const rp = nearestRestPoint(seed, x, y);
  if (x < rp.left || x > rp.right || y > rp.floorY || y < rp.floorY - REST_HEIGHT - 1) return null;
  if (x === groupLadderX(seed, x)) return TILE.LADDER;
  if (y === rp.floorY || y === rp.floorY - REST_HEIGHT - 1) return TILE.SOLID;
  if (x === rp.left || x === rp.right) return y >= rp.floorY - REST_DOOR_ROWS ? TILE.AIR : TILE.SOLID;
  return TILE.AIR;
}

/** 休憩点の暖かさ: 箱の中で 1、箱からのチェビシェフ距離 12 タイルで 0(線形) */
export function restWarmthAt(seed: number, x: number, y: number): number {
  const band = restPointBand(seed, biomeCellAt(seed, y));
  if (y < band.y0 - REST_WARM_FADE || y > band.y1 + REST_WARM_FADE) return 0;
  const rp = nearestRestPoint(seed, x, y);
  const dx = Math.max(0, rp.left - x, x - rp.right);
  const dy = Math.max(0, rp.floorY - REST_HEIGHT - 1 - y, y - rp.floorY);
  return Math.max(0, 1 - Math.max(dx, dy) / REST_WARM_FADE);
}
