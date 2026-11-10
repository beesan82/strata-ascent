import { hash2 } from './noise';
import { spawnIdHash } from './drop';
import { isSolid, TILE } from './tiles';
import type { TileLookup } from '../entities/physics';
import type { FloorRun, ProtectedPoint, SpawnRect } from './spawn';
import type { SupplyCache } from './supply';

/**
 * インフラの選定(設計 2026-11-10-infrastructure §2〜§4): トラムの軌道、建設者の出現、端末の配置。
 * どれも敵スキャンの床ラン・保護点・大広間の除外へ相乗りする決定論の選定(キャッシュ/武器庫と同じ流儀)で、
 * 近傍に最大 1 つずつ。純粋関数のみ(Math.random は使わない)。
 */

/** 矩形 [x0, x1) × [y0, y1) */
export type Rect = SpawnRect;

// ---- 床ランの正規化 ----

/** canonicalRun が窓の外へ延ばす上限(タイル) */
export const RUN_EXTEND_CAP = 64;

function floorOk(tiles: TileLookup, x: number, y: number): boolean {
  return isSolid(tiles(x, y)) && tiles(x, y - 1) === TILE.AIR && tiles(x, y - 2) === TILE.AIR;
}

/**
 * 走査窓 [wx0, wx1) の端で切れた床ランを、窓の外へ最大 RUN_EXTEND_CAP まで延ばして本来の端に揃える
 * (判定は findFloorRuns と同じ「床が固体・頭上 2 タイルが空気」)。窓の位置が変わってもランの左端と長さ
 * (= 識別子と hash)が変わらないようにするため。窓の端に触れていないランはそのまま返す
 */
export function canonicalRun(tiles: TileLookup, run: FloorRun, wx0: number, wx1: number): FloorRun {
  let x0 = run.x;
  let x1 = run.x + run.len;
  if (x0 <= Math.floor(wx0)) {
    for (let i = 0; i < RUN_EXTEND_CAP && floorOk(tiles, x0 - 1, run.floorY); i++) x0--;
  }
  if (x1 >= Math.floor(wx1)) {
    for (let i = 0; i < RUN_EXTEND_CAP && floorOk(tiles, x1, run.floorY); i++) x1++;
  }
  return x0 === run.x && x1 === run.x + run.len ? run : { x: x0, floorY: run.floorY, len: x1 - x0 };
}

function guardedAt(protectedPoints: readonly ProtectedPoint[], x: number, y: number): boolean {
  return protectedPoints.some((p) => Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= p.r);
}

function inRects(rects: readonly Rect[], x0: number, x1: number, y0: number, y1: number): boolean {
  return rects.some((r) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0);
}

// ---- トラム(§2) ----

const TRAM_SALT = 9501;
/** 軌道の最短の長さ(タイル) */
export const TRAM_MIN_TRACK = 40;
/**
 * 軌道を区切る X のブロック(タイル)。軌道は「1 ブロックの中の床の連続区間」とし、走査窓の位置に
 * よらず (ブロック, 行) だけで端が決まるようにする(窓で切れた床ランから端を推すと窓とともに揺れる)
 */
export const TRAM_BLOCK = 128;
/** 床の上に空いていなければならない行数(車体 2 行 + 屋根に立つプレイヤーの頭上 2 行) */
export const TRAM_CLEARANCE = 4;
/** 車両の幅(タイル)と屋根の高さ(床面から屋根の上面まで) */
export const TRAM_W = 6;
export const TRAM_ROOF = 2;
/** 巡航の速さ(タイル/秒)と端での停車(秒) */
export const TRAM_SPEED = 4;
export const TRAM_DWELL = 3;
/** 窓の中の候補の最小 hash がこれ未満のときだけ走らせる */
export const TRAM_THRESHOLD = 0.5;

export interface TramTrack {
  /** `tr:block,floorY,x0` */
  id: string;
  /** 軌道の左端の列 */
  x0: number;
  /** 軌道の右端(排他) */
  x1: number;
  /** 床の行(レールはこの行の上面) */
  floorY: number;
}

/**
 * 軌道に使える列か: 床が固体か梯子(32 タイル梯子列は床帯の行でも LADDER になり、歩いて渡れる)で、
 * 上 TRAM_CLEARANCE 行が固体でない(梯子は可)
 */
export function trackOk(tiles: TileLookup, x: number, y: number): boolean {
  const f = tiles(x, y);
  if (!isSolid(f) && f !== TILE.LADDER) return false;
  for (let d = 1; d <= TRAM_CLEARANCE; d++) if (isSolid(tiles(x, y - d))) return false;
  return true;
}

