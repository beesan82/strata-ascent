import { biomeCellAt, biomeIdForCell } from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { elevatorShaftAt, SHAFT_DOOR_ROWS, SHAFT_FLOOR_CLEARANCE, SHAFT_REST_CLEARANCE, shaftBounds } from './elevator';
import { grandHallAt, hallChimneyAt } from './grandhall';
import {
  ANTECHAMBER_DEPTH, ANTECHAMBER_HALF_WIDTH, COMPRESSION_DEPTH, groupLadderX, interfaceBottom, interfaceTop, mod,
  PASSAGE_SLOT, passageX,
} from './interface';
import { landmarkAt, spanOf } from './landmark';
import { megaFacilityAt } from './megafacility';
import { hash2 } from './noise';
import { REST_HEIGHT, restPointAt, restPointBand } from './restpoint';
import { TILE, type Tile } from './tiles';

/**
 * 大昇降機(グランドシャフト、設計 2026-11-12-mega-structures)。複数の層 cell を貫く 300〜600 タイル級の
 * 縦シャフトを、稀なランドマークとして決定論で置く。純粋関数のみ。
 *
 * 置き方の裁定:
 * - 抽選の単位は「列バンド(孔スロット GRAND_BAND_SLOTS 個ぶんの X の帯)× cell グループ(GRAND_GROUP_CELLS 個の
 *   連続する層)」。当たった組にだけ 1 本置く。グループの中で開始 cell を hash で選び、下向きに続く cell へ
 *   同じ列で貫く。外形はバンドとグループの内側に収めるので、タイルの判定は (x のバンド, y の cell のグループ)
 *   の 1 組だけを引けば足りる(シャフトどうしは重ならない)。
 * - 通常の昇降機(elevatorShaftAt)とは別の抽選(別の salt)。通常の昇降機と重なる候補は大昇降機の側で棄却する。
 * - 縦: 上の停止階は開始 cell の休憩点の帯・前室・圧縮帯より下、床の板より GRAND_TOP_CLEARANCE 以上上。
 *   長さは GRAND_MIN_LENGTH〜GRAND_MAX_LENGTH を hash で決め、下の停止階は終わりの cell の床帯の行に丸める
 *   (板の下から GRAND_BOTTOM_DEPTH 以上下、床の板の上面から SHAFT_FLOOR_CLEARANCE 以上上)。
 * - 途中駅: 貫く板(界面)ごとに 2 段。板の上面(上の層の底)と、板の下面の直下の床帯の行(下の層の頭)。
 * - 横: バンドの中から hash で選んだ 32 タイルグループに、梯子列を踏まない側へ壁ごと収める(通常の昇降機と
 *   同じ流儀)。候補は GRAND_TRIES 個まで順に試し、次の重なりがあれば棄却して次の候補へ進む:
 *   貫く板の孔(縦坑・見晴らし台・大穴・前室の芯 ±ANTECHAMBER_HALF_WIDTH)、各 cell の大構造の X 範囲・
 *   休憩点の箱・大広間と煙突・通常の昇降機、メガ施設(8 タイル格子の標本)。
 * - 詰みなし: 停止階の乗り場は、梯子列の側では自分のグループの梯子列まで延ばす(梯子列は層の高さ全体を
 *   通る上昇路なので、どの停止階からも層の経路網へ出られる)。壁は床帯の行ごとに出入口を空ける(通常の
 *   昇降機と同じ)。シャフトに落ちても足場か下の停止階に着き、落下の被害は無い。
 * - 板を貫く: 内側は板の行でも AIR(足場の通り道)、壁と板の上面の乗り場の床は板の不壊(HARD)のまま
 *   (worldgen の合成で、大昇降機の SOLID が板の HARD に当たる位置は HARD を残す)。
 * - 眺望区間: 一定間隔(GRAND_VISTA_EVERY)で両側の壁を GRAND_VISTA_ROWS 行ぶん抜き、外へ GRAND_VISTA_REACH 列の
 *   張り出し(床と庇)を彫る。空気の背後には遠景(超構造のシルエット)が透けて見える。板・停止階の近くには置かない。
 *
 * 幾何(x0 は内側の左端列、yTop / yBottom は上下の停止階の床の行):
 *   内側 [x0, x0+W): 天井 yTop−4 は SOLID、[yTop−3, yBottom) は AIR、底 yBottom は SOLID
 *   壁 x0−1 と x0+W: [yTop−4, yBottom] は SOLID。停止階の上 3 行・床帯の行の上 3 行・眺望区間は AIR
 *   乗り場(停止階ごと): [landL, x0−1) と (x0+W, landR] の停止階の行は SOLID、その上 3 行は AIR
 *   梯子列(groupLadderX)は壁の外では常に null を返して地形(梯子)に任せる
 */

