import { biomeCellAt, biomeIdForCell, type BiomeId } from './biomeCells';
import {
  ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceThickness, interfaceTop, isGreatInterface, mod,
  OVERLOOK_HEIGHT, PASSAGE_SLOT, passageX, SHAFT_OVERHANG,
} from './interface';
import { hash2 } from './noise';
import { TILE, type Tile } from './tiles';

/**
 * 大構造(設計書 §5.5、ゾーン化 段階 2 で地区変種 + 保証配置へ拡張)。
 * 孔スロット 3 個のグループにちょうど 1 基を hash で決定論選択し(保証配置、設計 §4.1)、
 * 種は層の地区で固定する(設計 §2.3 ③)。純粋関数のみ。
 *
 * 座標の約束: 層 cell は [interfaceTop(cell), interfaceTop(cell+1))。天井の板が cell、床の板が cell+1。
 * 「孔 X」は天井の板(cell)の孔 passageX(seed, cell, k)。
 *
 * 塔系(冷却塔・変圧塔・煙突塔・椎骨柱): HARD の柱。床の板の上面(interfaceTop(cell+1))から立ち、
 *     天井の板(cell)を貫いて板の上面で開口する(頂部は幅 12 の床で、見晴らし台と同じ高さに出る。
 *     上の層 cell−1 に属する。その上の空間は [x−12, x+52) × 8 行を空け、上の層へ続く
 *     32 タイル梯子列を必ず含める)。内部に縦坑(中央 LADDER)、環状通路(踊り場)、
 *     基部の 3 行は出入口。どの高さからでも内部の梯子へ入れる第二の登攀経路。
 *     変種: 冷却塔=幅 64・踊り場なし(梯子のみ)、変圧塔=環状通路 6 本、煙突塔=幅 40・縦坑幅 5・
 *     環状通路 2 本、椎骨柱=梯子列が 4 行ごとに ±1 列うねる(縦坑の空気も付いてくる)。
 * 大桁橋(寒鋼基層): 層の 4 割の高さに橋床(3 行)が 80 タイル渡り、支持柱が 16 間隔で床まで届く。
 *     梯子列は塞がない(橋床・支持柱とも梯子列の列では口を出さない)。
 * 吹き抜けホール(居住区画): 幅 62 の大きな開口。両端に柱 2 列、上部 6 行はアーチ帯
 *     (中央から ±8 で始まり 1 行ごとに ±4 広がる)。梯子列は残す(内部の上昇路)。
 * 崩落界面(廃棄沈殿層): 天井の板の一部が裂け、前室の床の行から板の上面まで階段状の楔(HARD)が
 *     流れている。通常の板は 2 列で 1 段(幅 2×(48+32)=160)、大界面(厚み 96)は 1 列で 1 段
 *     (幅 48+96=144)。2 列で 1 段のまま大界面を登ると幅 288 が要り、孔の最小間隔 256 に
 *     収まらず隣の孔の縦坑を切った(裁定)。1 列 1 段でもジャンプ(高さ 2.8)で 2 段ずつ登れる。
 *     楔の上は裂け目(AIR)。出口の上(板の上面の上 8 行、裂け目から右へ 12 列まで)は瓦礫が
 *     崩れ落ちた空間として空け、上の層の躯体が出口を塞がないようにする。
 */

/** 中心 X = 孔 X + 160(全種共通。前室 ±120 の縁の外) */
export const LANDMARK_OFFSET = 160;
/** 保証配置: 孔スロット何個のグループにちょうど 1 基置くか */
export const LANDMARK_GROUP = 3;
/** 変圧塔・椎骨柱の半幅(幅 48。従来の塔と同じ) */
export const TOWER_HALF_WIDTH = 24;
/** 塔系の頂部の床の半幅(幅 12。自動眺望の発火範囲) */
export const TOWER_TOP_HALF_WIDTH = 6;
/**
 * 頂部の上に空ける空間の X 範囲(中心からの相対、[−12, +52))。幅 64 で 32 タイルグループを必ず 1 つ丸ごと含み、
 * 上の層へ続く 32 タイル梯子列が 1 本入る(孔の見晴らし台 −12〜+72 と同じ保証)。幅 12 だけ空けると
 * 上の層の躯体で約 8% の塔の頂部が袋小路になった(レビューの走査)。
 */
