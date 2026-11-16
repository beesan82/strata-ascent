import { sampleOpenness } from '../core/zoom';
import { biomeCellAt, biomeIdForCell } from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { elevatorsNear, shaftBounds } from './elevator';
import { grandShaftBounds, grandShaftsNear } from './grandShaft';
import { grandHallAt, hallChimneyAt } from './grandhall';
import {
  ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceTop, passageX,
} from './interface';
import { landmarkNear, landmarkTileAt, spanOf } from './landmark';
import { megaFacilityAt } from './megafacility';
import { hash2 } from './noise';
import { restPointAt } from './restpoint';
import { TILE, isSolid, type Tile } from './tiles';

/**
 * 巨柱(2.21、設計 2026-11-16-strata-2.21-design §A-3): 層を縦に貫く太い柱を地形として生成する。
 * 柱は人のために立っていない。人の方が、後から数か所に穴(トンネル)を開けて通っている。
 *
 * 採択は「柱なし地形」だけを読んで決める(再帰回避)。合成の土台タイルは worldgen が
 * baseGet として差し込むため、このモジュールは worldgen を import しない。
 * 柱のタイルは SOLID(HARD にしない。重粒子砲のクレーターは通常どおり開く)。
 * 到達可能性は砲に頼らず、梯子列→乗り場→トンネルの形で保証する。
 */

export const PILLAR_MIN_WIDTH = 16;
export const PILLAR_MAX_WIDTH = 24;
/** 柱の上端・下端と板の間(行)。前室(深さ 48)と圧縮帯(深さ 60)の外に収まる */
export const PILLAR_PLATE_CLEAR = 64;
/** 穴の縦の間隔の目標(行)。その層の floorSpacing の倍数へ切り上げる */
export const PILLAR_DOOR_PITCH = 48;
/** 穴の高さ(行)。通常の昇降機の出入口 SHAFT_DOOR_ROWS と同じ */
export const PILLAR_DOOR_ROWS = 3;
/** 柱の体積に占める空気(穴)の割合の上限 */
export const PILLAR_AIR_MAX = 0.08;
/** 柱の外形と梯子列の最小の間(列) */
export const PILLAR_LADDER_CLEAR = 4;
/** 穴の口から梯子列まで延ばす乗り場の最大長(列) */
export const PILLAR_LANDING_MAX = 40;
/** 抽選の横の単位(列)。孔スロット 384 の半分 */
export const PILLAR_UNIT_WIDTH = 192;
/** 組(横の単位 × 層 cell)ごとの当選確率 */
export const PILLAR_RATE = 0.75;
/** 横位置の候補を試す回数 */
export const PILLAR_TRIES = 8;
/** 採択条件: 柱なし地形で、穴の口の 12 列外の点の sampleOpenness がこの値以上 */
export const PILLAR_OPEN_MIN = 0.6;
/** 採択条件: 上の条件を満たす穴の口が柱 1 本にこの数以上 */
export const PILLAR_OPEN_DOORS = 2;
/** 隣の柱の外形との最小の間(列) */
export const PILLAR_SPACING = 64;
/** 棄却条件: 最下の穴の床の隙間の下で、塞がれる足場を探す深さ(行) */
export const PILLAR_PERCH_SCAN = 24;
/** 囲まれる梯子の検査で、列に梯子があるかを先に見る刻み(行) */
export const PILLAR_LADDER_SCAN_STRIDE = 4;
/** 棄却条件: 乗り場の梯子列が柱の上下へ抜けているかを見る深さ(行)。柱の上端の上・下端の下それぞれこの行数の内に梯子を求める */
export const PILLAR_LADDER_REACH = 12;
const PILLAR_SALT = 9601;