/** 列バンドの幅(孔スロットの数)。バンドの X 範囲は [band × GRAND_BAND_WIDTH, (band+1) × GRAND_BAND_WIDTH) */
export const GRAND_BAND_SLOTS = 8;
export const GRAND_BAND_WIDTH = GRAND_BAND_SLOTS * PASSAGE_SLOT;
/** cell グループの大きさ(連続する層の数)。グループ g は cell [g × 3, g × 3 + 2] */
export const GRAND_GROUP_CELLS = 3;
/** 列バンド × cell グループの組ごとの抽選の当たり率(さらに重なりで棄却される)。帯ごとに 1 本出るか出ないか */
export const GRAND_RATE = 0.5;
/** 横の候補を何個まで試すか */
export const GRAND_TRIES = 8;
/** 長さ(上下の停止階の距離、タイル) */
export const GRAND_MIN_LENGTH = 300;
export const GRAND_MAX_LENGTH = 600;
/** 内側の幅(足場の幅も同じ) */
export const GRAND_WIDTH = 6;
/** 梯子列の反対側の乗り場の長さ(壁の外の列数) */
export const GRAND_LANDING_REACH = 8;
/** 上の停止階は開始 cell の床の板の上面からこれ以上上 */
export const GRAND_TOP_CLEARANCE = 48;
/** 下の停止階は終わりの cell の天井の板の下面からこれ以上下 */
export const GRAND_BOTTOM_DEPTH = 64;
/** 板の直下の途中駅: 乗り場の空気が板に掛からない最小の深さ(板の下面からの行数) */
export const GRAND_BELOW_PLATE = SHAFT_DOOR_ROWS + 1;
/** 眺望区間: 最初の位置(上の停止階から)、間隔、抜く行数、外への張り出し、板・停止階からの離れ */
export const GRAND_VISTA_FIRST = 40;
export const GRAND_VISTA_EVERY = 80;
export const GRAND_VISTA_ROWS = 10;
export const GRAND_VISTA_REACH = 12;
export const GRAND_VISTA_CLEAR = 8;
/** 灯の列の間隔(行)。灯は両側の壁の内側の面、間隔の半分の位相の行に置く */
export const GRAND_LAMP_EVERY = 12;
/** 途中駅(板ごと)に設備(休憩所・端末・補給)が付く割合 */
export const GRAND_AMENITY_RATE = 0.5;
/** 孔からの離れ(外形の端まで)。前室の芯(梯子の抑止・連続床)と界面の縦坑・見晴らし台・大穴を避ける */
export const GRAND_PASSAGE_CLEAR = ANTECHAMBER_HALF_WIDTH + 4;
/** 大構造・休憩点・大広間・通常の昇降機との除外の余白 */
const GRAND_MARGIN = 4;
const GRAND_SALT = 9551;
/** バンドのスロットの中で候補にする 32 タイルグループ(9〜14 番 = スロットの境目付近。孔と大構造の間が空きやすい) */
const CANDIDATE_GROUP_MIN = 9;
const CANDIDATE_GROUP_COUNT = 6;

