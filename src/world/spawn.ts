import { hash2 } from './noise';
import { TILE, isSolid } from './tiles';
import type { TileLookup } from '../entities/physics';

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
  /** スポーン識別子(ラン座標から決定。倒した記録の保持は第2弾) */
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
): EnemySpawn[] {
  const rate = spawnRateForLayer(layer) * rateMul;
  if (rate <= 0) return [];
  const spawns: EnemySpawn[] = [];
  for (const run of runs) {
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
      id: `w:${run.x},${run.floorY}`,
    });
  }
  return spawns;
}