export const TOWER_TOP_CLEAR_LEFT = 12;
export const TOWER_TOP_CLEAR_RIGHT = 52;
/** 塔系の内部の縦坑の半幅(幅 3、中央 LADDER) */
export const TOWER_SHAFT_HALF = 1;
/** 環状通路の本数(椎骨柱。層の高さを等分した位置に置く) */
export const TOWER_RINGS = 3;
/** 環状通路の高さ(行) */
export const TOWER_RING_ROWS = 3;
/** 基部の出入口(床の板の上 3 行) */
export const TOWER_BASE_ROWS = 3;
/** 冷却塔の半幅(幅 64) */
export const COOLING_HALF_WIDTH = 32;
/** 変圧塔の環状通路の本数(踊り場が多い) */
export const TRANSFORMER_RINGS = 6;
/** 煙突塔の半幅(幅 40)と縦坑の半幅(幅 5)、環状通路の本数 */
export const CHIMNEY_HALF_WIDTH = 20;
export const CHIMNEY_SHAFT_HALF = 2;
export const CHIMNEY_RINGS = 2;
/** 椎骨柱: 梯子列が ±1 列ずれる行数 */
export const VERTEBRA_SWAY_ROWS = 4;
/** 大桁橋の半幅(全幅 80)、橋床の厚み、支持柱の間隔、橋床の上に空ける行数 */
export const GIRDER_HALF_SPAN = 40;
export const GIRDER_DECK_ROWS = 3;
export const GIRDER_MEMBER_EVERY = 16;
export const GIRDER_CLEAR_ROWS = 3;
/** 吹き抜けホールの半幅(全幅 62)、柱の幅、アーチ帯の高さ */
export const ATRIUM_HALF_WIDTH = 31;
export const ATRIUM_PILLAR_WIDTH = 2;
export const ATRIUM_ARCH_ROWS = 6;
/** 斜路: 通常の板は 2 列で 1 段上がる(大界面は 1 列で 1 段) */
export const COLLAPSE_SLOPE_RUN = 2;
/** 出口の上の空間: 裂け目の右端からさらに右へ何列まで空けるか */
export const COLLAPSE_EXIT_WIDTH = 12;

export type LandmarkKind = 'girder' | 'atrium' | 'collapse' | 'cooling' | 'transformer' | 'chimney' | 'vertebra';

/** 地区 → 固有ランドマークの種(設計 §2.3 ③。種は地区で固定) */
export const LANDMARK_KIND_FOR: Record<BiomeId, LandmarkKind> = {
  coldSteel: 'girder',
  habitation: 'atrium',
  disposal: 'collapse',
  waterVoid: 'cooling',
  power: 'transformer',
  foundry: 'chimney',
  biomech: 'vertebra',
};

/** 塔系(縦坑を登って頂部の床に出る種)か */
export function isTowerFamily(kind: LandmarkKind): boolean {
  return kind === 'cooling' || kind === 'transformer' || kind === 'chimney' || kind === 'vertebra';
}

export interface TowerSpec {
  halfWidth: number;
  shaftHalf: number;
  rings: number;
}

const TOWER_SPEC: Partial<Record<LandmarkKind, TowerSpec>> = {
  cooling: { halfWidth: COOLING_HALF_WIDTH, shaftHalf: TOWER_SHAFT_HALF, rings: 0 },
  transformer: { halfWidth: TOWER_HALF_WIDTH, shaftHalf: TOWER_SHAFT_HALF, rings: TRANSFORMER_RINGS },
  chimney: { halfWidth: CHIMNEY_HALF_WIDTH, shaftHalf: CHIMNEY_SHAFT_HALF, rings: CHIMNEY_RINGS },
  vertebra: { halfWidth: TOWER_HALF_WIDTH, shaftHalf: TOWER_SHAFT_HALF, rings: TOWER_RINGS },
};

/** 塔系の寸法(塔系でなければ null) */
export function towerSpec(kind: LandmarkKind): TowerSpec | null {
  return TOWER_SPEC[kind] ?? null;
}

export interface Landmark {
  kind: LandmarkKind;
  cell: number;
  k: number;
  /** 中心 X = passageX(seed, cell, k) + 160 */
  x: number;
  /** interfaceTop(seed, cell)(板の上面 = 塔系の頂部の床 / 崩落の上端) */
  top: number;
  /** interfaceBottom(seed, cell) */
  bottom: number;
  /** interfaceTop(seed, cell+1)(基部が立つ床の板の上面) */
  floor: number;
  /** 固有の広がりの左端(含む)。崩落は裂け目の左端、大桁橋・ホールは外形の左端、塔系は殻の左端 */
  gapLeft: number;
  /** 固有の広がりの右端(排他)。意味は gapLeft と対 */
  gapRight: number;
  /** 崩落は斜路の足の行 = bottom + 48(前室の床の行)。大桁橋は橋床の上面の行。その他は floor */
  baseY: number;
}

/** 斜路の 1 段あたりの列数(通常 2、大界面 1) */
export function collapseRun(cell: number): number {
  return isGreatInterface(cell) ? 1 : COLLAPSE_SLOPE_RUN;
}

