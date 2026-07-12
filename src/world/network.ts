import { hash2 } from './noise';
import { DISTRICT_SIZE } from './hierarchy';

const CONNECT = 0.5;
const HALF = 2;

export interface Conduit {
  role: 'floor' | 'inside' | 'vertical';
}

export function districtHub(seed: number, dx: number, dy: number): { hx: number; hy: number } {
  const hx = (0.2 + 0.6 * hash2(seed + 51000, dx, dy)) * DISTRICT_SIZE;
  const hy = (0.2 + 0.6 * hash2(seed + 52000, dx, dy)) * DISTRICT_SIZE;
  return { hx, hy };
}

export function hasConduit(seed: number, ax: number, ay: number, bx: number, by: number): boolean {
  const [px, py, qx, qy] = (ax < bx || (ax === bx && ay <= by))
    ? [ax, ay, bx, by] : [bx, by, ax, ay];
  return hash2(seed + 53000, px * 73856093 + py, qx * 19349663 + qy) < CONNECT;
}

function crossFrac(seed: number, ax: number, ay: number, bx: number, by: number): number {
  const [px, py, qx, qy] = (ax < bx || (ax === bx && ay <= by))
    ? [ax, ay, bx, by] : [bx, by, ax, ay];
  return 0.15 + 0.7 * hash2(seed + 54000, px * 73856093 + py, qx * 19349663 + qy);
}

function inHBand(px: number, py: number, x1: number, x2: number, y: number): boolean {
  const lo = Math.min(x1, x2), hi = Math.max(x1, x2);
  return px >= lo && px <= hi && Math.abs(py - y) <= HALF;
}
function inVBand(px: number, py: number, y1: number, y2: number, x: number): boolean {
  const lo = Math.min(y1, y2), hi = Math.max(y1, y2);
  return py >= lo && py <= hi && Math.abs(px - x) <= HALF;
}

export function conduitAt(seed: number, x: number, y: number): Conduit | null {
  const dx = Math.floor(x / DISTRICT_SIZE);
  const dy = Math.floor(y / DISTRICT_SIZE);
  const lx = x - dx * DISTRICT_SIZE;
  const ly = y - dy * DISTRICT_SIZE;
  const { hx, hy } = districtHub(seed, dx, dy);

  const edges: { ex: number; ey: number }[] = [];
  if (hasConduit(seed, dx, dy, dx + 1, dy)) edges.push({ ex: DISTRICT_SIZE, ey: crossFrac(seed, dx, dy, dx + 1, dy) * DISTRICT_SIZE });
  if (hasConduit(seed, dx, dy, dx - 1, dy)) edges.push({ ex: 0, ey: crossFrac(seed, dx, dy, dx - 1, dy) * DISTRICT_SIZE });
  if (hasConduit(seed, dx, dy, dx, dy + 1)) edges.push({ ex: crossFrac(seed, dx, dy, dx, dy + 1) * DISTRICT_SIZE, ey: DISTRICT_SIZE });
  if (hasConduit(seed, dx, dy, dx, dy - 1)) edges.push({ ex: crossFrac(seed, dx, dy, dx, dy - 1) * DISTRICT_SIZE, ey: 0 });

  let onVertical = false;
  let onHorizontal = false;
  let onCross = false;
  for (const { ex, ey } of edges) {
    if (inHBand(lx, ly, hx, ex, hy)) onHorizontal = true;
    if (inVBand(lx, ly, hy, ey, ex)) onVertical = true;
    // 交差点キャップ: 両隣が同一ワールド点(順不同ペア由来)を計算するため、
    // ここで HALF 半径の四角キャップを張ると境界越しに必ず重なり継ぎ目が合う
    if (Math.abs(lx - ex) <= HALF && Math.abs(ly - ey) <= HALF) onCross = true;
  }
  if (!onVertical && !onHorizontal && !onCross) return null;

  if (onVertical || onCross) {
    for (const { ex } of edges) {
      if (Math.abs(lx - ex) < 1) return { role: 'vertical' };
    }
    return { role: 'inside' };
  }
  if (Math.abs(ly - (hy + HALF)) < 1) return { role: 'floor' };
  return { role: 'inside' };
}