export interface Pillar {
  /** `p:unit,cell` */
  id: string;
  unit: number;
  cell: number;
  /** 本体の左端列と幅 */
  x0: number;
  w: number;
  /** 本体の上端と下端の行(どちらも床帯の行) */
  yTop: number;
  yBottom: number;
  /** 穴の間隔(行、floorSpacing の倍数) */
  pitch: number;
  /** 穴の行(床の行) */
  doors: readonly number[];
  /** 乗り場が届く左右の梯子列(乗り場はこの列自体には被せない) */
  landL: number;
  landR: number;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** x0 の左で最も近い「柱の端から PILLAR_LADDER_CLEAR 以上離れた」梯子列。無ければ null */
function nearestLadderLeft(seed: number, x0: number): number | null {
  const limit = x0 - PILLAR_LADDER_CLEAR;
  for (let g = Math.floor(limit / 32); g >= Math.floor((x0 - 64) / 32); g--) {
    const col = groupLadderX(seed, g * 32 + 16);
    if (col <= limit) return col;
  }
  return null;
}

/** x1 の右で最も近い「柱の端から PILLAR_LADDER_CLEAR 以上離れた」梯子列。無ければ null */
function nearestLadderRight(seed: number, x1: number): number | null {
  const limit = x1 + PILLAR_LADDER_CLEAR;
  for (let g = Math.floor(limit / 32); g <= Math.floor((x1 + 64) / 32); g++) {
    const col = groupLadderX(seed, g * 32 + 16);
    if (col >= limit) return col;
  }
  return null;
}

interface Rect { x0: number; x1: number; y0: number; y1: number }

function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
}

/** 棄却: 孔の芯(本体 ±4 列)。前室・圧縮帯の外(板から 64 行)にあるため、離れは梯子列の離れまで縮める(設計 U10 の裁定) */
function hitsPassage(seed: number, cell: number, body: Rect): boolean {
  for (const c of [cell, cell + 1]) {
    const k0 = Math.floor((body.x0 - 8) / 384) - 1;
    const k1 = Math.floor((body.x1 + 8) / 384) + 1;
    for (let k = k0; k <= k1; k++) {
      const px = passageX(seed, c, k);
      if (px >= body.x0 - PILLAR_LADDER_CLEAR && px < body.x1 + PILLAR_LADDER_CLEAR) return true;
    }
  }
  return false;
}

/** 棄却: 大構造(ランドマーク)の外形と、乗り場の帯の実タイル(spanOf の範囲を超えて届く部材があるため) */
function hitsLandmark(seed: number, cell: number, body: Rect, doors: readonly number[]): boolean {
  for (let x = body.x0; x < body.x1; x += 8) {
    const lm = landmarkNear(seed, cell, x);
    if (!lm) continue;
    const [lx0, lx1] = spanOf(lm);
    if (overlaps(body, { x0: lx0, x1: lx1, y0: lm.top, y1: lm.floor })) return true;
  }
  for (const d of doors) {
    for (let y = d - PILLAR_DOOR_ROWS; y <= d; y++) {
      for (let x = body.x0; x < body.x1; x += 2) {
        if (landmarkTileAt(seed, x, y) !== null) return true;
      }
    }
  }
  return false;
}

/** 棄却: 休憩点の箱(+8) */
function hitsRest(seed: number, cell: number, body: Rect): boolean {
  const k0 = Math.floor((body.x0 - 64) / 384) - 1;
  const k1 = Math.floor((body.x1 + 64) / 384) + 1;
  for (let k = k0; k <= k1; k++) {
    const rp = restPointAt(seed, cell, k);
    const box: Rect = { x0: rp.left, x1: rp.right + 1, y0: rp.floorY - 13, y1: rp.floorY + 1 };
    if (overlaps(body, box, 8)) return true;
  }
  return false;
}

/** 棄却: 開始地点(+12)。開始地点は cell 0 の前室の床(板の下面 +48 行)で、柱の上端は +64 行以深なので、実際には届かない */
function hitsSpawn(seed: number, cell: number, body: Rect): boolean {
  if (cell !== 0) return false;
  const sx = passageX(seed, 0, 0) - 12;
  const sy = interfaceBottom(seed, 0) + ANTECHAMBER_DEPTH;
  const dx = Math.max(0, body.x0 - sx, sx - body.x1);
  const dy = Math.max(0, body.y0 - sy, sy - body.y1);
  return Math.max(dx, dy) <= 12;
}

/** 棄却: 大昇降機の外形(+16) */
function hitsGrand(seed: number, body: Rect): boolean {
  const cx = (body.x0 + body.x1) / 2;
  const cy = (body.y0 + body.y1) / 2;
  const shafts = grandShaftsNear(seed, cx, cy, (body.x1 - body.x0) / 2 + 80, (body.y1 - body.y0) / 2 + 80);
  for (const s of shafts) {
    if (overlaps(body, grandShaftBounds(s), 16)) return true;
  }
  return false;
}

/** 棄却: 通常の昇降機のシャフト */
function hitsElevator(seed: number, body: Rect): boolean {
  const cx = (body.x0 + body.x1) / 2;
  const cy = (body.y0 + body.y1) / 2;
  const shafts = elevatorsNear(seed, cx, cy, (body.x1 - body.x0) / 2 + 40, (body.y1 - body.y0) / 2 + 40);
  for (const s of shafts) {
    if (overlaps(body, shaftBounds(s))) return true;
  }
  return false;
}