/** 崩落の幅 = 1 段の列数 × (前室の深さ + 板の厚み)。前室の床から板の上面へ届く長さ */
export function collapseWidth(cell: number): number {
  return collapseRun(cell) * (ANTECHAMBER_DEPTH + interfaceThickness(cell));
}

/** 大桁橋の橋床の上面の行(層の内側の 4 割の高さ) */
export function girderDeckY(bottom: number, floor: number): number {
  return bottom + Math.round(((floor - bottom) * 2) / 5);
}

/** 大桁橋の橋床の上面の行 */
export function girderY(lm: Landmark): number {
  return girderDeckY(lm.bottom, lm.floor);
}

/** 椎骨柱のうねり: 行 y での梯子列の中心からのずれ(4 行ごとに 0 → +1 → 0 → −1)。頂部付近(y < top)は 0 */
export function vertebraSway(lm: Landmark, y: number): number {
  if (y < lm.top) return 0;
  const block = Math.floor((y - lm.top) / VERTEBRA_SWAY_ROWS);
  return [0, 1, 0, -1][mod(block, 4)];
}

/** 行 y での縦坑の梯子列の X(塔系以外は中心のまま) */
export function shaftLadderX(lm: Landmark, y: number): number {
  return lm.kind === 'vertebra' ? lm.x + vertebraSway(lm, y) : lm.x;
}

/** 層 cell・スロット k の大構造。グループ内で選ばれたスロットでなければ null */
export function landmarkAt(seed: number, cell: number, k: number): Landmark | null {
  const g = Math.floor(k / LANDMARK_GROUP);
  const chosen = Math.floor(hash2(seed + 9201, cell, g) * LANDMARK_GROUP);
  if (k - g * LANDMARK_GROUP !== chosen) return null;
  const kind = LANDMARK_KIND_FOR[biomeIdForCell(seed, cell)];
  const x = passageX(seed, cell, k) + LANDMARK_OFFSET;
  const top = interfaceTop(seed, cell);
  const bottom = interfaceBottom(seed, cell);
  const floor = interfaceTop(seed, cell + 1);
  let gapLeft = x;
  let gapRight = x;
  let baseY = floor;
  if (kind === 'collapse') {
    const half = collapseWidth(cell) / 2;
    gapLeft = x - half;
    gapRight = x + half;
    baseY = bottom + ANTECHAMBER_DEPTH;
  } else if (kind === 'girder') {
    gapLeft = x - GIRDER_HALF_SPAN;
    gapRight = x + GIRDER_HALF_SPAN;
    baseY = girderDeckY(bottom, floor);
  } else if (kind === 'atrium') {
    gapLeft = x - ATRIUM_HALF_WIDTH;
    gapRight = x + ATRIUM_HALF_WIDTH;
  } else {
    const half = towerSpec(kind)!.halfWidth;
    gapLeft = x - half;
    gapRight = x + half;
  }
  return { kind, cell, k, x, top, bottom, floor, gapLeft, gapRight, baseY };
}

/** 大構造が X 方向に占める範囲 [x0, x1) */
function spanOf(lm: Landmark): [number, number] {
  if (isTowerFamily(lm.kind)) return [lm.gapLeft, lm.x + TOWER_TOP_CLEAR_RIGHT];
  return lm.kind === 'collapse' ? [lm.gapLeft, lm.gapRight + COLLAPSE_EXIT_WIDTH] : [lm.gapLeft, lm.gapRight];
}

