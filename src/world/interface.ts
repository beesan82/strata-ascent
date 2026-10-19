import { biomeBoundary, biomeCellAt } from './biomeCells';
import { hash2 } from './noise';
import { TILE, type Tile } from './tiles';

// 階層界面(各景観セルの上端にある不壊の水平板)の幾何。

export const INTERFACE_THICKNESS = 32;
export const GREAT_INTERFACE_THICKNESS = 96;
export const PASSAGE_SLOT = 384;
export const PASSAGE_JITTER = 64;
export const PASSAGE_HALF = 1;
export const GREAT_PASSAGE_HALF = 2;
export const SHAFT_OVERHANG = 4;
export const OVERLOOK_LEFT = 12;
export const OVERLOOK_RIGHT = 72;
export const OVERLOOK_HEIGHT = 8;
export const HOLE_OFFSET = 24;
export const HOLE_WIDTH = 48;
export const ANTECHAMBER_HALF_WIDTH = 120;
export const ANTECHAMBER_DEPTH = 48;
export const ANTECHAMBER_FADE = 40;
export const COMPRESSION_DEPTH = 60;
export const COMPRESSION_MASS_DROP = 0.15;
/** 開始層の cell(findSpawn は常に cell 0 の前室に置く)。第 1 階層 */
export const START_CELL = 0;

/** 正規化剰余(負数でも [0, m))。 */
export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** 大界面は 4 セルに 1 枚(mod(cell,4)===2)。 */
export function isGreatInterface(cell: number): boolean {
  return mod(cell, 4) === 2;
}

export function interfaceThickness(cell: number): number {
  return isGreatInterface(cell) ? GREAT_INTERFACE_THICKNESS : INTERFACE_THICKNESS;
}

/** 上面 Y(= 景観セル境界)。 */
export function interfaceTop(seed: number, cell: number): number {
  return biomeBoundary(seed, cell);
}

/** 下面 Y(排他的: top + 厚み)。 */
export function interfaceBottom(seed: number, cell: number): number {
  return interfaceTop(seed, cell) + interfaceThickness(cell);
}

/** k 番目の孔(通路)の中心 X。スロット中心 ± PASSAGE_JITTER。 */
export function passageX(seed: number, cell: number, k: number): number {
  const jitter = Math.floor(hash2(seed + 7001, cell, k) * (PASSAGE_JITTER * 2 + 1)) - PASSAGE_JITTER;
  return k * PASSAGE_SLOT + PASSAGE_SLOT / 2 + jitter;
}

/** x に最寄りの孔。k0 とその両隣から選ぶ(同距離なら小さい k)。 */
export function nearestPassage(seed: number, cell: number, x: number): { k: number; x: number } {
  const k0 = Math.floor(x / PASSAGE_SLOT);
  let best = { k: k0 - 1, x: passageX(seed, cell, k0 - 1) };
  for (let k = k0; k <= k0 + 1; k++) {
    const px = passageX(seed, cell, k);
    if (Math.abs(px - x) < Math.abs(best.x - x)) best = { k, x: px };
  }
  return best;
}

/** 32 タイル幅グループごとの梯子列 X(worldgen の既存式と同一)。 */
export function groupLadderX(seed: number, x: number): number {
  const group = Math.floor(x / 32);
  return group * 32 + Math.floor(hash2(seed + 404, group, 0) * 32);
}

/** 1 つの cell・1 つの孔 px について (x, y) のタイルを判定する(該当なしは null)。 */
function tileForPassage(seed: number, cell: number, top: number, bottom: number, px: number, x: number, y: number): Tile | null {
  const t = bottom - top;
  // 孔の梯子列(最優先)
  if (x === px && y >= top - SHAFT_OVERHANG && y < bottom + ANTECHAMBER_DEPTH) return TILE.LADDER;
  // 大穴(板の上の梯子列は切らない)
  if (x >= px + HOLE_OFFSET && x < px + OVERLOOK_RIGHT && y >= top - SHAFT_OVERHANG && y < bottom + SHAFT_OVERHANG) {
    return y < top && x === groupLadderX(seed, x) ? TILE.LADDER : TILE.AIR;
  }
  // 見晴らし台
  if (x >= px - OVERLOOK_LEFT && x < px + OVERLOOK_RIGHT && y >= top - OVERLOOK_HEIGHT && y < top) {
    return x === groupLadderX(seed, x) ? TILE.LADDER : TILE.AIR;
  }
  if (y >= top && y < bottom) {
    // 縦坑の脇(大界面は踊り場の行だけ HARD)
    const half = isGreatInterface(cell) ? GREAT_PASSAGE_HALF : PASSAGE_HALF;
    if (Math.abs(x - px) <= half) {
      if (isGreatInterface(cell) && (y === top + Math.round(t / 3) || y === top + Math.round((2 * t) / 3))) return TILE.HARD;
      return TILE.AIR;
    }
    return TILE.HARD; // 板
  }
  return null;
}