export type GrandAmenity = 'rest' | 'terminal' | 'supply';

/** 途中駅(貫く板 1 枚ごと) */
export interface GrandStation {
  /** 板の cell(板の上面 = interfaceTop(cell)) */
  cell: number;
  /** 板の上面の停止階(上の層の底へ出る) */
  upper: number;
  /** 板の直下の停止階(下の層の頭へ出る) */
  lower: number;
  /** 設備(無ければ null)。設備は上の停止階の乗り場(梯子列の反対側)に置く */
  amenity: GrandAmenity | null;
  /** 設備の中心 X */
  amenityX: number;
}

export interface GrandShaft {
  /** `g:band,group` */
  id: string;
  band: number;
  group: number;
  startCell: number;
  endCell: number;
  /** 内側の左端列 */
  x0: number;
  /** 内側の幅 */
  width: number;
  yTop: number;
  yBottom: number;
  /** 停止階の行(上から下へ昇順): 上端、途中駅(板ごとに上・下)、下端 */
  stops: number[];
  stations: GrandStation[];
  /** 貫く板 [top, bottom) */
  plates: { cell: number; top: number; bottom: number }[];
  /** cell startCell + i の床帯の間隔 */
  spacing: number[];
  /** 眺望区間の床の行(抜く行は [vy − GRAND_VISTA_ROWS, vy)) */
  vistas: number[];
  /** 乗り場がつながる梯子列 */
  ladderX: number;
  /** 乗り場の左端列・右端列(含む) */
  landL: number;
  landR: number;
  /** 呼び戻しの X 範囲 [landX0, landX1](entities/elevator の LiftShaft) */
  landX0: number;
  landX1: number;
  /** 地形を決める範囲 [x0, x1) × [y0, y1) */
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

/** 外形(乗り場・眺望区間・天井を含む)。配置の除外や近傍の列挙に使う */
export function grandShaftBounds(s: GrandShaft): { x0: number; x1: number; y0: number; y1: number } {
  return s.bounds;
}

function rectsOverlap(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number },
  margin: number,
): boolean {
  return a.x0 < b.x1 + margin && a.x1 + margin > b.x0 && a.y0 < b.y1 + margin && a.y1 + margin > b.y0;
}

function spacingOf(seed: number, cell: number): number {
  return terrainProfileFor(biomeIdForCell(seed, cell)).floorSpacing;
}

/** 縦の配置(候補の X によらない部分) */
interface Vertical {
  startCell: number;
  endCell: number;
  yTop: number;
  yBottom: number;
  plates: { cell: number; top: number; bottom: number }[];
  spacing: number[];
  stops: number[];
  vistas: number[];
  amenities: (GrandAmenity | null)[];
}

const AMENITY_KINDS: readonly GrandAmenity[] = ['rest', 'terminal', 'supply'];

