import { BIOME_CELL_BASE, BIOME_CELL_JITTER, biomeCellAt, biomeIdForCell } from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { elevatorShaftAt, SHAFT_DOOR_ROWS, SHAFT_FLOOR_CLEARANCE, SHAFT_REST_CLEARANCE, shaftBounds } from './elevator';
import { grandHallAt, hallChimneyAt } from './grandhall';
import { sectorAt, SECTOR_SIZE } from './hierarchy';
import {
  ANTECHAMBER_DEPTH, ANTECHAMBER_HALF_WIDTH, COMPRESSION_DEPTH, groupLadderX, interfaceBottom, interfaceTop, mod,
  PASSAGE_SLOT, passageX,
} from './interface';
import { landmarkAt, spanOf } from './landmark';
import { MEGA_SIZE } from './megafacility';
import { hash2 } from './noise';
import { REST_HEIGHT, restPointAt, restPointBand } from './restpoint';
import { TILE, type Tile } from './tiles';

/**
 * 大昇降機(グランドシャフト、設計 2026-11-12-mega-structures、2.20 の原作準拠スケール 2026-11-16)。
 * 開始点から 2400〜4800 タイル(6〜13 層程度)下へ貫き続ける縦シャフトを、世界の大物として稀に決定論で置く。
 * 乗り通すのは非常識に長く(3 タイル/秒で約 13〜27 分)、各層の境界の途中駅で降りるのが前提。純粋関数のみ。
 *
 * 置き方の裁定:
 * - 抽選の単位は「列バンド(孔スロット GRAND_BAND_SLOTS 個ぶんの X の帯)× 開始 cell」。当たった組の開始 cell から
 *   hash で決めた長さだけ下へ、同じ列で板を貫いて続く(cell グループに閉じない)。
 * - 上から来ているシャフトの認識: 行の cell から上へ GRAND_LOOKBACK_CELLS 個の開始 cell を引き、終わりの cell が
 *   行の cell に届くものを持ち主とする(grandShaftCovering)。最長のシャフトが貫く cell の数より遡るので取りこぼさない。
 * - 並行の禁止: 同じ列バンドで、上の開始 cell の「候補」(抽選・縦の配置・横の配置まで通ったもの)の終わりの cell が
 *   自分の開始 cell 以下なら棄却する。上の候補がさらに上の候補に棄却されていても棄却する(保守的)。こうすると判定は
 *   上へ一定の範囲を見るだけで閉じ(棄却の連鎖を遡らない)、どの順で引いても同じ結果になる。
 * - 通常の昇降機(elevatorShaftAt)とは別の抽選(別の salt)。通常の昇降機と重なる候補は大昇降機の側で棄却する。
 * - 縦: 上の停止階は開始 cell の休憩点の帯・前室・圧縮帯より下、床の板より GRAND_TOP_CLEARANCE 以上上。
 *   長さは GRAND_MIN_LENGTH〜GRAND_MAX_LENGTH を hash で決め、下の停止階は終わりの cell の床帯の行に丸める
 *   (板の下から GRAND_BOTTOM_DEPTH 以上下、床の板の上面から SHAFT_FLOOR_CLEARANCE 以上上)。丸めで最長を超える
 *   ときは 1 つ上の cell の底で止める。
 * - 途中駅: 貫く板(界面)ごとに 2 段。板の上面(上の層の底)と、板の下面の直下の床帯の行(下の層の頭)。
 * - 横: バンドの中の孔スロットの境目付近(スロットの 32 タイルグループ 9〜14 番)の候補を hash の順で
 *   GRAND_TRIES 個まで試し、梯子列を踏まない側へ壁ごと収める(通常の昇降機と同じ流儀)。次の重なりがあれば
 *   棄却して次の候補へ進む(既存の流儀のまま): 貫く板の孔(縦坑・見晴らし台・大穴・前室の芯 ±ANTECHAMBER_HALF_WIDTH)、
 *   各 cell の大構造の X 範囲・休憩点の箱・大広間と煙突・通常の昇降機、メガ施設。
 *   長いほど貫く板と大構造が増えて収まりにくいので、実際の長さの分布は短い側に寄る(計画書の裁定)。
 * - 詰みなし: 停止階の乗り場は、梯子列の側では自分のグループの梯子列まで延ばす(梯子列は層の高さ全体を
 *   通る上昇路なので、どの停止階からも層の経路網へ出られる)。壁は床帯の行ごとに出入口を空ける(通常の
 *   昇降機と同じ)。シャフトに落ちても足場か下の停止階に着き、落下の被害は無い。
 * - 板を貫く: 内側は板の行でも AIR(足場の通り道)、壁と板の上面の乗り場の床は板の不壊(HARD)のまま
 *   (worldgen の合成で、大昇降機の SOLID が板の HARD に当たる位置は HARD を残す)。
 * - 眺望区間: 一定間隔(GRAND_VISTA_EVERY)で両側の壁を GRAND_VISTA_ROWS 行ぶん抜き、外へ GRAND_VISTA_REACH 列の
 *   張り出し(床と庇)を彫る。空気の背後には遠景(超構造のシルエット)が透けて見える。板・停止階の近くには置かない。
 * - 灯: GRAND_LAMP_EVERY 行ごと。貫く板の内側だけ GRAND_LAMP_PLATE_EVERY 行ごとに間引く(2.21 §B-1)。
 * - 速さ: 足場は GRAND_SPEED(通常の昇降機は 5 のまま)。乗っていない足場(呼び戻し)は GRAND_CALL_SPEED で動く。
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
/**
 * 列バンド × 開始 cell の組ごとの抽選の当たり率。当たっても横の配置が収まる組はさらに一部(長いほど少ない)で、
 * 並行の棄却でも減る。世界の大物としての頻度の調整はまずこの値で行う
 */
