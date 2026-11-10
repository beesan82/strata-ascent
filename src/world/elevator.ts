import { biomeCellAt, biomeIdForCell } from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { grandHallAt, hallChimneyAt } from './grandhall';
import {
  ANTECHAMBER_DEPTH, COMPRESSION_DEPTH, groupLadderX, interfaceBottom, interfaceTop, mod, PASSAGE_SLOT,
} from './interface';
import { landmarkAt, spanOf } from './landmark';
import { megaFacilityAt } from './megafacility';
import { hash2 } from './noise';
import { restPointBand } from './restpoint';
import { TILE, type Tile } from './tiles';

/**
 * 昇降機の縦シャフト(設計 2026-11-10-infrastructure §1)。地形生成のランドマークとして決定論で置く。純粋関数のみ。
 *
 * 置き方の裁定:
 * - 層 cell・孔スロット k ごとに hash で抽選し(ELEVATOR_RATE)、当たったスロットにだけ 1 本置く。
 * - 縦の範囲は層の下部: 休憩点の帯(層の 40〜60%)の下端から SHAFT_REST_CLEARANCE 以上下、床の板の上面から
 *   SHAFT_FLOOR_CLEARANCE 以上上。前室・圧縮帯(板の直下 108 行)、休憩点の箱、床の板の上の見晴らし台・大穴・
 *   塔の頂部の開口とは縦に離れる。
 * - 停止階は層の床帯の行(floorSpacing の倍数)に揃える。停止階の床は床帯の床と同じ高さになり、
 *   両脇の LANDING_REACH 列ぶんを床(SOLID)+ 頭上 3 行の空気として彫って既存の床へつなぐ。
 * - 横はスロットの中の 32 タイルグループ 4〜7 番の 1 つ。32 タイル梯子列を踏まない側(グループの左寄りか
 *   右寄り)に壁ごと収める。大構造(塔・大桁橋・吹き抜け・崩落)の X 範囲、大広間とその煙突、メガ施設に
 *   掛かるスロットでは置かない(抽選に当たっても棄却)。
 * - 壁は通常の SOLID(重粒子砲で掘れる)。途中の床帯の行ごとに壁へ 3 行の出入口を空け、横の通り道を
 *   断たない(シャフトに落ちても下の停止階の床か足場に着く。閉じ込めない)。
 *
 * 幾何(x0 は内側の左端列、yTop / yBottom は上下の停止階の床の行):
 *   内側 [x0, x0+4): 天井 yTop−4 は SOLID、[yTop−3, yBottom) は AIR(上の停止階の床の行も AIR =
 *     足場の通り道)、底 yBottom は SOLID(下の停止階では足場の上面と床面が同じ高さ)
 *   壁 x0−1 と x0+4: [yTop−4, yBottom] は SOLID、ただし各床帯の行 ym の上 3 行は出入口(AIR)
 *   乗り場(壁の外 LANDING_REACH 列): 停止階の行は SOLID、その上 3 行は AIR。他の行は地形のまま(null)
 */

/** シャフトを置くスロットの割合(抽選。大構造などとの重なりでさらに棄却される) */
export const ELEVATOR_RATE = 0.45;
const ELEVATOR_SALT = 9401;
/** 内側の幅(タイル)。足場の幅も同じ */
export const SHAFT_WIDTH = 4;
/** 停止階の両脇に彫る乗り場の長さ(壁の外側の列数) */
export const LANDING_REACH = 6;
/** 出入口・乗り場の空気の行数 */
export const SHAFT_DOOR_ROWS = 3;
/** 縦の長さの目安(タイル)。床帯の間隔に丸める */
export const SHAFT_MIN_HEIGHT = 24;
export const SHAFT_MAX_HEIGHT = 48;
/** 停止階どうしの最小の高さ(床帯 2 本ぶんでも、これに満たなければ置かない) */
export const SHAFT_MIN_SPAN = 12;
/** 下の停止階は床の板の上面からこれ以上(+ hash で最大 15)上 */
export const SHAFT_FLOOR_CLEARANCE = 16;
/** シャフトの天井は休憩点の帯の下端からこれ以上下 */
export const SHAFT_REST_CLEARANCE = 8;
/** 大広間・煙突・大構造との除外の余白(タイル) */
const SHAFT_MARGIN = 4;