/** 棄却: 大広間と煙突 */
function hitsHall(seed: number, cell: number, body: Rect): boolean {
  const hall = grandHallAt(seed, cell);
  if (hall && overlaps(body, { x0: hall.x0, x1: hall.x1, y0: hall.y0, y1: hall.y1 })) return true;
  const chimney = hallChimneyAt(seed, cell);
  if (chimney && overlaps(body, chimney)) return true;
  const below = hallChimneyAt(seed, cell + 1);
  if (below && overlaps(body, below)) return true;
  return false;
}

/** 棄却: メガ施設(タイル関数の標本検査)。本体は全域、乗り場は穴の帯だけを見る */
function hitsMega(seed: number, body: Rect, span: Rect, doors: readonly number[]): boolean {
  for (let y = body.y0; y <= body.y1; y += 4) {
    for (let x = body.x0; x < body.x1; x += 4) {
      if (megaFacilityAt(seed, x, y) !== null) return true;
    }
  }
  for (const d of doors) {
    for (let y = d - PILLAR_DOOR_ROWS; y <= d; y += 2) {
      for (let x = span.x0; x < span.x1; x += 4) {
        if (megaFacilityAt(seed, x, y) !== null) return true;
      }
    }
  }
  return false;
}

/**
 * 棄却: 最下の穴の床が塞ぐ足場。柱なし地形で最下のバンド行(yBottom)に隙間(床の無い列)が
 * あり、その真下に帯の外へ続かない足場があると、柱が隙間を埋めた時点でその足場へ届く経路が
 * 無くなる(到達関係の保存に反する)。中間の穴のバンドは下が柱の埋め立てになるため見ない。
 * get は柱なし地形(baseGet)。
 */
function hitsSealedPerch(get: (x: number, y: number) => number, span: Rect, yBottom: number): boolean {
  for (let x = span.x0; x < span.x1; x++) {
    const t = get(x, yBottom);
    if (isSolid(t) || t === TILE.LADDER) continue;
    // 梯子が下へ続く列は、柱を入れてもアクセスが保たれるため隙間としない
    if (get(x, yBottom + 1) === TILE.LADDER) continue;
    for (let y = yBottom + 1; y <= yBottom + PILLAR_PERCH_SCAN; y++) {
      // 足場の上面: 固体で、上 2 行が非固体(立てる)
      if (!isSolid(get(x, y)) || isSolid(get(x, y - 1)) || isSolid(get(x, y - 2))) continue;
      // 列 x を含む固体のランが帯の外へ伸びるか。端が帯の端に達し、その外も固体なら伸びる
      let west = x;
      while (west > span.x0 && isSolid(get(west - 1, y))) west--;
      if (west === span.x0 && isSolid(get(span.x0 - 1, y))) continue;
      let east = x;
      while (east < span.x1 - 1 && isSolid(get(east + 1, y))) east++;
      if (east === span.x1 - 1 && isSolid(get(span.x1, y))) continue;
      return true;
    }
  }
  return false;
}

/**
 * 棄却: 埋め立てに囲まれる梯子。帯の列(乗り場の梯子列 landL / landR を除く)に、柱なし地形で
 * 梯子の縦ランがあると、梯子タイル自体は合成で残るが、周囲が埋め立てで固まる。ランがどの穴の
 * トンネルにも掛からず、柱の上にも下にも抜けていなければ孤島になり、基準地形で届いていた
 * 梯子の上のセルへ届かなくなる(到達関係の保存に反する)。組の梯子列(groupLadderX)だけでなく、
 * 施設・大構造・通路由来の梯子も実タイルで拾う。get は柱なし地形(baseGet)。
 * ランが「つながっている」のは次のいずれか:
 * (a) いずれかの穴の行 [door - PILLAR_DOOR_ROWS, door](床とトンネル)に重なる
 * (b) 上端が yTop より上にある(柱の上へ抜けている)
 * (c) 下端が yBottom より下にある(柱の下へ抜けている)
 *
 * 走査は 2 段。まず列ごとに PILLAR_LADDER_SCAN_STRIDE 行刻みでサンプルし、梯子が 1 つでも
 * あった列(当たり列)だけ全行を走査する。4 行以上のランは刻みサンプルで必ず拾える。
 * 3 行以下の短いランは拾えないことがあるが、到達保存の検証(reach.test.ts と reach-survey)が
 * 実測の裏付けになる。
 */