export const GRAND_RATE = 0.5;
/** 横の候補を何個まで試すか(候補は最大 (GRAND_BAND_SLOTS − 1) × 6 = 42 個) */
export const GRAND_TRIES = 42;
/** 長さ(上下の停止階の距離、タイル)。原作準拠: 乗り通すのが非常識に長い */
export const GRAND_MIN_LENGTH = 2400;
export const GRAND_MAX_LENGTH = 4800;
/**
 * 上から来ているシャフトを探す範囲(開始 cell を何個遡るか)。層の最小の高さ(BIOME_CELL_BASE − BIOME_CELL_JITTER)で
 * 最長を割った数 + 1。これより上で始まるシャフトは行の cell に届かない
 */
export const GRAND_LOOKBACK_CELLS = Math.ceil(GRAND_MAX_LENGTH / (BIOME_CELL_BASE - BIOME_CELL_JITTER)) + 1;
/** 足場の速さ(タイル/秒)。通常の昇降機(ELEVATOR_SPEED = 5)より遅い */
export const GRAND_SPEED = 3;
/** 乗っていない足場の速さ(呼び戻し)。最長でも約 120 秒で来る(従来の最長の待ちと同じ) */
export const GRAND_CALL_SPEED = 40;
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
/**
 * 貫く板の内側での灯の間隔(行)。板の中だけ 3 つに 1 つへ間引き、通過に暗転の一拍を作る(2.21 §B-1、裁定 J7)。
 * 板を抜けた先は GRAND_LAMP_EVERY に戻る
 */
export const GRAND_LAMP_PLATE_EVERY = 36;
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
/** 横の候補の総数(バンドの最後のスロットは使わない: 候補グループ + 張り出しがバンドの外へ出ないように) */
const CANDIDATE_COUNT = (GRAND_BAND_SLOTS - 1) * CANDIDATE_GROUP_COUNT;
/** 候補を巡る歩幅(CANDIDATE_COUNT と互いに素なので、hash の開始位置から全候補を 1 回ずつ巡る) */
const CANDIDATE_STRIDE = 13;

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
  /** `g:band,startCell` */
  id: string;
  band: number;
  startCell: number;
  endCell: number;
  /** 内側の左端列 */
  x0: number;
  /** 内側の幅 */
  width: number;
  yTop: number;
  yBottom: number;
  /** 足場の速さ(乗っているとき)と呼び戻しの速さ(entities/elevator の LiftShaft) */
  speed: number;
  callSpeed: number;
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

/**
 * cell の中で下の停止階に使える床帯の行のうち、target に最も近いもの(target を [lo, hi] へ寄せてから丸める)。
 * lo は天井の板の下面から GRAND_BOTTOM_DEPTH、hi は床の板の上面から SHAFT_FLOOR_CLEARANCE。無ければ null
 */
function bottomRowIn(seed: number, cell: number, target: number): number | null {
  const sp = spacingOf(seed, cell);
  const lo = interfaceBottom(seed, cell) + GRAND_BOTTOM_DEPTH;
  const hi = interfaceTop(seed, cell + 1) - SHAFT_FLOOR_CLEARANCE;
  let y = Math.floor(Math.min(Math.max(target, lo), hi) / sp) * sp;
  if (y < lo) y += sp;
  return y > hi ? null : y;
}

