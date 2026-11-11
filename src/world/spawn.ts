import { hash2 } from './noise';
import { TILE, isSolid } from './tiles';
import type { TileLookup } from '../entities/physics';
import type { BiomeId } from './biomeCells';

/**
 * 敵の出現決定(アクション化 第1弾・第3段、設計書 2026-11-04-action-phase1)。
 * ワールド生成は変えず、地形をその場でスキャンして「戦闘に適した床」にだけ
 * 決定論で敵を置く。適した地形が無ければ無戦闘でよい、が自然に成立する。
 */

export interface FloorRun {
  /** ランの左端タイル x */
  x: number;
  /** 床タイルの行 y(敵はこの上に立つ) */
  floorY: number;
  /** ランの長さ(タイル) */
  len: number;
}

export interface EnemySpawn {
  /** 敵ボディの左上(タイル座標) */
  x: number;
  y: number;
  dir: 1 | -1;
  /** スポーン識別子(ラン座標から決定。撃破記録の保持は §4) */
  id: string;
}

export interface ProtectedPoint {
  x: number;
  y: number;
  /** 除外半径(タイル、チェビシェフ距離) */
  r: number;
}

const MIN_RUN = 5;

/**
 * 範囲 [x0, x1) × [y0, y1) で「平坦な床が MIN_RUN 以上続き、頭上 2 タイルが
 * 空き(固体でも梯子でもない)」ランを列挙する。床行ごとに左から走査する。
 */
export function findFloorRuns(
  tiles: TileLookup,
  x0in: number,
  y0in: number,
  x1in: number,
  y1in: number,
): FloorRun[] {
  const x0 = Math.floor(x0in);
  const y0 = Math.floor(y0in);
  const x1 = Math.floor(x1in);
  const y1 = Math.floor(y1in);
  const runs: FloorRun[] = [];
  for (let ty = y0; ty < y1; ty++) {
    let start = -1;
    for (let tx = x0; tx <= x1; tx++) {
      const ok =
        tx < x1 &&
        isSolid(tiles(tx, ty)) &&
        tiles(tx, ty - 1) === TILE.AIR &&
        tiles(tx, ty - 2) === TILE.AIR;
      if (ok && start < 0) start = tx;
      if (!ok && start >= 0) {
        if (tx - start >= MIN_RUN) runs.push({ x: start, floorY: ty, len: tx - start });
        start = -1;
      }
    }
  }
  return runs;
}

/** 出現率: 第 0 層(開始 cell)は 0、以降は漸増して上限 0.7 */
export function spawnRateForLayer(layer: number): number {
  if (layer <= 0) return 0;
  return Math.min(0.2 + (layer - 1) * 0.08, 0.7);
}

const DENSITY_DX = 24;
const DENSITY_DY = 12;

/**
 * ランごとに hash で出現を決め、保護点の近傍と密度上限(近傍に既選がある)を除く。
 * 位置はラン内のオフセットも hash で決める。完全に決定論。
 * rateMul は地区倍率(ゾーン化 段階 2、設計 §5): 層番号ベースの基礎率に乗算する接続点。
 */
export function chooseSpawns(
  seed: number,
  layer: number,
  runs: readonly FloorRun[],
  protectedPoints: readonly ProtectedPoint[],
  rateMul = 1,
  defeated?: ReadonlySet<string>,
): EnemySpawn[] {
  const rate = spawnRateForLayer(layer) * rateMul;
  if (rate <= 0) return [];
  const spawns: EnemySpawn[] = [];
  for (const run of runs) {
    const id = `w:${run.x},${run.floorY}`;
    if (hash2(seed + 4001, run.x, run.floorY) >= rate) continue;
    const offset = Math.floor(hash2(seed + 4002, run.x, run.floorY) * Math.max(1, run.len - 2));
    const sx = run.x + offset;
    const sy = run.floorY - 0.9; // 敵ボディ(高さ 0.9)の左上。床の上にちょうど乗る
    const guarded = protectedPoints.some(
      (p) => Math.max(Math.abs(sx - p.x), Math.abs(sy - p.y)) <= p.r,
    );
    if (guarded) continue;
    const crowded = spawns.some(
      (s) => Math.abs(s.x - sx) < DENSITY_DX && Math.abs(s.y - sy) < DENSITY_DY,
    );
    if (crowded) continue;
    spawns.push({
      x: sx,
      y: sy,
      dir: hash2(seed + 4003, run.x, run.floorY) < 0.5 ? -1 : 1,
      id,
    });
  }
  // 撃破済みは選定の最後に差し引く(第2弾 §4 の記録保持)。選定の途中で外すと
  // 密度判定が緩んで別の候補が繰り上がり、「倒したら別の個体が出る」置換が起きるため、
  // 出現集合は (seed, 地形, 出現率) だけで決め、撃破記録は減算としてのみ働かせる
  if (defeated) return spawns.filter((s) => !defeated.has(s.id));
  return spawns;
}