function hitsEncasedLadder(
  get: (x: number, y: number) => number, span: Rect, doors: readonly number[],
  landL: number, landR: number,
): boolean {
  const yTop = span.y0;
  const yBottom = span.y1 - 1;
  const scanTop = yTop - 2;
  const scanBottom = yBottom + 2;
  for (let x = span.x0; x < span.x1; x++) {
    if (x === landL || x === landR) continue;
    // 1 段目: 刻みサンプル。開始行は列に依らず scanTop(列ごとにずらさない)
    let hit = false;
    for (let sy = scanTop; sy <= scanBottom; sy += PILLAR_LADDER_SCAN_STRIDE) {
      if (get(x, sy) === TILE.LADDER) { hit = true; break; }
    }
    if (!hit) continue;
    // 2 段目: 当たり列だけ全行を走査して縦ランを集める
    let y = scanTop;
    while (y <= scanBottom) {
      if (get(x, y) !== TILE.LADDER) { y++; continue; }
      // 縦ラン [top, bottom]。走査範囲の端で切れたランは、端が柱の外にあるので (b)(c) で拾える
      const top = y;
      while (y + 1 <= scanBottom && get(x, y + 1) === TILE.LADDER) y++;
      const bottom = y;
      y++;
      if (top < yTop || bottom > yBottom) continue;
      let joined = false;
      for (const d of doors) {
        if (top <= d && bottom >= d - PILLAR_DOOR_ROWS) { joined = true; break; }
      }
      if (!joined) return true;
    }
  }
  return false;
}

/**
 * 棄却: 乗り場の梯子列が柱の上下へ抜けていない候補。梯子列 landL / landR は柱自身の出入り口で、
 * 帯の中は埋め立てになる。柱なし地形で梯子の末端が柱の行範囲の中にあり、そこへ届く道が帯の中の
 * 階段や床だけだった場合、柱を入れるとその道が塞がれ、梯子を経由していた近隣の到達関係が壊れる
 * (シード 987654321 の p:-2,7 で実測。東の梯子列が yBottom より下へ続いていなかった)。
 * 梯子列それぞれについて、次の両方に LADDER が少なくとも 1 つ無ければ棄却する:
 * (a) 柱の下: 行 (yBottom, yBottom + PILLAR_LADDER_REACH]
 * (b) 柱の上: 行 [yTop - PILLAR_LADDER_REACH, yTop)
 * get は柱なし地形(baseGet)。
 */
function hitsBrokenLadderAccess(
  get: (x: number, y: number) => number, yTop: number, yBottom: number,
  landL: number, landR: number,
): boolean {
  for (const col of [landL, landR]) {
    let below = false;
    for (let y = yBottom + 1; y <= yBottom + PILLAR_LADDER_REACH; y++) {
      if (get(col, y) === TILE.LADDER) { below = true; break; }
    }
    if (!below) return true;
    let above = false;
    for (let y = yTop - 1; y >= yTop - PILLAR_LADDER_REACH; y--) {
      if (get(col, y) === TILE.LADDER) { above = true; break; }
    }
    if (!above) return true;
  }
  return false;
}

const unitMemo = new Map<string, Pillar | null>();
const candMemo = new Map<string, Pillar | null>();

/**
 * (unit, cell) の組の柱。baseGet は柱なし地形のタイル引き(採択の開放度判定にだけ使う)。
 * 間隔(PILLAR_SPACING)の規則は再帰にしない: まず間隔を見ない候補を組ごとに決め、
 * 隣の組の候補と近すぎる場合は、優先度(ハッシュ)の低い方を落とす。候補は組ごとにメモする。
 */
export function pillarForUnit(
  seed: number, unit: number, cell: number, baseGet: (x: number, y: number) => number,
): Pillar | null {
  const key = `${seed}:${unit},${cell}`;
  const memo = unitMemo.get(key);
  if (memo !== undefined) return memo;
  let p = pillarCandidate(seed, unit, cell, baseGet);
  if (p) {
    const prio = hash2(seed + PILLAR_SALT + 9, unit, cell);
    for (const du of [-1, 1]) {
      const q = pillarCandidate(seed, unit + du, cell, baseGet);
      if (!q) continue;
      const gap = du < 0 ? p.x0 - (q.x0 + q.w) : q.x0 - (p.x0 + p.w);
      if (gap < PILLAR_SPACING && hash2(seed + PILLAR_SALT + 9, unit + du, cell) < prio) {
        p = null;
        break;
      }
    }
  }
  unitMemo.set(key, p);
  return p;
}