function verticalLayout(seed: number, band: number, group: number): Vertical | null {
  const g0 = group * GRAND_GROUP_CELLS;
  const lastCell = g0 + GRAND_GROUP_CELLS - 1;
  // 開始 cell はグループの先頭から「少なくとも 1 枚の板を下に残す」範囲で選ぶ
  const startCell = g0 + Math.floor(hash2(seed + GRAND_SALT + 1, band, group) * (GRAND_GROUP_CELLS - 1));
  const spS = spacingOf(seed, startCell);
  // 天井(yTop − 4)の上限: 休憩点の帯の下と、前室・圧縮帯の下のうち深い方(通常の昇降機と同じ)
  const ceilingMin = Math.max(
    restPointBand(seed, startCell).y1 + SHAFT_REST_CLEARANCE,
    interfaceBottom(seed, startCell) + ANTECHAMBER_DEPTH + COMPRESSION_DEPTH + GRAND_MARGIN,
  );
  const topMin = ceilingMin + SHAFT_DOOR_ROWS + 1;
  const topMax = interfaceTop(seed, startCell + 1) - GRAND_TOP_CLEARANCE;
  if (topMax < topMin) return null;
  let yTop = Math.ceil((topMin + Math.floor(hash2(seed + GRAND_SALT + 2, band, group) * (topMax - topMin + 1))) / spS) * spS;
  if (yTop > topMax) yTop -= spS;
  if (yTop < topMin) return null;
  const want = GRAND_MIN_LENGTH + Math.floor(hash2(seed + GRAND_SALT + 3, band, group) * (GRAND_MAX_LENGTH - GRAND_MIN_LENGTH + 1));
  const endCell = Math.min(Math.max(biomeCellAt(seed, yTop + want), startCell + 1), lastCell);
  const spE = spacingOf(seed, endCell);
  const lo = interfaceBottom(seed, endCell) + GRAND_BOTTOM_DEPTH;
  const hi = interfaceTop(seed, endCell + 1) - SHAFT_FLOOR_CLEARANCE;
  let yBottom = Math.floor(Math.min(Math.max(yTop + want, lo), hi) / spE) * spE;
  if (yBottom < lo) yBottom += spE;
  if (yBottom > hi) return null;
  const length = yBottom - yTop;
  if (length < GRAND_MIN_LENGTH || length > GRAND_MAX_LENGTH) return null;
  const plates: Vertical['plates'] = [];
  const spacing: number[] = [];
  const stops = [yTop];
  const amenities: (GrandAmenity | null)[] = [];
  for (let c = startCell; c <= endCell; c++) spacing.push(spacingOf(seed, c));
  for (let c = startCell + 1; c <= endCell; c++) {
    const top = interfaceTop(seed, c);
    const bottom = interfaceBottom(seed, c);
    plates.push({ cell: c, top, bottom });
    const sp = spacing[c - startCell];
    stops.push(top, Math.ceil((bottom + GRAND_BELOW_PLATE) / sp) * sp);
    amenities.push(
      hash2(seed + GRAND_SALT + 5, band, c) < GRAND_AMENITY_RATE
        ? AMENITY_KINDS[Math.floor(hash2(seed + GRAND_SALT + 6, band, c) * AMENITY_KINDS.length)]
        : null,
    );
  }
  stops.push(yBottom);
  // 眺望区間: 一定間隔の候補のうち、板・停止階から離れたものだけ
  const vistas: number[] = [];
  for (let vy = yTop + GRAND_VISTA_FIRST; vy <= yBottom - GRAND_VISTA_CLEAR; vy += GRAND_VISTA_EVERY) {
    const r0 = vy - GRAND_VISTA_ROWS - 1 - GRAND_VISTA_CLEAR;
    const r1 = vy + GRAND_VISTA_CLEAR;
    if (plates.some((p) => r0 < p.bottom && r1 >= p.top)) continue;
    if (stops.some((st) => st >= r0 && st - SHAFT_DOOR_ROWS <= r1)) continue;
    vistas.push(vy);
  }
  return { startCell, endCell, yTop, yBottom, plates, spacing, stops, vistas, amenities };
}