function verticalLayout(seed: number, band: number, startCell: number): Vertical | null {
  const spS = spacingOf(seed, startCell);
  // 天井(yTop − 4)の上限: 休憩点の帯の下と、前室・圧縮帯の下のうち深い方(通常の昇降機と同じ)
  const ceilingMin = Math.max(
    restPointBand(seed, startCell).y1 + SHAFT_REST_CLEARANCE,
    interfaceBottom(seed, startCell) + ANTECHAMBER_DEPTH + COMPRESSION_DEPTH + GRAND_MARGIN,
  );
  const topMin = ceilingMin + SHAFT_DOOR_ROWS + 1;
  const topMax = interfaceTop(seed, startCell + 1) - GRAND_TOP_CLEARANCE;
  if (topMax < topMin) return null;
  let yTop = Math.ceil((topMin + Math.floor(hash2(seed + GRAND_SALT + 2, band, startCell) * (topMax - topMin + 1))) / spS) * spS;
  if (yTop > topMax) yTop -= spS;
  if (yTop < topMin) return null;
  // 長さ: 目標の行が落ちる cell を終わりの cell にし、その床帯の行へ丸める。目標が cell の頭(板の直下)に落ちて
  // 丸めで最長を超えるとき(または収まる行が無いとき)は 1 つ上の cell の底で止める
  const want = GRAND_MIN_LENGTH + Math.floor(hash2(seed + GRAND_SALT + 3, band, startCell) * (GRAND_MAX_LENGTH - GRAND_MIN_LENGTH + 1));
  let endCell = biomeCellAt(seed, yTop + want);
  let yBottom = bottomRowIn(seed, endCell, yTop + want);
  if (yBottom === null || yBottom - yTop > GRAND_MAX_LENGTH) {
    endCell -= 1;
    yBottom = endCell > startCell ? bottomRowIn(seed, endCell, Number.POSITIVE_INFINITY) : null;
  }
  if (yBottom === null) return null;
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

/** 横の配置(候補のグループ左端 gx に壁ごと収めた位置と外形。重なりの判定前) */
interface Horizontal {
  ladderRight: boolean;
  x0: number;
  ladderX: number;
  landL: number;
  landR: number;
  bounds: { x0: number; x1: number; y0: number; y1: number };
}

function placeX(seed: number, v: Vertical, gx: number): Horizontal {
  const W = GRAND_WIDTH;
  const l = groupLadderX(seed, gx) - gx;
  // 梯子列がグループの右半分なら左寄り([gx+2, gx+10) が壁と内側)、左半分なら右寄り([gx+22, gx+30))
  const ladderRight = l >= 16;
  const x0 = ladderRight ? gx + 3 : gx + 23;
  const ladderX = gx + l;
  const landL = ladderRight ? x0 - 1 - GRAND_LANDING_REACH : ladderX;
  const landR = ladderRight ? ladderX : x0 + W + GRAND_LANDING_REACH;
  const bounds = {
    x0: Math.min(landL, x0 - 1 - GRAND_VISTA_REACH),
    x1: Math.max(landR, x0 + W + GRAND_VISTA_REACH) + 1,
    y0: v.yTop - SHAFT_DOOR_ROWS - 1,
    y1: v.yBottom + 1,
  };
  return { ladderRight, x0, ladderX, landL, landR, bounds };
}

/** 縦と横の配置からシャフトを組み立てる(重なりの判定を通った後にだけ呼ぶ) */
function build(seed: number, band: number, v: Vertical, h: Horizontal): GrandShaft {
  const W = GRAND_WIDTH;
  const { ladderRight, x0, ladderX, landL, landR, bounds } = h;
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
  return {
    id: `g:${band},${v.startCell}`,
    band,
    startCell: v.startCell,
    endCell: v.endCell,
    x0,
    width: W,
    yTop: v.yTop,
    yBottom: v.yBottom,
    speed: GRAND_SPEED,
    callSpeed: GRAND_CALL_SPEED,
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

/** 重なりの棄却(安いものから順に見る。長いシャフトは孔と大構造で落ちることが多いので先に見る) */
function fits(seed: number, s: Vertical, b: Horizontal['bounds']): boolean {
  const k0 = Math.floor(b.x0 / PASSAGE_SLOT) - 1;
  const k1 = Math.floor((b.x1 - 1) / PASSAGE_SLOT) + 1;
  // 貫く板の孔: 界面の縦坑・見晴らし台・大穴と、前室の芯(梯子の抑止・連続床で合成が先に返る範囲)
  for (const p of s.plates) {
    for (let kk = k0; kk <= k1; kk++) {
      const px = passageX(seed, p.cell, kk);
      if (b.x0 <= px + GRAND_PASSAGE_CLEAR && b.x1 > px - GRAND_PASSAGE_CLEAR) return false;
    }
  }
  // 大構造(層の高さ全体を占め得るので X 範囲だけで除外する)
  for (let c = s.startCell; c <= s.endCell; c++) {
    for (let kk = k0; kk <= k1; kk++) {
      const lm = landmarkAt(seed, c, kk);
      if (lm) {
        const [lx0, lx1] = spanOf(lm);
        if (b.x0 < lx1 + GRAND_MARGIN && b.x1 + GRAND_MARGIN > lx0) return false;
      }
    }
  }
  for (let c = s.startCell; c <= s.endCell; c++) {
    for (let kk = k0; kk <= k1; kk++) {
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
  // メガ施設: 外形が掛かるセクターのハブの矩形(一辺 MEGA_SIZE)と重ならないこと。megaFacilityAt はハブの矩形の
  // 全タイルで非 null を返す(セクターの外へはみ出す分は隣のセクターの判定になるので、矩形全体で見るのは安全側)
  const sx0 = Math.floor(b.x0 / SECTOR_SIZE);
  const sx1 = Math.floor((b.x1 - 1) / SECTOR_SIZE);
  const sy0 = Math.floor(b.y0 / SECTOR_SIZE);
  const sy1 = Math.floor((b.y1 - 1) / SECTOR_SIZE);
  for (let sy = sy0; sy <= sy1; sy++) {
    for (let sx = sx0; sx <= sx1; sx++) {
      const sec = sectorAt(seed, sx * SECTOR_SIZE, sy * SECTOR_SIZE);
      const hx = sx * SECTOR_SIZE + sec.hubX - MEGA_SIZE / 2;
      const hy = sy * SECTOR_SIZE + sec.hubY - MEGA_SIZE / 2;
      if (rectsOverlap(b, { x0: hx, x1: hx + MEGA_SIZE, y0: hy, y1: hy + MEGA_SIZE }, 0)) return false;
    }
  }
  return true;
}

/** 候補: 抽選・縦の配置・横の配置まで通ったもの(並行の棄却の前。メモ化なし) */
function computeCandidate(seed: number, band: number, startCell: number): GrandShaft | null {
  if (hash2(seed + GRAND_SALT, band, startCell) >= GRAND_RATE) return null;
  const v = verticalLayout(seed, band, startCell);
  if (!v) return null;
  const groupsPerSlot = PASSAGE_SLOT / 32;
  const first = Math.floor(hash2(seed + GRAND_SALT + 10, band, startCell) * CANDIDATE_COUNT);
  const tries = Math.min(GRAND_TRIES, CANDIDATE_COUNT);
  for (let i = 0; i < tries; i++) {
    const idx = (first + i * CANDIDATE_STRIDE) % CANDIDATE_COUNT;
    const k = band * GRAND_BAND_SLOTS + Math.floor(idx / CANDIDATE_GROUP_COUNT);
    const j = CANDIDATE_GROUP_MIN + (idx % CANDIDATE_GROUP_COUNT);
    const h = placeX(seed, v, (k * groupsPerSlot + j) * 32);
    if (fits(seed, v, h.bounds)) return build(seed, band, v, h);
  }
  return null;
}

/** メモ(チャンク生成はタイルごとに引くため)。キーは数値。溢れたら捨てる。seed が変わったら全部捨てる */
const candidateMemo = new Map<number, GrandShaft | null>();
const shaftMemo = new Map<number, GrandShaft | null>();
const coverMemo = new Map<number, GrandShaft | null>();
let memoSeed = NaN;
const MEMO_LIMIT = 4096;
/** cell の値域(キーの下位 20 ビット)。cell は ±2^19 の範囲で一意 */
const CELL_KEY_SPAN = 1048576;

function memoKey(band: number, cell: number): number {
  return band * CELL_KEY_SPAN + mod(cell, CELL_KEY_SPAN);
}

function checkSeed(seed: number): void {
  if (seed === memoSeed) return;
  candidateMemo.clear();
  shaftMemo.clear();
  coverMemo.clear();
  memoSeed = seed;
}

function remember(memo: Map<number, GrandShaft | null>, key: number, s: GrandShaft | null): GrandShaft | null {
  if (memo.size >= MEMO_LIMIT) memo.clear();
  memo.set(key, s);
  return s;
}

function candidateAt(seed: number, band: number, startCell: number): GrandShaft | null {
  const key = memoKey(band, startCell);
  const hit = candidateMemo.get(key);
  if (hit !== undefined) return hit;
  return remember(candidateMemo, key, computeCandidate(seed, band, startCell));
}

/**
 * 列バンド band で開始 cell が startCell の大昇降機。置かれない組では null。
 * 同じバンドで上に始まる候補が startCell まで届いていれば棄却する(並行の 2 本目を生やさない)
 */
export function grandShaftAt(seed: number, band: number, startCell: number): GrandShaft | null {
  checkSeed(seed);
  const key = memoKey(band, startCell);
  const hit = shaftMemo.get(key);
  if (hit !== undefined) return hit;
  let s = candidateAt(seed, band, startCell);
  for (let c = startCell - GRAND_LOOKBACK_CELLS; s && c < startCell; c++) {
    const above = candidateAt(seed, band, c);
    if (above && above.endCell >= startCell) s = null;
  }
  return remember(shaftMemo, key, s);
}

/**
 * 列バンド band で層 cell を貫く(cell が開始 cell〜終わりの cell に入る)大昇降機。無ければ null。
 * 下の層の側から「上から来ているシャフト」を決定論で引く入口。並行の棄却により持ち主は高々 1 本
 */
export function grandShaftCovering(seed: number, band: number, cell: number): GrandShaft | null {
  checkSeed(seed);
  const key = memoKey(band, cell);
  const hit = coverMemo.get(key);
  if (hit !== undefined) return hit;
  let found: GrandShaft | null = null;
  for (let c = cell; c >= cell - GRAND_LOOKBACK_CELLS && !found; c--) {
    const s = grandShaftAt(seed, band, c);
    if (s && s.endCell >= cell) found = s;
  }
  return remember(coverMemo, key, found);
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

/** 大昇降機のタイル(属さなければ null)。外形はバンドの内側に収まり、バンドの中で cell を貫くのは高々 1 本 */
export function grandTileAt(seed: number, x: number, y: number, cell: number = biomeCellAt(seed, y)): Tile | null {
  const s = grandShaftCovering(seed, Math.floor(x / GRAND_BAND_WIDTH), cell);
  return s ? grandShaftTileAt(seed, s, x, y, cell) : null;
}

/** (x, y) の周り(横 ±rx、縦 ±ry)に外形が掛かる大昇降機を列挙する */
export function grandShaftsNear(seed: number, x: number, y: number, rx: number, ry: number): GrandShaft[] {
  const out: GrandShaft[] = [];
  const b0 = Math.floor((x - rx) / GRAND_BAND_WIDTH);
  const b1 = Math.floor((x + rx) / GRAND_BAND_WIDTH);
  const c0 = biomeCellAt(seed, Math.floor(y - ry));
  const c1 = biomeCellAt(seed, Math.floor(y + ry));
  for (let band = b0; band <= b1; band++) {
    for (let c = c0; c <= c1; c++) {
      const s = grandShaftCovering(seed, band, c);
      // 同じシャフトは貫く cell の数だけ引ける(メモが溢れて作り直されても id は同じ)
      if (!s || out.some((o) => o.id === s.id)) continue;
      const b = s.bounds;
      if (b.x1 > x - rx && b.x0 < x + rx && b.y1 > y - ry && b.y0 < y + ry) out.push(s);
    }
  }
  return out;
}

/**
 * 行 wy に灯があるか(両側の壁の内側の面。壁が固体の行だけ。焼き込みの装飾と灯の矩形が共有する)。
 * 板の外は GRAND_LAMP_EVERY 行ごと。貫く板の内側 [top, bottom) では GRAND_LAMP_PLATE_EVERY 行ごとに間引く:
 * 板の中で最初の灯の行を残し、そこから 36 行ごと(従来の灯の 3 つに 1 つ)。位相を板ごとに取るので、
 * 厚さ 32 行の板でも必ず 1 つは残る(真っ暗にはしない)
 */
export function grandLampAt(seed: number, s: GrandShaft, wy: number): boolean {
  if (wy <= s.yTop - SHAFT_DOOR_ROWS || wy >= s.yBottom) return false;
  const phase = GRAND_LAMP_EVERY / 2;
  if (mod(wy - s.yTop, GRAND_LAMP_EVERY) !== phase) return false;
  for (const p of s.plates) {
    if (wy < p.top || wy >= p.bottom) continue;
    // 板の中で最初の灯の行(p.top 以上で位相の合う最小の行)
    const firstLamp = p.top + mod(s.yTop + phase - p.top, GRAND_LAMP_EVERY);
    if ((wy - firstLamp) % GRAND_LAMP_PLATE_EVERY !== 0) return false;
    break;
  }
  return grandShaftTileAt(seed, s, s.x0 - 1, wy) === TILE.SOLID;
}

/** 板の行範囲(grandPlateCrossing の入力、y0 <= y1)。足場の上面 t が y0 < t < y1 のとき板の内側 */
export interface GrandPlateRange {
  cell: number;
  y0: number;
  y1: number;
}

/** 板を横切ったイベント: 板の行範囲へ入った(enter)/抜けた(exit) */
export interface GrandPlateEvent {
  type: 'enter' | 'exit';
  cell: number;
}

/** シャフトが貫く板の行範囲(上面〜下面) */
export function grandPlateRanges(s: GrandShaft): GrandPlateRange[] {
  return s.plates.map((p) => ({ cell: p.cell, y0: p.top, y1: p.bottom }));
}

/** 足場の上面 t と板の位置関係: 0 = 上(t <= y0)、1 = 内側、2 = 下(t >= y1)。境界ちょうど(停止階)は外 */
function plateSide(t: number, p: GrandPlateRange): 0 | 1 | 2 {
  return t <= p.y0 ? 0 : t >= p.y1 ? 2 : 1;
}

/**
 * 足場の上面が prevTop から top へ動いたときに横切った板のイベント(2.21 §B-1)。移動の順に並ぶ:
 * 下りは上の板から、上りは下の板から。1 ステップで板を丸ごとまたげば、その板の enter・exit を続けて返す。
 * 板の内側から内側、外から外(同じ側)へ動いただけなら何も返さない。板の上面・下面ちょうどは外に数えるので、
 * 板の上面の途中駅から下りはじめた瞬間が enter、上りでそこへ着いた瞬間が exit になる。
 * 足場の上面だけを見る純粋関数(カメラのズーム・先行とは無関係)
 */
export function grandPlateCrossing(prevTop: number, top: number, plates: readonly GrandPlateRange[]): GrandPlateEvent[] {
  const out: GrandPlateEvent[] = [];
  if (top === prevTop) return out;
  const down = top > prevTop;
  const ordered = [...plates].sort((a, b) => (down ? a.y0 - b.y0 : b.y0 - a.y0));
  for (const p of ordered) {
    const from = plateSide(prevTop, p);
    const to = plateSide(top, p);
    if (from === to) continue;
    if (from !== 1) out.push({ type: 'enter', cell: p.cell });
    if (to !== 1) out.push({ type: 'exit', cell: p.cell });
  }
  return out;
}

/**
 * 板 cell を抜けた先の層の cell(階層字幕に出す層)。板 cell の上面は層 cell−1 の底、下面は層 cell の頭なので、
 * 下りなら cell、上りなら cell−1
 */
export function grandCrossingEnteredCell(cell: number, down: boolean): number {
  return down ? cell : cell - 1;
}

/** 足場の上面 top が終端(上端 yTop・下端 yBottom の停止階)にちょうど止まっているか。途中駅・移動中は偽(2.21 §B-3) */
export function isTerminalStop(s: { yTop: number; yBottom: number }, top: number): boolean {
  return top === s.yTop || top === s.yBottom;
}

/** 終端まわりの敵除外の半径(タイル、チェビシェフ距離。2.21 §B-3、裁定 J6) */
export const GRAND_TERMINAL_GUARD = 24;

/**
 * 終端(上端・下端)の乗り場の中心。乗り場は停止階の行の [landL, landR](シャフトの内側を挟んで両側)で、
 * 中心 X はその中点。y は停止階の床の行(休憩点の保護点と同じ流儀)
 */
export function grandTerminalPoints(s: GrandShaft): { x: number; y: number }[] {
  const x = (s.landL + s.landR + 1) / 2;
  return [{ x, y: s.yTop }, { x, y: s.yBottom }];
}

/** 行 wy より下にある途中駅の数(貫く板のうち上面が wy より下のもの)。深度標識の目盛りに使う */
export function grandStationsBelow(s: GrandShaft, wy: number): number {
  let n = 0;
  for (const p of s.plates) if (p.top > wy) n++;
  return n;
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