/** ブロック block の行 floorY にある軌道(TRAM_MIN_TRACK 以上の連続区間)。両端が梯子の区間は削る */
export function tramTracksInRow(tiles: TileLookup, block: number, floorY: number): TramTrack[] {
  const out: TramTrack[] = [];
  const bx0 = block * TRAM_BLOCK;
  const bx1 = bx0 + TRAM_BLOCK;
  let start = -1;
  for (let x = bx0; x <= bx1; x++) {
    const ok = x < bx1 && trackOk(tiles, x, floorY);
    if (ok && start < 0) start = x;
    if (!ok && start >= 0) {
      // 端の列が梯子だと車両が穴の上で止まって見えるので、固体の床の列まで削る
      let a = start;
      let b = x;
      while (a < b && !isSolid(tiles(a, floorY))) a++;
      while (b > a && !isSolid(tiles(b - 1, floorY))) b--;
      if (b - a >= TRAM_MIN_TRACK) out.push({ id: `tr:${block},${floorY},${a}`, x0: a, x1: b, floorY });
      start = -1;
    }
  }
  return out;
}

/**
 * 走査窓 [x0, x1) に掛かるブロックで、rows の各行の軌道を列挙する。rows は敵スキャンの床ランの行
 * (軌道の床は必ずどこかで床ランになる)を渡し、全行を総当たりしない
 */
export function findTramTracks(tiles: TileLookup, rows: readonly number[], x0: number, x1: number): TramTrack[] {
  const out: TramTrack[] = [];
  const b0 = Math.floor(x0 / TRAM_BLOCK);
  const b1 = Math.floor((x1 - 1) / TRAM_BLOCK);
  for (const y of rows) {
    for (let b = b0; b <= b1; b++) out.push(...tramTracksInRow(tiles, b, y));
  }
  return out;
}

/**
 * トラムの軌道の選定(argmin。キャッシュと同じ流儀)。保護点(スポーン・休憩点)に掛かる軌道、
 * 除外矩形(大広間・昇降機のシャフト)に掛かる軌道は使わない。最小 hash が閾値以上なら null
 */
export function chooseTramTrack(
  seed: number,
  tracks: readonly TramTrack[],
  protectedPoints: readonly ProtectedPoint[],
  rects: readonly Rect[],
): TramTrack | null {
  let best: TramTrack | null = null;
  let bestRoll = Infinity;
  for (const t of tracks) {
    if (inRects(rects, t.x0, t.x1, t.floorY - TRAM_CLEARANCE, t.floorY + 1)) continue;
    const guarded = protectedPoints.some((p) => {
      const dx = Math.max(0, t.x0 - p.x, p.x - (t.x1 - 1));
      return Math.max(dx, Math.abs(t.floorY - p.y)) <= p.r;
    });
    if (guarded) continue;
    const roll = hash2(seed + TRAM_SALT, t.x0, t.floorY);
    if (roll < bestRoll) {
      bestRoll = roll;
      best = t;
    }
  }
  return best && bestRoll < TRAM_THRESHOLD ? best : null;
}

/** 点から軌道(線分)までのユークリッド距離 */
export function distanceToTrack(t: TramTrack, px: number, py: number): number {
  const dx = Math.max(0, t.x0 - px, px - t.x1);
  return Math.hypot(dx, py - t.floorY);
}

/** 軌道の粘着の保持半径(タイル)。乗っている間・近くにいる間は選び直さない */
export const TRAM_HOLD_RADIUS = 64;

/** 車両の 1 往復の周期(秒) */
export function tramPeriod(t: TramTrack): number {
  return 2 * ((t.x1 - t.x0 - TRAM_W) / TRAM_SPEED + TRAM_DWELL);
}

function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}

/**
 * 時刻 timeSec での車両の左端 X。時刻と軌道の定義だけで決まる(状態なし)。
 * 左端で停車 → 右へ走る → 右端で停車 → 左へ走る の繰り返し。走行は端で緩やかに加減速する。
 * 位相は軌道 ID の hash でずらす
 */
export function tramCarX(seed: number, t: TramTrack, timeSec: number): number {
  const travel = t.x1 - t.x0 - TRAM_W;
  const run = travel / TRAM_SPEED;
  const period = 2 * (run + TRAM_DWELL);
  const offset = hash2(seed + TRAM_SALT + 1, spawnIdHash(t.id), 0) * period;
  let p = (timeSec + offset) % period;
  if (p < 0) p += period;
  if (p < TRAM_DWELL) return t.x0;
  p -= TRAM_DWELL;
  if (p < run) return t.x0 + travel * smooth(p / run);
  p -= run;
  if (p < TRAM_DWELL) return t.x0 + travel;
  p -= TRAM_DWELL;
  return t.x0 + travel * (1 - smooth(Math.min(1, p / run)));
}

// ---- 建設者(§3) ----

const BUILDER_SALT = 9601;
/** 窓の候補の最小 hash がこれ未満のときだけ出す(まばら) */
export const BUILDER_THRESHOLD = 0.2;
/** 建設者が歩く床ランの最短の長さ */
export const BUILDER_MIN_RUN = 10;

export interface BuilderSpawn {
  /** `b:x,floorY`(正規化した床ランの左端) */
  id: string;
  /** 体の左上 */
  x: number;
  y: number;
  dir: 1 | -1;
}

