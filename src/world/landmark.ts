import { biomeCellAt } from './biomeCells';
import {
  ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceThickness, interfaceTop, mod, OVERLOOK_HEIGHT,
  PASSAGE_SLOT, passageX, SHAFT_OVERHANG,
} from './interface';
import { hash2 } from './noise';
import { TILE, type Tile } from './tiles';

/**
 * 大構造(設計書 §5.5)。3 層に 1 層(mod(cell,3)===1)の孔スロット 3 個に 1 つ(mod(k,3)===0)に 1 基。
 * v1 のカタログは塔と崩落界面の 2 種で、種はスロットごとに決定論で選ぶ。純粋関数のみ。
 *
 * 座標の約束: 層 cell は [interfaceTop(cell), interfaceTop(cell+1))。天井の板が cell、床の板が cell+1。
 * 「孔 X」は天井の板(cell)の孔 passageX(seed, cell, k)。
 *
 * 塔: 幅 48 の HARD の柱。床の板の上面(interfaceTop(cell+1))から立ち、天井の板(cell)を貫いて
 *     板の上面で開口する(頂部は幅 12 の床で、見晴らし台と同じ高さに出る。上の層 cell−1 に属する)。
 *     内部に幅 3 の縦坑(中央 LADDER)、層の高さを 4 等分した 1/4・2/4・3/4 に塔を横に貫く通路 3 本、
 *     基部の 3 行は出入口。どの高さからでも内部の梯子へ入れる第二の登攀経路。
 * 崩落界面: 天井の板の一部(幅 2×(48+厚み))が裂け、前室の床の行から板の上面まで 2 列で 1 段上がる
 *     階段状の楔(HARD)が流れている。楔の上は裂け目(AIR)。孔を使わずに右+ジャンプで登れる。
 *     幅を厚みに連動させるのは大界面(厚み 96)でも傾き 1/2 を保つため(裁定: §11 の ±30% より到達可能性を優先)。
 */

/** 中心 X = 孔 X + 160(塔・崩落とも。前室 ±120 の縁の外) */
export const LANDMARK_OFFSET = 160;
/** 塔の半幅(幅 48) */
export const TOWER_HALF_WIDTH = 24;
/** 塔の頂部の床の半幅(幅 12) */
export const TOWER_TOP_HALF_WIDTH = 6;
/** 塔の内部の縦坑の半幅(幅 3、中央 LADDER) */
export const TOWER_SHAFT_HALF = 1;
/** 環状通路の本数(層の高さを 4 等分した 1/4, 2/4, 3/4) */
export const TOWER_RINGS = 3;
/** 環状通路の高さ(行) */
export const TOWER_RING_ROWS = 3;
/** 基部の出入口(床の板の上 3 行) */
export const TOWER_BASE_ROWS = 3;
/** 斜路: 2 列で 1 段上がる */
export const COLLAPSE_SLOPE_RUN = 2;

export type LandmarkKind = 'tower' | 'collapse';

export interface Landmark {
  kind: LandmarkKind;
  cell: number;
  k: number;
  /** 中心 X = passageX(seed, cell, k) + 160 */
  x: number;
  /** interfaceTop(seed, cell)(板の上面 = 塔の頂部の床 / 崩落の上端) */
  top: number;
  /** interfaceBottom(seed, cell) */
  bottom: number;
  /** interfaceTop(seed, cell+1)(塔の基部が立つ床の板の上面) */
  floor: number;
  /** 崩落だけ: 裂け目の左端(含む)= x − width/2 */
  gapLeft: number;
  /** 崩落だけ: 右端(排他) */
  gapRight: number;
  /** 崩落だけ: 斜路の足の行 = bottom + 48(前室の床の行) */
  baseY: number;
}

/** 大構造の層か(mod(cell,3)===1) */
export function isLandmarkLayer(cell: number): boolean {
  return mod(cell, 3) === 1;
}

/** 崩落の幅 = 2 × (前室の深さ + 板の厚み)。傾き 1/2 で前室の床から板の上面へ届く長さ */
export function collapseWidth(cell: number): number {
  return COLLAPSE_SLOPE_RUN * (ANTECHAMBER_DEPTH + interfaceThickness(cell));
}