/**
 * 界面(板・縦坑・見晴らし台・大穴)のタイル。界面に属さなければ null。
 * 板上の見晴らし台は biomeCellAt 上では 1 つ上の cell に入るため、cell と cell+1 の両方を調べる。
 */
export function interfaceTileAt(seed: number, x: number, y: number): Tile | null {
  const c = biomeCellAt(seed, y);
  for (let cell = c; cell <= c + 1; cell++) {
    const top = interfaceTop(seed, cell);
    const bottom = top + interfaceThickness(cell);
    // 早期棄却: 界面タイルは全て [top − 見晴らし台, bottom + 前室) の行に収まる
    if (y < top - OVERLOOK_HEIGHT || y >= bottom + ANTECHAMBER_DEPTH) continue;
    // 候補は最寄りの孔 1 つで足りる。孔 p が持つタイルは x ∈ [p−12, p+72)、すなわち p ∈ (x−72, x+12]。
    // 他の孔は p から 256 以上離れているので x から 184 以上離れ、p より遠い。
    // よって nearestPassage(x) は常にその持ち主(板の HARD だけは孔によらず同じ値)。
    const px = nearestPassage(seed, cell, x).x;
    const r = tileForPassage(seed, cell, top, bottom, px, x, y);
    if (r !== null) return r;
  }
  return null;
}

/** 界面の下の地形変調(前室・圧縮帯)。 */
export interface TerrainMods {
  cavityScale: number;
  massDrop: number;
  suppressLadder: boolean;
  forceFloor: boolean;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * その cell の板(= cell の天井)の直下の地形変調。
 * 前室(板の下 0..48)は空洞化+梯子抑止、その底(dy=48)は床、さらに 60 タイルは圧縮帯。
 */
export function terrainModsAt(seed: number, x: number, y: number, cell: number = biomeCellAt(seed, y)): TerrainMods | null {
  const dy = y - interfaceBottom(seed, cell);
  if (dy < 0 || dy > ANTECHAMBER_DEPTH + COMPRESSION_DEPTH) return null;
  const dx = Math.abs(x - nearestPassage(seed, cell, x).x);
  if (dy < ANTECHAMBER_DEPTH) {
    const fade = clamp01((ANTECHAMBER_HALF_WIDTH + ANTECHAMBER_FADE - dx) / ANTECHAMBER_FADE);
    if (fade === 0) return null;
    return { cavityScale: 1 - fade, massDrop: 0, suppressLadder: fade >= 1, forceFloor: false };
  }
  if (dx > ANTECHAMBER_HALF_WIDTH) return null;
  if (dy === ANTECHAMBER_DEPTH) return { cavityScale: 1, massDrop: 0, suppressLadder: false, forceFloor: true };
  return { cavityScale: 1, massDrop: COMPRESSION_MASS_DROP, suppressLadder: false, forceFloor: false };
}

/**
 * 階層番号(§6.5)。開始層(cell 0)を第 1 階層とし、上(cell が小さくなる方向)へ 1 ずつ増える。
 * seed は開始セルが seed 依存になったときのために受けるが、現在は未使用。
 */
export function layerNumber(_seed: number, cell: number): number {
  return START_CELL - cell + 1;
}

/**
 * 見晴らし台の床(板 cell の上面 interfaceTop の行)に立っているなら、その板の cell。
 * footRow は足元の行(接地時は Math.round(body.y + body.h))。X は孔 −12 〜 大穴の手前(+24)、
 * 孔の梯子列(x === px)は除く。候補 cell は interfaceTileAt と同じ理由で biomeCellAt とその +1。
 */
export function overlookCellAt(seed: number, x: number, footRow: number): number | null {
  const c = biomeCellAt(seed, footRow);
  for (let cell = c; cell <= c + 1; cell++) {
    if (interfaceTop(seed, cell) !== footRow) continue;
    const px = nearestPassage(seed, cell, x).x;
    if (x === px) return null;
    if (x >= px - OVERLOOK_LEFT && x < px + HOLE_OFFSET) return cell;
    return null;
  }
  return null;
}