/** 層 cell で x が幾何に掛かる大構造(無ければ null)。候補はスロット floor((x−160)/384) の両隣まで */
export function landmarkNear(seed: number, cell: number, x: number): Landmark | null {
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

/** 塔系の頂部の床 [x−6, x+6) にいるか(梯子列 x === lm.x は除く。overlookCellAt が自動眺望の発火に使う) */
export function towerTopFloorAt(seed: number, cell: number, x: number): boolean {
  const lm = landmarkNear(seed, cell, x);
  return lm !== null && isTowerFamily(lm.kind) && x !== lm.x && Math.abs(x - lm.x + 0.5) <= TOWER_TOP_HALF_WIDTH - 0.5;
}

function towerTileAt(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  const spec = towerSpec(lm.kind)!;
  const half = spec.halfWidth;
  const lx = x - (lm.x - half);
  const dx = lx - half;
  if (y < lm.top) {
    // 頂部の開口(板の上面の上 8 行、[x−12, x+52))。梯子は孔と同じく上面の 4 行上まで。32 タイル梯子列は残す
    if (y < lm.top - OVERLOOK_HEIGHT || dx < -TOWER_TOP_CLEAR_LEFT || dx >= TOWER_TOP_CLEAR_RIGHT) return null;
    if (x === groupLadderX(seed, x) || (dx === 0 && y >= lm.top - SHAFT_OVERHANG)) return TILE.LADDER;
    return TILE.AIR;
  }
  if (lx < 0 || lx >= half * 2 || y >= lm.floor) return null;
  // 縦坑(板を貫く)。椎骨柱は梯子列がうねり、縦坑の空気も付いてくる
  const ldx = lm.kind === 'vertebra' ? vertebraSway(lm, y) : 0;
  if (Math.abs(dx - ldx) <= spec.shaftHalf) return dx === ldx ? TILE.LADDER : TILE.AIR;
  // 基部の出入口
  if (y >= lm.floor - TOWER_BASE_ROWS) return TILE.AIR;
  // 環状通路(塔を横に貫く 3 行)
  const H = lm.floor - lm.bottom;
  for (let i = 1; i <= spec.rings; i++) {
    const yi = lm.bottom + Math.round((H * i) / (spec.rings + 1));
    if (y <= yi && y > yi - TOWER_RING_ROWS) return TILE.AIR;
  }
  return TILE.HARD;
}

function girderTileAt(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  if (x === groupLadderX(seed, x)) return null; // 梯子列は残す(橋床・支持柱で塞がない)
  if (x < lm.gapLeft || x >= lm.gapRight || y < lm.bottom || y >= lm.floor) return null;
  const gy = girderY(lm);
  if (y >= gy && y < gy + GIRDER_DECK_ROWS) return TILE.HARD;
  // 橋床の上は歩けるよう空ける(地形の塊に埋まると橋にならない)
  if (y >= gy - GIRDER_CLEAR_ROWS && y < gy) return TILE.AIR;
  // 支持柱: 左端 +8 から 16 間隔、幅 3。橋床の下だけ
  const rel = x - (lm.gapLeft + 8);
  if (y > gy + GIRDER_DECK_ROWS - 1 && rel >= 0 && rel % GIRDER_MEMBER_EVERY < 3) return TILE.HARD;
  return null;
}

function atriumTileAt(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  if (x === groupLadderX(seed, x)) return null; // 梯子列は残す(内部の上昇路)
  const lx = x - lm.gapLeft;
  if (lx < 0 || lx >= ATRIUM_HALF_WIDTH * 2 || y < lm.bottom || y >= lm.floor) return null;
  // 柱(両端 2 列)
  if (lx < ATRIUM_PILLAR_WIDTH || lx >= ATRIUM_HALF_WIDTH * 2 - ATRIUM_PILLAR_WIDTH) return TILE.HARD;
  // アーチ帯(上部 6 行): 中央から ±8 で始まり 1 行ごとに ±4 広がる。外側は躯体のまま
  const r = y - lm.bottom;
  if (r < ATRIUM_ARCH_ROWS) {
    const dx = x - lm.x;
    return Math.abs(dx) <= 8 + r * 4 ? TILE.AIR : TILE.HARD;
  }
  return TILE.AIR;
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

function tileOf(seed: number, lm: Landmark, x: number, y: number): Tile | null {
  return lm.kind === 'collapse' ? collapseTileAt(seed, lm, x, y)
    : lm.kind === 'girder' ? girderTileAt(seed, lm, x, y)
    : lm.kind === 'atrium' ? atriumTileAt(seed, lm, x, y)
    : towerTileAt(seed, lm, x, y);
}

/**
 * 2 つの大構造の主張の合成(保証配置で全層に大構造があり、板の上の 8 行帯では上の層の
 * 底部(支持柱・殻・縦坑)と下の層の開口・出口が重なるため)。
 * LADDER は常に残り(梯子列・縦坑・張り出しはどの構造も塞がない)、HARD は AIR に勝つ
 * (開口の中に柱が立つことはあっても、開口が構造を消すことはない)。
 */
function composeTiles(a: Tile | null, b: Tile | null): Tile | null {
  if (a === TILE.LADDER || b === TILE.LADDER) return TILE.LADDER;
  if (a === TILE.HARD || b === TILE.HARD) return TILE.HARD;
  return a ?? b;
}

/**
 * 大構造のタイル(属さなければ null)。塔系の頂部の開口と崩落の出口の空間は板の上(cell−1 の層)に
 * 入るので、biomeCellAt の cell とその +1 の両方を調べ、主張を composeTiles で合成する。
 */
export function landmarkTileAt(seed: number, x: number, y: number): Tile | null {
  const c = biomeCellAt(seed, y);
  let result: Tile | null = null;
  for (let cell = c; cell <= c + 1; cell++) {
    const lm = landmarkNear(seed, cell, x);
    if (!lm) continue;
    result = composeTiles(result, tileOf(seed, lm, x, y));
  }
  return result;
}