/** 候補のグループ左端 gx に壁ごと収めたシャフト(重なりの判定前) */
function build(seed: number, band: number, group: number, v: Vertical, gx: number): GrandShaft {
  const W = GRAND_WIDTH;
  const l = groupLadderX(seed, gx) - gx;
  // 梯子列がグループの右半分なら左寄り([gx+2, gx+10) が壁と内側)、左半分なら右寄り([gx+22, gx+30))
  const ladderRight = l >= 16;
  const x0 = ladderRight ? gx + 3 : gx + 23;
  const ladderX = gx + l;
  const landL = ladderRight ? x0 - 1 - GRAND_LANDING_REACH : ladderX;
  const landR = ladderRight ? ladderX : x0 + W + GRAND_LANDING_REACH;
  // 設備は梯子列の反対側の乗り場の中ほど。そこが隣のグループの梯子列なら壁の側へ 2 列寄せる
  let amenityX = ladderRight ? x0 - 5 : x0 + W + 5;
  if (groupLadderX(seed, Math.floor(amenityX)) === Math.floor(amenityX)) amenityX += ladderRight ? 2 : -2;
  const stations: GrandStation[] = v.plates.map((p, i) => ({
    cell: p.cell,
    upper: v.stops[1 + i * 2],
    lower: v.stops[2 + i * 2],
    amenity: v.amenities[i],
    amenityX: amenityX + 0.5,
  }));
  const bounds = {
    x0: Math.min(landL, x0 - 1 - GRAND_VISTA_REACH),
    x1: Math.max(landR, x0 + W + GRAND_VISTA_REACH) + 1,
    y0: v.yTop - SHAFT_DOOR_ROWS - 1,
    y1: v.yBottom + 1,
  };
  return {
    id: `g:${band},${group}`,
    band,
    group,
    startCell: v.startCell,
    endCell: v.endCell,
    x0,
    width: W,
    yTop: v.yTop,
    yBottom: v.yBottom,
    stops: v.stops,
    stations,
    plates: v.plates,
    spacing: v.spacing,
    vistas: v.vistas,
    ladderX,
    landL,
    landR,
    landX0: landL,
    landX1: landR + 1,
    bounds,
  };
}

/** 重なりの棄却(安いものから順に見る) */
function fits(seed: number, s: GrandShaft): boolean {
  const b = s.bounds;
  const k0 = Math.floor(b.x0 / PASSAGE_SLOT) - 1;
  const k1 = Math.floor((b.x1 - 1) / PASSAGE_SLOT) + 1;
  // 貫く板の孔: 界面の縦坑・見晴らし台・大穴と、前室の芯(梯子の抑止・連続床で合成が先に返る範囲)
  for (const p of s.plates) {
    for (let kk = k0; kk <= k1; kk++) {
      const px = passageX(seed, p.cell, kk);
      if (b.x0 <= px + GRAND_PASSAGE_CLEAR && b.x1 > px - GRAND_PASSAGE_CLEAR) return false;
    }
  }
  for (let c = s.startCell; c <= s.endCell; c++) {
    for (let kk = k0; kk <= k1; kk++) {
      // 大構造(層の高さ全体を占め得るので X 範囲だけで除外する)
      const lm = landmarkAt(seed, c, kk);
      if (lm) {
        const [lx0, lx1] = spanOf(lm);
        if (b.x0 < lx1 + GRAND_MARGIN && b.x1 + GRAND_MARGIN > lx0) return false;
      }
      const rp = restPointAt(seed, c, kk);
      if (rectsOverlap(b, { x0: rp.left, x1: rp.right + 1, y0: rp.floorY - REST_HEIGHT - 1, y1: rp.floorY + 1 }, GRAND_MARGIN)) return false;
      const e = elevatorShaftAt(seed, c, kk);
      if (e && rectsOverlap(b, shaftBounds(e), GRAND_MARGIN)) return false;
    }
    const hall = grandHallAt(seed, c);
    if (hall && rectsOverlap(b, hall, GRAND_MARGIN)) return false;
  }
  for (let c = s.startCell; c <= s.endCell + 1; c++) {
    const chim = hallChimneyAt(seed, c);
    if (chim && rectsOverlap(b, chim, GRAND_MARGIN)) return false;
  }
  // メガ施設(一辺 192 > シャフトの幅なので、8 タイル刻みの格子と端の標本で重なりを見る)
  for (let y = b.y0; ; y = Math.min(y + 8, b.y1 - 1)) {
    for (let x = b.x0; ; x = Math.min(x + 8, b.x1 - 1)) {
      if (megaFacilityAt(seed, x, y) !== null) return false;
      if (x === b.x1 - 1) break;
    }
    if (y === b.y1 - 1) break;
  }
  return true;
}