/** 層 cell・スロット k の大構造。大構造の層でない、または mod(k,3)!==0 なら null */
export function landmarkAt(seed: number, cell: number, k: number): Landmark | null {
  if (!isLandmarkLayer(cell) || mod(k, 3) !== 0) return null;
  const kind: LandmarkKind = hash2(seed + 9201, cell, k) < 0.5 ? 'tower' : 'collapse';
  const x = passageX(seed, cell, k) + LANDMARK_OFFSET;
  const top = interfaceTop(seed, cell);
  const bottom = interfaceBottom(seed, cell);
  const floor = interfaceTop(seed, cell + 1);
  const half = kind === 'collapse' ? collapseWidth(cell) / 2 : 0;
  return {
    kind, cell, k, x, top, bottom, floor,
    gapLeft: x - half,
    gapRight: x + half,
    baseY: bottom + ANTECHAMBER_DEPTH,
  };
}

/** 大構造が X 方向に占める範囲 [x0, x1) */
function spanOf(lm: Landmark): [number, number] {
  return lm.kind === 'tower' ? [lm.x - TOWER_HALF_WIDTH, lm.x + TOWER_HALF_WIDTH] : [lm.gapLeft, lm.gapRight];
}

/** 層 cell で x が幾何に掛かる大構造(無ければ null)。候補はスロット floor((x−160)/384) の両隣まで */
export function landmarkNear(seed: number, cell: number, x: number): Landmark | null {
  if (!isLandmarkLayer(cell)) return null;
  const k0 = Math.floor((x - LANDMARK_OFFSET) / PASSAGE_SLOT);
  for (let k = k0 - 1; k <= k0 + 1; k++) {
    const lm = landmarkAt(seed, cell, k);
    if (!lm) continue;
    const [x0, x1] = spanOf(lm);
    if (x >= x0 && x < x1) return lm;
  }
  return null;
}

/** 斜路の上面の行(HARD の最上段)。x ∈ [gapLeft, gapRight) */
export function rampTopY(lm: Landmark, x: number): number {
  return lm.baseY - Math.floor((x - lm.gapLeft) / COLLAPSE_SLOPE_RUN);
}

/** 塔の頂部の床 [x−6, x+6) にいるか(overlookCellAt が自動眺望の発火に使う) */
export function towerTopFloorAt(seed: number, cell: number, x: number): boolean {
  const lm = landmarkNear(seed, cell, x);
  return lm !== null && lm.kind === 'tower' && Math.abs(x - lm.x + 0.5) <= TOWER_TOP_HALF_WIDTH - 0.5;
}

function towerTileAt(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  const lx = x - (lm.x - TOWER_HALF_WIDTH);
  if (lx < 0 || lx >= TOWER_HALF_WIDTH * 2 || y >= lm.floor) return null;
  const dx = lx - TOWER_HALF_WIDTH;
  if (y < lm.top) {
    // 頂部の開口(板の上面の上 8 行、幅 12)。梯子は孔と同じく上面の 4 行上まで。32 タイル梯子列は残す
    if (y < lm.top - OVERLOOK_HEIGHT || Math.abs(dx + 0.5) > TOWER_TOP_HALF_WIDTH - 0.5) return null;
    if (x === groupLadderX(seed, x) || (dx === 0 && y >= lm.top - SHAFT_OVERHANG)) return TILE.LADDER;
    return TILE.AIR;
  }
  // 縦坑(板を貫く)
  if (Math.abs(dx) <= TOWER_SHAFT_HALF) return dx === 0 ? TILE.LADDER : TILE.AIR;
  // 基部の出入口
  if (y >= lm.floor - TOWER_BASE_ROWS) return TILE.AIR;
  // 環状通路(塔を横に貫く 3 行)
  const H = lm.floor - lm.bottom;
  for (let i = 1; i <= TOWER_RINGS; i++) {
    const yi = lm.bottom + Math.round((H * i) / (TOWER_RINGS + 1));
    if (y <= yi && y > yi - TOWER_RING_ROWS) return TILE.AIR;
  }
  return TILE.HARD;
}

function collapseTileAt(lm: Landmark, x: number, y: number): Tile | null {
  if (x < lm.gapLeft || x >= lm.gapRight || y < lm.top || y > lm.baseY) return null;
  return y >= rampTopY(lm, x) ? TILE.HARD : TILE.AIR;
}

/**
 * 大構造のタイル(属さなければ null)。塔の頂部の開口は板の上(cell−1 の層)に入るので、
 * biomeCellAt の cell とその +1 の両方を調べる。
 */
export function landmarkTileAt(seed: number, x: number, y: number): Tile | null {
  const c = biomeCellAt(seed, y);
  for (let cell = c; cell <= c + 1; cell++) {
    const lm = landmarkNear(seed, cell, x);
    if (!lm) continue;
    const t = lm.kind === 'tower' ? towerTileAt(seed, lm, x, y) : collapseTileAt(lm, x, y);
    if (t !== null) return t;
  }
  return null;
}
