import { hash2 } from './noise';
import { regionAt, roomAt, ROOM_SIZE } from './hierarchy';
import { TILE, type Tile } from './tiles';

/**
 * 施設タイル(段階2: 水系統の貯水池チャンバーのみ実タイル化)。
 * 該当しなければ null(呼び出し側=tileAtがノイズ躯体にフォールバック)。純粋関数。
 */
export function facilityTileAt(seed: number, x: number, y: number): Tile | null {
  if (regionAt(seed, x, y).system !== 'water') return null;
  const room = roomAt(seed, x, y);
  if (!room.present) return null;

  const rmx = Math.floor(x / ROOM_SIZE);
  const rmy = Math.floor(y / ROOM_SIZE);
  const lx = x - rmx * ROOM_SIZE;
  const ly = y - rmy * ROOM_SIZE;
  const vs = room.variantSeed;

  const marginL = 8 + Math.floor(hash2(vs, 1, 0) * 16);
  const marginR = 8 + Math.floor(hash2(vs, 2, 0) * 16);
  const marginT = 8 + Math.floor(hash2(vs, 3, 0) * 16);
  const marginB = 8 + Math.floor(hash2(vs, 4, 0) * 16);
  const x0 = marginL, x1 = ROOM_SIZE - marginR;
  const y0 = marginT, y1 = ROOM_SIZE - marginB;
  if (lx < x0 || lx >= x1 || ly < y0 || ly >= y1) return null;

  const WALL = 2;
  const onWall = lx < x0 + WALL || lx >= x1 - WALL || ly < y0 + WALL || ly >= y1 - WALL;

  const ladderX = x0 + WALL + 1 + Math.floor(hash2(vs, 5, 0) * (x1 - x0 - 2 * WALL - 2));
  if (lx === ladderX && ly >= y0 + WALL && ly < y1 - WALL) {
    return TILE.LADDER;
  }

  if (onWall) {
    const doorBottom = ly >= y1 - WALL;
    const doorSide = lx < x0 + WALL || lx >= x1 - WALL;
    if (doorBottom) {
      const doorC = x0 + Math.floor(hash2(vs, 6, 0) * (x1 - x0));
      if (Math.abs(lx - doorC) <= 3) return TILE.AIR;
    }
    if (doorSide && Math.abs(ly - (y0 + (y1 - y0) * 0.6)) <= 4) return TILE.AIR;
    if (room.decay > 0.5 && hash2(vs + 100, lx, ly) < room.decay - 0.5) return TILE.AIR;
    return TILE.SOLID;
  }

  const bands = 2 + Math.floor(hash2(vs, 7, 0) * 3);
  for (let b = 1; b <= bands; b++) {
    const cy = y0 + WALL + Math.round(((y1 - y0 - 2 * WALL) * b) / (bands + 1));
    if (ly === cy) {
      if (hash2(vs + 200, lx, b) < 0.15) return TILE.AIR;
      return TILE.SOLID;
    }
  }
  if (room.decay > 0.4 && hash2(vs + 300, lx, ly) < (room.decay - 0.4) * 0.3) return TILE.SOLID;

  return TILE.AIR;
}