/** 抽選と除外の本体(メモ化なし) */
function computeGrand(seed: number, band: number, group: number): GrandShaft | null {
  if (hash2(seed + GRAND_SALT, band, group) >= GRAND_RATE) return null;
  const v = verticalLayout(seed, band, group);
  if (!v) return null;
  const groupsPerSlot = PASSAGE_SLOT / 32;
  for (let i = 0; i < GRAND_TRIES; i++) {
    // バンドの最後のスロットは使わない(候補グループ + 張り出しがバンドの外へ出ないように)
    const k = band * GRAND_BAND_SLOTS + Math.floor(hash2(seed + GRAND_SALT + 10 + i, band, group) * (GRAND_BAND_SLOTS - 1));
    const j = CANDIDATE_GROUP_MIN + Math.floor(hash2(seed + GRAND_SALT + 30 + i, band, group) * CANDIDATE_GROUP_COUNT);
    const s = build(seed, band, group, v, (k * groupsPerSlot + j) * 32);
    if (fits(seed, s)) return s;
  }
  return null;
}

/** メモ(チャンク生成はタイルごとに引くため)。キーは数値。溢れたら捨てる */
const memo = new Map<number, GrandShaft | null>();
let memoSeed = NaN;
const MEMO_LIMIT = 256;

/** 列バンド band・cell グループ group の大昇降機。置かれない組では null */
export function grandShaftAt(seed: number, band: number, group: number): GrandShaft | null {
  if (seed !== memoSeed) {
    memo.clear();
    memoSeed = seed;
  }
  const key = band * 1048576 + group;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const s = computeGrand(seed, band, group);
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, s);
  return s;
}

/** 行 y が貫く板の中か */
function inPlate(s: GrandShaft, y: number): boolean {
  for (const p of s.plates) if (y >= p.top && y < p.bottom) return true;
  return false;
}

/** 行 y が停止階の上 3 行(壁の出入口・乗り場の空気)か */
function isStopDoor(s: GrandShaft, y: number): boolean {
  for (const st of s.stops) if (y >= st - SHAFT_DOOR_ROWS && y < st) return true;
  return false;
}

/** 行 y が床帯の行の上 3 行(壁の出入口)か。床帯の行が板の中なら出入口にしない */
function isFloorDoor(s: GrandShaft, y: number, cell: number): boolean {
  if (y < s.yTop - SHAFT_DOOR_ROWS || y >= s.yBottom) return false;
  const i = cell - s.startCell;
  if (i < 0 || i >= s.spacing.length) return false;
  const sp = s.spacing[i];
  const r = mod(y, sp);
  if (r < sp - SHAFT_DOOR_ROWS) return false;
  return !inPlate(s, y + sp - r);
}

/** 行 y を含む眺望区間の床の行(庇〜床 [vy − ROWS − 1, vy])。無ければ null */
export function grandVistaAt(s: GrandShaft, y: number): number | null {
  for (const vy of s.vistas) if (y >= vy - GRAND_VISTA_ROWS - 1 && y <= vy) return vy;
  return null;
}

/**
 * 大昇降機 1 本が決める (x, y) のタイル(範囲外・地形に任せる位置は null)。
 * cell は y の層(呼び出し側で計算済みなら渡す)
 */
