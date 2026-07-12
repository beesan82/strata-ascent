import { hash2 } from './noise';
import { DISTRICT_SIZE, SECTOR_SIZE, sectorAt } from './hierarchy';
import { TILE, type Tile } from './tiles';

const CONNECT = 0.5;
const HALF = 2;
const HALF_TRUNK = 4;

// salt 基底: 地区(district)とセクター(sector)で系列を分ける
const DIST_HUB_X = 51000;
const DIST_HUB_Y = 52000;
const DIST_CONNECT = 53000;
const DIST_CROSS = 54000;
const SECT_CONNECT = 61000;
const SECT_CROSS = 63000;

export interface Conduit {
  role: 'floor' | 'inside' | 'vertical';
}

export function districtHub(seed: number, dx: number, dy: number): { hx: number; hy: number } {
  const hx = (0.2 + 0.6 * hash2(seed + DIST_HUB_X, dx, dy)) * DISTRICT_SIZE;
  const hy = (0.2 + 0.6 * hash2(seed + DIST_HUB_Y, dx, dy)) * DISTRICT_SIZE;
  return { hx, hy };
}

/** 順不同ペアを正規化(A↔B と B↔A を同一視) */
function orderedPair(
  ax: number, ay: number, bx: number, by: number,
): [number, number, number, number] {
  return (ax < bx || (ax === bx && ay <= by)) ? [ax, ay, bx, by] : [bx, by, ax, ay];
}

/** セル間接続の有無(順不同ペア対称)。salt で系列(district/sector)を分離 */
function connects(seed: number, salt: number, ax: number, ay: number, bx: number, by: number): boolean {
  const [px, py, qx, qy] = orderedPair(ax, ay, bx, by);
  return hash2(seed + salt, px * 73856093 + py, qx * 19349663 + qy) < CONNECT;
}

/** 共有辺上の交差点位置[0,1)(順不同ペア対称)。salt で系列を分離 */
function crossFrac(seed: number, salt: number, ax: number, ay: number, bx: number, by: number): number {
  const [px, py, qx, qy] = orderedPair(ax, ay, bx, by);
  return 0.15 + 0.7 * hash2(seed + salt, px * 73856093 + py, qx * 19349663 + qy);
}

export function hasConduit(seed: number, ax: number, ay: number, bx: number, by: number): boolean {
  return connects(seed, DIST_CONNECT, ax, ay, bx, by);
}

export function hasTrunk(seed: number, ax: number, ay: number, bx: number, by: number): boolean {
  return connects(seed, SECT_CONNECT, ax, ay, bx, by);
}

interface CorridorSpec {
  cellSize: number;
  half: number;
  hub: (seed: number, cx: number, cy: number) => { hx: number; hy: number };
  connectSalt: number;
  crossSalt: number;
}

const DISTRICT_SPEC: CorridorSpec = {
  cellSize: DISTRICT_SIZE,
  half: HALF,
  hub: districtHub,
  connectSalt: DIST_CONNECT,
  crossSalt: DIST_CROSS,
};

const SECTOR_SPEC: CorridorSpec = {
  cellSize: SECTOR_SIZE,
  half: HALF_TRUNK,
  hub: (seed, cx, cy) => {
    const s = sectorAt(seed, cx * SECTOR_SIZE, cy * SECTOR_SIZE);
    return { hx: s.hubX, hy: s.hubY };
  },
  connectSalt: SECT_CONNECT,
  crossSalt: SECT_CROSS,
};

function inHBand(px: number, py: number, x1: number, x2: number, y: number, half: number): boolean {
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  return px >= lo && px <= hi && Math.abs(py - y) <= half;
}
function inVBand(px: number, py: number, y1: number, y2: number, x: number, half: number): boolean {
  const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
  return py >= lo && py <= hi && Math.abs(px - x) <= half;
}

/**
 * ハブから各接続辺の交差点へ L 字コリドーを引き、その上なら Conduit を返す。
 * district / sector 両スケールで共有(salt と cellSize/half/hub のみ差し替え)。
 * 交差点キャップにより境界越しでも両端が必ず一致する。
 */
function corridorAt(seed: number, x: number, y: number, spec: CorridorSpec): Conduit | null {
  const { cellSize, half } = spec;
  const dx = Math.floor(x / cellSize);
  const dy = Math.floor(y / cellSize);
  const lx = x - dx * cellSize;
  const ly = y - dy * cellSize;
  const { hx, hy } = spec.hub(seed, dx, dy);

  const edges: { ex: number; ey: number }[] = [];
  if (connects(seed, spec.connectSalt, dx, dy, dx + 1, dy))
    edges.push({ ex: cellSize, ey: crossFrac(seed, spec.crossSalt, dx, dy, dx + 1, dy) * cellSize });
  if (connects(seed, spec.connectSalt, dx, dy, dx - 1, dy))
    edges.push({ ex: 0, ey: crossFrac(seed, spec.crossSalt, dx, dy, dx - 1, dy) * cellSize });
  if (connects(seed, spec.connectSalt, dx, dy, dx, dy + 1))
    edges.push({ ex: crossFrac(seed, spec.crossSalt, dx, dy, dx, dy + 1) * cellSize, ey: cellSize });
  if (connects(seed, spec.connectSalt, dx, dy, dx, dy - 1))
    edges.push({ ex: crossFrac(seed, spec.crossSalt, dx, dy, dx, dy - 1) * cellSize, ey: 0 });

  let onVertical = false;
  let onHorizontal = false;
  let onCross = false;
  for (const { ex, ey } of edges) {
    if (inHBand(lx, ly, hx, ex, hy, half)) onHorizontal = true;
    if (inVBand(lx, ly, hy, ey, ex, half)) onVertical = true;
    // 交差点キャップ: 両隣が同一ワールド点(順不同ペア由来)を計算するため、
    // ここで half 半径の四角キャップを張ると境界越しに必ず重なり継ぎ目が合う
    if (Math.abs(lx - ex) <= half && Math.abs(ly - ey) <= half) onCross = true;
  }
  if (!onVertical && !onHorizontal && !onCross) return null;

  if (onVertical || onCross) {
    for (const { ex } of edges) {
      if (Math.abs(lx - ex) < 1) return { role: 'vertical' };
    }
    return { role: 'inside' };
  }
  if (Math.abs(ly - (hy + half)) < 1) return { role: 'floor' };
  return { role: 'inside' };
}

export function conduitAt(seed: number, x: number, y: number): Conduit | null {
  return corridorAt(seed, x, y, DISTRICT_SPEC);
}

export function sectorTrunkAt(seed: number, x: number, y: number): Conduit | null {
  return corridorAt(seed, x, y, SECTOR_SPEC);
}

/** セクター幹線のタイル化。該当しなければ null(networkTileAt を鏡写し) */
export function sectorTrunkTileAt(seed: number, x: number, y: number): Tile | null {
  const c = sectorTrunkAt(seed, x, y);
  if (!c) return null;
  if (c.role === 'vertical') return TILE.LADDER;
  if (c.role === 'floor') return TILE.SOLID;
  return TILE.AIR;
}

/** コリドーのタイル化。全系統。該当しなければ null */
export function networkTileAt(seed: number, x: number, y: number): Tile | null {
  const c = conduitAt(seed, x, y);
  if (!c) return null;
  if (c.role === 'vertical') return TILE.LADDER;
  if (c.role === 'floor') return TILE.SOLID;
  return TILE.AIR;
}