export interface ElevatorShaft {
  /** `e:cell,k` */
  id: string;
  cell: number;
  k: number;
  /** 内側の左端列(足場の左端) */
  x0: number;
  /** 上の停止階の床の行(足場がここまで上がると上面が床面と揃う) */
  yTop: number;
  /** 下の停止階の床の行(シャフトの底) */
  yBottom: number;
  /** 床帯の間隔(途中の出入口の周期) */
  spacing: number;
}

/** シャフトが地形を決める範囲 [x0, x1) × [y0, y1)(乗り場と天井を含む) */
export function shaftBounds(s: ElevatorShaft): { x0: number; x1: number; y0: number; y1: number } {
  return {
    x0: s.x0 - 1 - LANDING_REACH,
    x1: s.x0 + SHAFT_WIDTH + 1 + LANDING_REACH,
    y0: s.yTop - SHAFT_DOOR_ROWS - 1,
    y1: s.yBottom + 1,
  };
}

function rectsOverlap(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number },
  margin: number,
): boolean {
  return a.x0 < b.x1 + margin && a.x1 + margin > b.x0 && a.y0 < b.y1 + margin && a.y1 + margin > b.y0;
}

/** 抽選と除外の本体(メモ化なし) */
function computeShaft(seed: number, cell: number, k: number): ElevatorShaft | null {
  if (hash2(seed + ELEVATOR_SALT, cell, k) >= ELEVATOR_RATE) return null;
  const sp = terrainProfileFor(biomeIdForCell(seed, cell)).floorSpacing;
  const bottom = interfaceBottom(seed, cell);
  const floor = interfaceTop(seed, cell + 1);
  // 天井(yTop − 4)が越えてはいけない上限: 休憩点の帯の下と、前室・圧縮帯の下のうち深い方
  const ceilingMin = Math.max(
    restPointBand(seed, cell).y1 + SHAFT_REST_CLEARANCE,
    bottom + ANTECHAMBER_DEPTH + COMPRESSION_DEPTH + SHAFT_MARGIN,
  );
  const maxBottom = floor - SHAFT_FLOOR_CLEARANCE - Math.floor(hash2(seed + ELEVATOR_SALT + 1, cell, k) * 16);
  const yBottom = Math.floor(maxBottom / sp) * sp;
  const want = SHAFT_MIN_HEIGHT + Math.floor(hash2(seed + ELEVATOR_SALT + 2, cell, k) * (SHAFT_MAX_HEIGHT - SHAFT_MIN_HEIGHT + 1));
  let n = Math.max(2, Math.round(want / sp));
  while (n >= 2 && yBottom - n * sp - SHAFT_DOOR_ROWS - 1 < ceilingMin) n--;
  if (n < 2 || n * sp < SHAFT_MIN_SPAN) return null;
  const yTop = yBottom - n * sp;
  // 横: グループ 4〜7 番の 1 つ。梯子列がグループの右半分なら左寄り、左半分なら右寄りに壁ごと収める
  const g = k * (PASSAGE_SLOT / 32) + 4 + Math.floor(hash2(seed + ELEVATOR_SALT + 3, cell, k) * 4);
  const gx = g * 32;
  const x0 = groupLadderX(seed, gx) - gx >= 16 ? gx + 3 : gx + 25;
  const s: ElevatorShaft = { id: `e:${cell},${k}`, cell, k, x0, yTop, yBottom, spacing: sp };
  const b = shaftBounds(s);
  // 大構造(どの種も層の高さ全体を占め得るので X 範囲だけで除外する)
  for (let kk = k - 1; kk <= k + 1; kk++) {
    const lm = landmarkAt(seed, cell, kk);
    if (!lm) continue;
    const [lx0, lx1] = spanOf(lm);
    if (b.x0 < lx1 + SHAFT_MARGIN && b.x1 + SHAFT_MARGIN > lx0) return null;
  }
  // 大広間と煙突(下の層の広間の煙突はこの層へ伸びてくる)
  const hall = grandHallAt(seed, cell);
  if (hall && rectsOverlap(b, hall, SHAFT_MARGIN)) return null;
  for (const c of [cell, cell + 1]) {
    const chim = hallChimneyAt(seed, c);
    if (chim && rectsOverlap(b, chim, SHAFT_MARGIN)) return null;
  }
  // メガ施設(一辺 192 > シャフトの外形なので、8 タイル刻みの格子と四隅の標本で重なりを見る)
  for (let y = b.y0; ; y = Math.min(y + 8, b.y1 - 1)) {
    for (let x = b.x0; ; x = Math.min(x + 8, b.x1 - 1)) {
      if (megaFacilityAt(seed, x, y) !== null) return null;
      if (x === b.x1 - 1) break;
    }
    if (y === b.y1 - 1) break;
  }
  return s;
}

