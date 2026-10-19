import { biomeCellAt } from './biomeCells';
import {
  ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceThickness, interfaceTop, isGreatInterface, mod,
  OVERLOOK_HEIGHT, PASSAGE_SLOT, passageX, SHAFT_OVERHANG,
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
 *     板の上面で開口する(頂部は幅 12 の床で、見晴らし台と同じ高さに出る。上の層 cell−1 に属する。
 *     その上の空間は [x−12, x+52) × 8 行を空け、上の層へ続く 32 タイル梯子列を必ず含める)。
 *     内部に幅 3 の縦坑(中央 LADDER)、層の高さを 4 等分した 1/4・2/4・3/4 に塔を横に貫く通路 3 本、
 *     基部の 3 行は出入口。どの高さからでも内部の梯子へ入れる第二の登攀経路。
 * 崩落界面: 天井の板の一部が裂け、前室の床の行から板の上面まで階段状の楔(HARD)が流れている。
 *     通常の板は 2 列で 1 段(幅 2×(48+32)=160)、大界面(厚み 96)は 1 列で 1 段(幅 48+96=144)。
 *     2 列で 1 段のまま大界面を登ると幅 288 が要り、孔の最小間隔 256 に収まらず隣の孔の縦坑を切った(裁定)。
 *     1 列 1 段でもジャンプ(高さ 2.8)で 2 段ずつ登れる。楔の上は裂け目(AIR)。出口の上(板の上面の上 8 行、
 *     裂け目から右へ 12 列まで)は瓦礫が崩れ落ちた空間として空け、上の層の躯体が出口を塞がないようにする。
 */

/** 中心 X = 孔 X + 160(塔・崩落とも。前室 ±120 の縁の外) */
export const LANDMARK_OFFSET = 160;
/** 塔の半幅(幅 48) */
export const TOWER_HALF_WIDTH = 24;
/** 塔の頂部の床の半幅(幅 12。自動眺望の発火範囲) */
export const TOWER_TOP_HALF_WIDTH = 6;
/**
 * 頂部の上に空ける空間の X 範囲(中心からの相対、[−12, +52))。幅 64 で 32 タイルグループを必ず 1 つ丸ごと含み、
 * 上の層へ続く 32 タイル梯子列が 1 本入る(孔の見晴らし台 −12〜+72 と同じ保証)。幅 12 だけ空けると
 * 上の層の躯体で約 8% の塔の頂部が袋小路になった(レビューの走査)。
 */
export const TOWER_TOP_CLEAR_LEFT = 12;
export const TOWER_TOP_CLEAR_RIGHT = 52;
/** 塔の内部の縦坑の半幅(幅 3、中央 LADDER) */
export const TOWER_SHAFT_HALF = 1;
/** 環状通路の本数(層の高さを 4 等分した 1/4, 2/4, 3/4) */
export const TOWER_RINGS = 3;
/** 環状通路の高さ(行) */
export const TOWER_RING_ROWS = 3;
/** 基部の出入口(床の板の上 3 行) */
export const TOWER_BASE_ROWS = 3;
/** 斜路: 通常の板は 2 列で 1 段上がる(大界面は 1 列で 1 段) */
export const COLLAPSE_SLOPE_RUN = 2;
/** 出口の上の空間: 裂け目の右端からさらに右へ何列まで空けるか */
export const COLLAPSE_EXIT_WIDTH = 12;

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

/** 斜路の 1 段あたりの列数(通常 2、大界面 1) */
export function collapseRun(cell: number): number {
  return isGreatInterface(cell) ? 1 : COLLAPSE_SLOPE_RUN;
}

/** 崩落の幅 = 1 段の列数 × (前室の深さ + 板の厚み)。前室の床から板の上面へ届く長さ */
export function collapseWidth(cell: number): number {
  return collapseRun(cell) * (ANTECHAMBER_DEPTH + interfaceThickness(cell));
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
  return lm.kind === 'tower' ? [lm.x - TOWER_HALF_WIDTH, lm.x + TOWER_TOP_CLEAR_RIGHT] : [lm.gapLeft, lm.gapRight + COLLAPSE_EXIT_WIDTH];
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
  return lm.baseY - Math.floor((x - lm.gapLeft) / collapseRun(lm.cell));
}

/** 塔の頂部の床 [x−6, x+6) にいるか(梯子列 x === lm.x は除く。overlookCellAt が自動眺望の発火に使う) */
export function towerTopFloorAt(seed: number, cell: number, x: number): boolean {
  const lm = landmarkNear(seed, cell, x);
  return lm !== null && lm.kind === 'tower' && x !== lm.x && Math.abs(x - lm.x + 0.5) <= TOWER_TOP_HALF_WIDTH - 0.5;
}

function towerTileAt(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  const lx = x - (lm.x - TOWER_HALF_WIDTH);
  const dx = lx - TOWER_HALF_WIDTH;
  if (y < lm.top) {
    // 頂部の開口(板の上面の上 8 行、[x−12, x+52))。梯子は孔と同じく上面の 4 行上まで。32 タイル梯子列は残す
    if (y < lm.top - OVERLOOK_HEIGHT || dx < -TOWER_TOP_CLEAR_LEFT || dx >= TOWER_TOP_CLEAR_RIGHT) return null;
    if (x === groupLadderX(seed, x) || (dx === 0 && y >= lm.top - SHAFT_OVERHANG)) return TILE.LADDER;
    return TILE.AIR;
  }
  if (lx < 0 || lx >= TOWER_HALF_WIDTH * 2 || y >= lm.floor) return null;
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

function collapseTileAt(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  if (x < lm.gapLeft || y > lm.baseY || y < lm.top - OVERLOOK_HEIGHT) return null;
  if (y < lm.top) {
    // 出口の上の空間(裂け目と右へ 12 列)。32 タイル梯子列は残す
    if (x >= lm.gapRight + COLLAPSE_EXIT_WIDTH) return null;
    return x === groupLadderX(seed, x) ? TILE.LADDER : TILE.AIR;
  }
  if (x >= lm.gapRight) return null;
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
    const t = lm.kind === 'tower' ? towerTileAt(seed, lm, x, y) : collapseTileAt(seed, lm, x, y);
    if (t !== null) return t;
  }
  return null;
}