/**
 * 建設者の選定(argmin、近傍に最大 1 体)。歩行敵の出現集合とは独立。runs は canonicalRun で正規化済みを渡す。
 * fits(x, y) は体(幅 2・高さ 2.5)を左上 (x, y) に置けるか(地形と重ならないか)。置けない候補は飛ばす
 */
export function chooseBuilder(
  seed: number,
  runs: readonly FloorRun[],
  protectedPoints: readonly ProtectedPoint[],
  halls: readonly Rect[],
  bodyW: number,
  bodyH: number,
  fits: (x: number, y: number) => boolean,
): BuilderSpawn | null {
  let best: BuilderSpawn | null = null;
  let bestRoll = Infinity;
  for (const run of runs) {
    if (run.len < BUILDER_MIN_RUN) continue;
    const roll = hash2(seed + BUILDER_SALT, run.x, run.floorY);
    if (roll >= bestRoll) continue;
    const offset = Math.floor(hash2(seed + BUILDER_SALT + 1, run.x, run.floorY) * Math.max(1, run.len - Math.ceil(bodyW)));
    const x = run.x + offset;
    const y = run.floorY - bodyH;
    if (inRects(halls, x, x + bodyW, y, run.floorY)) continue;
    if (guardedAt(protectedPoints, x + bodyW / 2, run.floorY)) continue;
    if (!fits(x, y)) continue;
    bestRoll = roll;
    best = {
      id: `b:${run.x},${run.floorY}`,
      x,
      y,
      dir: hash2(seed + BUILDER_SALT + 2, run.x, run.floorY) < 0.5 ? -1 : 1,
    };
  }
  return best && bestRoll < BUILDER_THRESHOLD ? best : null;
}

// ---- 端末(§4) ----

const TERMINAL_SALT = 9701;
/** 窓の候補の最小 hash がこれ未満のときだけ置く */
export const TERMINAL_THRESHOLD = 0.35;

/**
 * 端末の選定(argmin、近傍に最大 1 基)。runs は canonicalRun で正規化済みを渡す。
 * 形はキャッシュと同じ { id, x, floorY }(粘着は supply.holdSpot をそのまま使う)。ID は `m:` 接頭辞。
 * キャッシュ・武器庫と重ならないよう、呼び出し側はそれらの位置を保護点に加える
 */
export function chooseTerminal(
  seed: number,
  runs: readonly FloorRun[],
  protectedPoints: readonly ProtectedPoint[],
  halls: readonly Rect[],
): SupplyCache | null {
  let best: SupplyCache | null = null;
  let bestRoll = Infinity;
  for (const run of runs) {
    if (run.len < 5) continue;
    const offset = Math.floor(hash2(seed + TERMINAL_SALT + 1, run.x, run.floorY) * Math.max(1, run.len - 1));
    const x = run.x + offset + 0.5;
    if (inRects(halls, x, x + 0.01, run.floorY, run.floorY + 0.01)) continue;
    if (guardedAt(protectedPoints, x, run.floorY)) continue;
    const roll = hash2(seed + TERMINAL_SALT, run.x, run.floorY);
    if (roll < bestRoll) {
      bestRoll = roll;
      best = { id: `m:${run.x},${run.floorY}`, x, floorY: run.floorY };
    }
  }
  return best && bestRoll < TERMINAL_THRESHOLD ? best : null;
}

/**
 * 端末の断片テキスト。このゲームの世界の言葉だけで書く(原作の固有名詞・用語は使わない)。
 * 実利の情報(回復・弾薬の場所など)は含めない
 */
export const TERMINAL_TEXTS: readonly string[] = [
  '板は下から数える。数え終えた者の記録は、まだ一件もない。',
  '孔の梯子は一本だけ。誰が架けたかの欄は空白のまま。',
  '休憩点の灯は消えない。燃料の補給記録は、ずっと前に途切れている。',
  '歩く機械は床を延ばしている。延びた床の先に、住む者はいない。',
  '昇降機の停止階は二つ。間の出入口は、途中で降りる者のために残された。',
  '軌道の車両は決まった時刻に往復する。乗客の欄は今日も零。',
  '寒鋼基層の床は冷たい。冷たいほど古い、と誰かが刻んだ。',
  '大界面の厚みは九十六。その内側を測りきった記録はない。',
  '光柱の真下では、音がひとつ低く響く。',
  '広間の番人は通路を守っていない。広間そのものを守っている。',
  '掘った跡は戻らない。構造はそれを覚えている。',
  '上の層から落ちてきた荷袋。中身は糧食と、宛先のない札が一枚。',
  'この端末の最後の利用者は、階層を一つ上がって、引き返した。',
  '拡張は止まっていない。ただ、誰のためのものでもなくなった。',
  '水域の天井から落ちる滴を、下の層では雨と呼ぶ。',
];

/** 端末 ID から断片テキストを決定的に選ぶ */
export function terminalTextFor(seed: number, id: string): string {
  const i = Math.floor(hash2(seed + TERMINAL_SALT + 2, spawnIdHash(id), 0) * TERMINAL_TEXTS.length);
  return TERMINAL_TEXTS[Math.min(i, TERMINAL_TEXTS.length - 1)];
}