/** 間隔の規則を除いた候補(当選・幾何・棄却・採択条件まで) */
function pillarCandidate(
  seed: number, unit: number, cell: number, baseGet: (x: number, y: number) => number,
): Pillar | null {
  const key = `${seed}:${unit},${cell}`;
  const memo = candMemo.get(key);
  if (memo !== undefined) return memo;
  const p = computeCandidate(seed, unit, cell, baseGet);
  candMemo.set(key, p);
  return p;
}

function computeCandidate(
  seed: number, unit: number, cell: number, baseGet: (x: number, y: number) => number,
): Pillar | null {
  if (hash2(seed + PILLAR_SALT, unit, cell) >= PILLAR_RATE) return null;
  const biome = biomeIdForCell(seed, cell);
  const spacing = terrainProfileFor(biome).floorSpacing;
  const topLimit = interfaceBottom(seed, cell) + PILLAR_PLATE_CLEAR;
  const bottomLimit = interfaceTop(seed, cell + 1) - PILLAR_PLATE_CLEAR;
  const yTop = Math.ceil(topLimit / spacing) * spacing;
  const yBottom = Math.floor(bottomLimit / spacing) * spacing;
  const pitch = Math.ceil(PILLAR_DOOR_PITCH / spacing) * spacing;
  if (yBottom - yTop < pitch * 2) return null; // 短すぎる層には立てない
  const doors: number[] = [];
  for (let d = yTop + pitch; d <= yBottom; d += pitch) doors.push(d);
  const w = PILLAR_MIN_WIDTH + Math.floor(
    hash2(seed + PILLAR_SALT + 1, unit, cell) * (PILLAR_MAX_WIDTH - PILLAR_MIN_WIDTH + 1),
  );
  const unitX = unit * PILLAR_UNIT_WIDTH;
  for (let t = 0; t < PILLAR_TRIES; t++) {
    const x0 = unitX + Math.floor(hash2(seed + PILLAR_SALT + 2 + t, unit, cell) * (PILLAR_UNIT_WIDTH - w + 1));
    const x1 = x0 + w;
    const landL = nearestLadderLeft(seed, x0);
    const landR = nearestLadderRight(seed, x1);
    if (landL === null || landR === null) continue;
    if (x0 - landL > PILLAR_LANDING_MAX || landR - x1 > PILLAR_LANDING_MAX) continue;
    // クリアランス: 乗り場の梯子列以外に、本体 ±PILLAR_LADDER_CLEAR の内側へ
    // 別の梯子列が入り込む候補は採らない(梯子列は 32 列組に 1 本で、組の境目では
    // 隣の組の列が本体のすぐ脇に来ることがある)
    let ladderInClear = false;
    for (let g = Math.floor((x0 - PILLAR_LADDER_CLEAR) / 32); g <= Math.floor((x1 + PILLAR_LADDER_CLEAR) / 32) && !ladderInClear; g++) {
      const col = groupLadderX(seed, g * 32 + 16);
      if (col > x0 - PILLAR_LADDER_CLEAR && col < x1 + PILLAR_LADDER_CLEAR) ladderInClear = true;
    }
    if (ladderInClear) continue;
    const body: Rect = { x0, x1, y0: yTop, y1: yBottom + 1 };
    // 乗り場まで含めた全幅。合成の段で柱より先に決まる系(大構造・休憩点・大広間・
    // 昇降機・大昇降機)は、本体だけでなく乗り場の帯でも重なれば、穴の行の床を
    // 欠けさせるため、全幅で棄却する(「梯子列→乗り場→トンネル」の保証を守る)
    const span: Rect = { x0: landL, x1: landR + 1, y0: yTop, y1: yBottom + 1 };
    if (hitsPassage(seed, cell, body)) continue;
    if (hitsLandmark(seed, cell, span, doors)) continue;
    if (hitsRest(seed, cell, span)) continue;
    if (hitsSpawn(seed, cell, body)) continue;
    if (hitsGrand(seed, span)) continue;
    if (hitsElevator(seed, span)) continue;
    if (hitsHall(seed, cell, span)) continue;
    if (hitsMega(seed, body, span, doors)) continue;
    if (hitsSealedPerch(baseGet, span, yBottom)) continue;
    if (hitsBrokenLadderAccess(baseGet, yTop, yBottom, landL, landR)) continue;
    // 採択条件: 穴の口の 12 列外の点の開放度。口は左右別々に数える
    let openMouths = 0;
    for (const d of doors) {
      if (sampleOpenness(baseGet, x0 - 12, d - 1) >= PILLAR_OPEN_MIN) openMouths++;
      if (sampleOpenness(baseGet, x1 + 12, d - 1) >= PILLAR_OPEN_MIN) openMouths++;
    }
    if (openMouths < PILLAR_OPEN_DOORS) continue;
    // 帯の全列の実タイル走査(刻みサンプル+当たり列の全行)で高コストなため、安い棄却と開放度を通過した候補にだけ掛ける
    if (hitsEncasedLadder(baseGet, span, doors, landL, landR)) continue;
    return {
      id: `p:${unit},${cell}`, unit, cell, x0, w, yTop, yBottom, pitch, doors, landL, landR,
    };
  }
  return null;
}