/** メモ(チャンク生成はタイルごとに引くため)。キーは数値で割り当てを避ける。際限なく伸びないよう溢れたら捨てる */
const memo = new Map<number, ElevatorShaft | null>();
let memoSeed = NaN;
const MEMO_LIMIT = 512;

/** 層 cell・スロット k の昇降機シャフト。置かれないスロットでは null */
export function elevatorShaftAt(seed: number, cell: number, k: number): ElevatorShaft | null {
  if (seed !== memoSeed) {
    memo.clear();
    memoSeed = seed;
  }
  // cell・k は高々 ±数万なので 2^20 の幅で 1 つの数に詰める(安全な整数の範囲)
  const key = cell * 1048576 + k;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const s = computeShaft(seed, cell, k);
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, s);
  return s;
}

/** 途中・両端の床帯の行 ym の上 3 行(壁の出入口)か */
function isDoorRow(s: ElevatorShaft, y: number): boolean {
  if (y < s.yTop - SHAFT_DOOR_ROWS || y >= s.yBottom) return false;
  return mod(y - s.yTop, s.spacing) >= s.spacing - SHAFT_DOOR_ROWS;
}

/** シャフト 1 本が決める (x, y) のタイル(範囲外・乗り場の他の行は null) */
export function shaftTileAt(s: ElevatorShaft, x: number, y: number): Tile | null {
  const b = shaftBounds(s);
  if (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1) return null;
  const wallL = s.x0 - 1;
  const wallR = s.x0 + SHAFT_WIDTH;
  if (x > wallL && x < wallR) {
    if (y === b.y0 || y === s.yBottom) return TILE.SOLID;
    return TILE.AIR;
  }
  if (x === wallL || x === wallR) return isDoorRow(s, y) ? TILE.AIR : TILE.SOLID;
  for (const stop of [s.yTop, s.yBottom]) {
    if (y === stop) return TILE.SOLID;
    if (y >= stop - SHAFT_DOOR_ROWS && y < stop) return TILE.AIR;
  }
  return null;
}

/**
 * 昇降機のタイル(シャフトに属さなければ null)。cell は呼び出し側で計算済みなら渡す。
 * シャフトの外形はスロットの中(グループ 4〜7 番 ± 乗り場)に収まるので、x のスロットだけを引けば足りる
 */
export function elevatorTileAt(seed: number, x: number, y: number, cell: number = biomeCellAt(seed, y)): Tile | null {
  const s = elevatorShaftAt(seed, cell, Math.floor(x / PASSAGE_SLOT));
  return s ? shaftTileAt(s, x, y) : null;
}

/** (x, y) の周り(横 ±rx、縦 ±ry)に外形が掛かるシャフトを列挙する */
export function elevatorsNear(seed: number, x: number, y: number, rx: number, ry: number): ElevatorShaft[] {
  const out: ElevatorShaft[] = [];
  const c0 = biomeCellAt(seed, Math.floor(y - ry));
  const c1 = biomeCellAt(seed, Math.floor(y + ry));
  const k0 = Math.floor((x - rx) / PASSAGE_SLOT);
  const k1 = Math.floor((x + rx) / PASSAGE_SLOT);
  for (let c = c0; c <= c1; c++) {
    for (let k = k0; k <= k1; k++) {
      const s = elevatorShaftAt(seed, c, k);
      if (!s) continue;
      const b = shaftBounds(s);
      if (b.x1 > x - rx && b.x0 < x + rx && b.y1 > y - ry && b.y0 < y + ry) out.push(s);
    }
  }
  return out;
}