/**
 * 飛行敵の出現(アクション化 第2弾・§1)。床ランではなく「空間のポケット」を使う。
 * 地区ゲートはゾーン設計 §5 の予約どおり初出を大空洞水域に限り、
 * v2.0 Task 1 で電力区と生体異物区にも開放した(倍率の根拠は FLYER_MUL のコメント)。
 * 基礎率は Walker と共有するが地区倍率は spawnMul とは独立に掛ける。
 */

export interface AirPocket {
  /** ポケット矩形(5 幅 × 4 高)の左上タイル */
  x: number;
  y: number;
}

export interface FlyerSpawn {
  /** アンカー点(ポケット中心、タイル座標)。巡回はこの点を中心にする */
  x: number;
  y: number;
  /** 巡回のうねりの位相(ラジアン、個体差) */
  phase: number;
  /** スポーン識別子(`f:` 接頭辞で Walker と名前空間を分ける) */
  id: string;
}

/** 矩形(大広間の除外判定用。GrandHall と構造互換) */
export interface SpawnRect {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const POCKET_W = 5;
export const POCKET_H = 4;

/** 範囲 [x0, x1) × [y0, y1) で POCKET_W × POCKET_H の AIR 矩形が収まる左上を列挙する */
export function findAirPockets(
  tiles: TileLookup,
  x0in: number,
  y0in: number,
  x1in: number,
  y1in: number,
): AirPocket[] {
  const x0 = Math.floor(x0in);
  const y0 = Math.floor(y0in);
  const x1 = Math.floor(x1in) - POCKET_W;
  const y1 = Math.floor(y1in) - POCKET_H;
  const pockets: AirPocket[] = [];
  for (let ay = y0; ay <= y1; ay++) {
    for (let ax = x0; ax <= x1; ax++) {
      let ok = true;
      for (let dy = 0; dy < POCKET_H && ok; dy++) {
        for (let dx = 0; dx < POCKET_W; dx++) {
          if (tiles(ax + dx, ay + dy) !== TILE.AIR) {
            ok = false;
            break;
          }
        }
      }
      if (ok) pockets.push({ x: ax, y: ay });
    }
  }
  return pockets;
}

/**
 * 飛行敵の地区ゲート(第2弾 §1、v2.0 Task 1 で他地区へ開放)。
 * 初出は大空洞水域のみだったが、v2.0 で電力区(power)と生体異物区(biomech)にも開放する。
 * 倍率は出現統計(scripts/flyer-survey.ts 相当の計測、seed [1, 42, 20260711, 7, 99]、
 * 地区ごとに 60 スキャン)で決めた: power 0.5 では飛行敵平均 5.717・合計 7.750、
 * biomech 0.75 では飛行敵平均 5.467・合計 7.400 で、いずれも水域(飛行敵 7.733・
 * 合計 8.817)以下に収まり、飛行敵の主座は水域のままになる。
 * 他地区への開放はこの表の数値を変えるだけで済む。
 */
const FLYER_MUL: Record<BiomeId, number> = {
  coldSteel: 0,
  habitation: 0,
  disposal: 0,
  waterVoid: 1.0,
  power: 0.5,
  foundry: 0,
  biomech: 0.75,
};

export function flyerMulFor(biomeId: BiomeId): number {
  return FLYER_MUL[biomeId];
}

const FLYER_DENSITY_DX = 32;
const FLYER_DENSITY_DY = 16;

/**
 * ポケットごとに hash で飛行敵の出現を決める。Walker と同じ流儀:
 * 保護点の近傍・密度上限・大広間との重なり・撃破済みを除く。完全に決定論。
 */
export function chooseFlyerSpawns(
  seed: number,
  layer: number,
  pockets: readonly AirPocket[],
  protectedPoints: readonly ProtectedPoint[],
  biomeId: BiomeId,
  halls: readonly SpawnRect[],
  defeated?: ReadonlySet<string>,
): FlyerSpawn[] {
  const rate = spawnRateForLayer(layer) * flyerMulFor(biomeId);
  if (rate <= 0) return [];
  const spawns: FlyerSpawn[] = [];
  for (const p of pockets) {
    const id = `f:${p.x},${p.y}`;
    // 大広間はボスの arena として空ける(§1): ポケット矩形が少しでも重なれば出さない
    const inHall = halls.some(
      (h) => p.x < h.x1 && p.x + POCKET_W > h.x0 && p.y < h.y1 && p.y + POCKET_H > h.y0,
    );
    if (inHall) continue;
    if (hash2(seed + 4101, p.x, p.y) >= rate) continue;
    const cx = p.x + POCKET_W / 2;
    const cy = p.y + POCKET_H / 2;
    const guarded = protectedPoints.some(
      (pt) => Math.max(Math.abs(cx - pt.x), Math.abs(cy - pt.y)) <= pt.r,
    );
    if (guarded) continue;
    const crowded = spawns.some(
      (s) => Math.abs(s.x - cx) < FLYER_DENSITY_DX && Math.abs(s.y - cy) < FLYER_DENSITY_DY,
    );
    if (crowded) continue;
    spawns.push({ x: cx, y: cy, phase: hash2(seed + 4103, p.x, p.y) * Math.PI * 2, id });
  }
  // 撃破済みは Walker と同じく選定の最後に差し引く(密度の繰り上がりによる置換を防ぐ)
  if (defeated) return spawns.filter((s) => !defeated.has(s.id));
  return spawns;
}

/**
 * 飛行敵の粘着保持の保持半径(タイル、チェビシェフ距離。設計 2026-11-11-flyer-stickiness)。
 * 敵スキャンの窓(横 ±40・縦 ±24)より広くし、窓の位置で選定が入れ替わっただけでは手放さない。
 */
export const FLYER_HOLD_RADIUS = 64;

/** 保持の判定に要る飛行敵の実体の形(main.ts の `{ spawnId, flyer: Flyer }` と構造互換) */
export interface HeldFlyer {
  spawnId: string;
  flyer: { readonly anchorX: number; readonly anchorY: number };
}

/**
 * 飛行敵の粘着保持(設計 2026-11-11-flyer-stickiness)。chooseFlyerSpawns は列挙順の貪欲な
 * 密度判定なので、開けた空間では走査窓が数タイルずれるだけで選定集合が入れ替わる。
 * 生存中の個体は、今回の選定に入っているか、スポーンアンカーがプレイヤーから保持半径以内なら残す。
 * 地区ゲートが閉じた地区(選定が空)でも同じ規則で残す(新規出現を止めるだけで、近くの個体は消さない)。
 */
export function retainFlyers<T extends HeldFlyer>(
  current: readonly T[],
  desiredIds: ReadonlySet<string>,
  playerX: number,
  playerY: number,
  radius: number = FLYER_HOLD_RADIUS,
): T[] {
  return current.filter(
    (e) =>
      desiredIds.has(e.spawnId) ||
      Math.max(Math.abs(e.flyer.anchorX - playerX), Math.abs(e.flyer.anchorY - playerY)) <= radius,
  );
}

/**
 * 保持した個体に対して新しく湧かせる選定。既に実体がある ID と、保持中の個体のアンカーに
 * 密度上限(32×16)の内側で近接する選定は湧かせない(窓のずれで選ばれた別の代表が、保持中の
 * 個体の隣に湧いて密度が倍になるのを防ぐ)。選定どうしは chooseFlyerSpawns が密度を満たしている
 * ので、選定に入っている保持個体が他の選定を締め出すことはない。
 */
export function newFlyerSpawns(desired: readonly FlyerSpawn[], kept: readonly HeldFlyer[]): FlyerSpawn[] {
  return desired.filter(
    (d) =>
      !kept.some(
        (k) =>
          k.spawnId === d.id ||
          (Math.abs(k.flyer.anchorX - d.x) < FLYER_DENSITY_DX && Math.abs(k.flyer.anchorY - d.y) < FLYER_DENSITY_DY),
      ),
  );
}

/**
 * 固定砲台の出現(v2.0 Task 6)。Walker と同じ床ラン + hash の決定論で、
 * 出現地区は電力区と精錬区のみ(倍率表でゲート)。
 */

export interface TurretSpawn {
  /** 砲台ボディの左上(タイル座標) */
  x: number;
  y: number;
  /** スポーン識別子(`t:` 接頭辞で Walker / Flyer と名前空間を分ける) */
  id: string;
}

/** 砲台の地区ゲート: 電力区が本場(1.0)、精錬区は 0.8、他地区は 0 */
const TURRET_MUL: Record<BiomeId, number> = {
  coldSteel: 0,
  habitation: 0,
  disposal: 0,
  waterVoid: 0,
  power: 1.0,
  foundry: 0.8,
  biomech: 0,
};

export function turretMulFor(biomeId: BiomeId): number {
  return TURRET_MUL[biomeId];
}

/** 既選の歩行敵との近接除外の距離(タイル、チェビシェフ距離) */
const TURRET_OCCUPIED_R = 3;

/**
 * ランごとに hash で砲台の出現を決める。Walker と同じ流儀:
 * 保護点の近傍・大広間の矩形内・歩行敵の選定済み位置との近接(3 タイル以内)・
 * 砲台同士の密度上限(24×12 目安)を除く。撃破済みは選定後の減算。
 * hash の塩は 4301 系(Walker 4001 系、Flyer 4101 系、drop 4201 と衝突しない)。
 */
export function chooseTurretSpawns(
  seed: number,
  layer: number,
  runs: readonly FloorRun[],
  protectedPoints: readonly ProtectedPoint[],
  biomeId: BiomeId,
  halls: readonly SpawnRect[],
  occupied: readonly { x: number; y: number }[],
  defeated?: ReadonlySet<string>,
): TurretSpawn[] {
  const rate = spawnRateForLayer(layer) * turretMulFor(biomeId);
  if (rate <= 0) return [];
  const spawns: TurretSpawn[] = [];
  for (const run of runs) {
    const id = `t:${run.x},${run.floorY}`;
    if (hash2(seed + 4301, run.x, run.floorY) >= rate) continue;
    const offset = Math.floor(hash2(seed + 4302, run.x, run.floorY) * Math.max(1, run.len - 2));
    const sx = run.x + offset;
    const sy = run.floorY - 0.9; // 砲台ボディ(高さ 0.9)の左上。床の上にちょうど乗る
    const guarded = protectedPoints.some(
      (p) => Math.max(Math.abs(sx - p.x), Math.abs(sy - p.y)) <= p.r,
    );
    if (guarded) continue;
    // 大広間はボスの arena として空ける: ボディ矩形が少しでも重なれば出さない
    const inHall = halls.some(
      (h) => sx < h.x1 && sx + 0.9 > h.x0 && sy < h.y1 && sy + 0.9 > h.y0,
    );
    if (inHall) continue;
    // 歩行敵の選定済み位置から 3 タイル以内には置かない(重なり・詰まりの回避)
    const nearOccupied = occupied.some(
      (o) => Math.max(Math.abs(sx - o.x), Math.abs(sy - o.y)) <= TURRET_OCCUPIED_R,
    );
    if (nearOccupied) continue;
    const crowded = spawns.some(
      (s) => Math.abs(s.x - sx) < DENSITY_DX && Math.abs(s.y - sy) < DENSITY_DY,
    );
    if (crowded) continue;
    spawns.push({ x: sx, y: sy, id });
  }
  // 撃破済みは Walker と同じく選定の最後に差し引く(密度の繰り上がりによる置換を防ぐ)
  if (defeated) return spawns.filter((s) => !defeated.has(s.id));
  return spawns;
}