/** 矩形 [x0,x1]×[y0,y1] に本体・乗り場が掛かる柱をすべて返す */
export function pillarsInRect(
  seed: number, x0: number, x1: number, y0: number, y1: number,
  baseGet: (x: number, y: number) => number,
): Pillar[] {
  const out: Pillar[] = [];
  const u0 = Math.floor((x0 - PILLAR_LANDING_MAX) / PILLAR_UNIT_WIDTH);
  const u1 = Math.floor((x1 + PILLAR_LANDING_MAX) / PILLAR_UNIT_WIDTH);
  const c0 = biomeCellAt(seed, y0);
  const c1 = biomeCellAt(seed, y1);
  for (let cell = c0; cell <= c1; cell++) {
    for (let unit = u0; unit <= u1; unit++) {
      const p = pillarForUnit(seed, unit, cell, baseGet);
      if (!p) continue;
      if (p.landR < x0 || p.landL > x1 || p.yBottom < y0 || p.yTop > y1) continue;
      out.push(p);
    }
  }
  return out;
}

/** (x, y) が穴の行(床の行)か */
export function pillarDoorAt(p: Pillar, y: number): boolean {
  return y >= p.yTop && y <= p.yBottom && mod(y - p.yTop, p.pitch) === 0 && y > p.yTop;
}

/**
 * 柱が (x, y) のタイルを決めるなら返す(決めなければ null)。土台のタイルは見ない:
 * 梯子を埋めないための分岐は worldgen の合成側(オーバーレイの梯子を残す)で扱う。
 * - 本体: すべて SOLID。ただし穴の行の上 3 行(トンネル)は AIR、穴の行は SOLID
 * - 乗り場: 穴の行は梯子列の手前まで SOLID、その上 3 行は AIR(大昇降機の乗り場と同じ流儀)
 */
export function pillarTileAt(seed: number, x: number, y: number, baseGet: (x: number, y: number) => number): Tile | null {
  const cell = biomeCellAt(seed, y);
  const unit = Math.floor(x / PILLAR_UNIT_WIDTH);
  for (let u = unit - 1; u <= unit + 1; u++) {
    const p = pillarForUnit(seed, u, cell, baseGet);
    if (!p) continue;
    if (y < p.yTop || y > p.yBottom) continue;
    const inBody = x >= p.x0 && x < p.x0 + p.w;
    const inLanding = (x > p.landL && x < p.x0) || (x >= p.x0 + p.w && x < p.landR);
    if (!inBody && !inLanding) continue;
    if (pillarDoorAt(p, y)) return TILE.SOLID;
    // 穴の上 3 行(トンネル・乗り場の頭上)
    const below = y + 1;
    const below2 = y + 2;
    const below3 = y + 3;
    if (
      (below <= p.yBottom && pillarDoorAt(p, below)) ||
      (below2 <= p.yBottom && pillarDoorAt(p, below2)) ||
      (below3 <= p.yBottom && pillarDoorAt(p, below3))
    ) return TILE.AIR;
    // 帯の全域が柱の構造体(実装時の裁定、計画書に記録): 本体も乗り場の帯も、
    // 穴の行以外は一律に埋める。帯の中に基準地形の床バンドが残ると、トンネルの
    // 床に空気柱を塞がれて届かないポケットになり、到達関係の保存に反するため。
    // 見た目の柱は本体だけに描く(decor の pillarOps)。梯子列そのものには被せない
    return TILE.SOLID;
  }
  return null;
}