export function grandShaftTileAt(seed: number, s: GrandShaft, x: number, y: number, cell: number = biomeCellAt(seed, y)): Tile | null {
  const b = s.bounds;
  if (x < b.x0 || x >= b.x1 || y < b.y0 || y >= b.y1) return null;
  const wallL = s.x0 - 1;
  const wallR = s.x0 + s.width;
  if (x > wallL && x < wallR) return y === b.y0 || y === s.yBottom ? TILE.SOLID : TILE.AIR;
  const vista = grandVistaAt(s, y);
  if (x === wallL || x === wallR) {
    if (y === b.y0 || y === s.yBottom || inPlate(s, y)) return TILE.SOLID;
    if (vista !== null && y >= vista - GRAND_VISTA_ROWS && y < vista) return TILE.AIR;
    if (isStopDoor(s, y) || isFloorDoor(s, y, cell)) return TILE.AIR;
    return TILE.SOLID;
  }
  // 壁の外: 梯子列は地形(梯子)に任せる
  if (x === groupLadderX(seed, x)) return null;
  for (const st of s.stops) {
    if (y > st || y < st - SHAFT_DOOR_ROWS) continue;
    if (x < wallL ? x >= s.landL : x <= s.landR) return y === st ? TILE.SOLID : TILE.AIR;
  }
  if (vista !== null) {
    const out = x < wallL ? wallL - x : x - wallR;
    if (out <= GRAND_VISTA_REACH) return y === vista || y === vista - GRAND_VISTA_ROWS - 1 ? TILE.SOLID : TILE.AIR;
  }
  return null;
}

/** 大昇降機のタイル(属さなければ null)。外形はバンドとグループの内側に収まるので 1 組だけを引けば足りる */
export function grandTileAt(seed: number, x: number, y: number, cell: number = biomeCellAt(seed, y)): Tile | null {
  const s = grandShaftAt(seed, Math.floor(x / GRAND_BAND_WIDTH), Math.floor(cell / GRAND_GROUP_CELLS));
  return s ? grandShaftTileAt(seed, s, x, y, cell) : null;
}

/** (x, y) の周り(横 ±rx、縦 ±ry)に外形が掛かる大昇降機を列挙する */
export function grandShaftsNear(seed: number, x: number, y: number, rx: number, ry: number): GrandShaft[] {
  const out: GrandShaft[] = [];
  const b0 = Math.floor((x - rx) / GRAND_BAND_WIDTH);
  const b1 = Math.floor((x + rx) / GRAND_BAND_WIDTH);
  const g0 = Math.floor(biomeCellAt(seed, Math.floor(y - ry)) / GRAND_GROUP_CELLS);
  const g1 = Math.floor(biomeCellAt(seed, Math.floor(y + ry)) / GRAND_GROUP_CELLS);
  for (let g = g0; g <= g1; g++) {
    for (let band = b0; band <= b1; band++) {
      const s = grandShaftAt(seed, band, g);
      if (!s) continue;
      const b = s.bounds;
      if (b.x1 > x - rx && b.x0 < x + rx && b.y1 > y - ry && b.y0 < y + ry) out.push(s);
    }
  }
  return out;
}

/** 行 wy に灯があるか(両側の壁の内側の面。壁が固体の行だけ。焼き込みの装飾と灯の矩形が共有する) */
export function grandLampAt(seed: number, s: GrandShaft, wy: number): boolean {
  if (wy <= s.yTop - SHAFT_DOOR_ROWS || wy >= s.yBottom) return false;
  if (mod(wy - s.yTop, GRAND_LAMP_EVERY) !== GRAND_LAMP_EVERY / 2) return false;
  return grandShaftTileAt(seed, s, s.x0 - 1, wy) === TILE.SOLID;
}

/** 途中駅の設備の位置(識別子・中心 X・床の行)。識別子は補給キャッシュ・端末の既存の集合にそのまま入る */
export interface GrandAmenitySpot {
  id: string;
  x: number;
  floorY: number;
}

const AMENITY_PREFIX: Record<GrandAmenity, string> = { rest: 'r', terminal: 'm', supply: 's' };

/** シャフト群の途中駅のうち、設備 kind を持つものの位置 */
export function grandAmenitySpots(shafts: readonly GrandShaft[], kind: GrandAmenity): GrandAmenitySpot[] {
  const out: GrandAmenitySpot[] = [];
  for (const s of shafts) {
    for (const st of s.stations) {
      if (st.amenity !== kind) continue;
      out.push({ id: `${AMENITY_PREFIX[kind]}:g:${s.band},${st.cell}`, x: st.amenityX, floorY: st.upper });
    }
  }
  return out;
}
