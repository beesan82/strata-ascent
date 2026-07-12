import { describe, expect, it } from 'vitest';
import { TILE } from './tiles';
import { facilityTileAt } from './facility';
import { regionAt, roomAt, ROOM_SIZE, REGION_SIZE } from './hierarchy';

/**
 * 指定 system の present room セルを1つ探す。
 * system は region 単位(REGION_SIZE)で決まるので region をまたいで探す。
 */
function findRoomOfSystem(seed: number, system: string): { rmx: number; rmy: number } {
  for (let r = 0; r < 24; r++) {
    for (const [rx, ry] of [[r, 0], [0, r], [r, -1], [-1, r], [r, r], [-r, r]] as const) {
      const rwx = rx * REGION_SIZE, rwy = ry * REGION_SIZE;
      if (regionAt(seed, rwx, rwy).system !== system) continue;
      for (let rmy = 0; rmy < 80; rmy++) {
        for (let rmx = 0; rmx < 80; rmx++) {
          const x = rwx + rmx * ROOM_SIZE, y = rwy + rmy * ROOM_SIZE;
          if (roomAt(seed, x, y).present) {
            return { rmx: Math.floor(x / ROOM_SIZE), rmy: Math.floor(y / ROOM_SIZE) };
          }
        }
      }
    }
  }
  throw new Error(`system=${system} の present room が見つからない`);
}
const findWaterRoom = (seed: number) => findRoomOfSystem(seed, 'water');

describe('facilityTileAt', () => {
  it('決定論: 同じ座標なら同じ結果', () => {
    const { rmx, rmy } = findWaterRoom(42);
    const x = rmx * ROOM_SIZE + 64, y = rmy * ROOM_SIZE + 64;
    expect(facilityTileAt(42, x, y)).toBe(facilityTileAt(42, x, y));
  });

  it('水系統の present room 内には SOLID壁・AIR内部・LADDER がすべて出現する', () => {
    const { rmx, rmy } = findWaterRoom(42);
    const kinds = new Set<number | null>();
    for (let ly = 0; ly < ROOM_SIZE; ly++) {
      for (let lx = 0; lx < ROOM_SIZE; lx++) {
        kinds.add(facilityTileAt(42, rmx * ROOM_SIZE + lx, rmy * ROOM_SIZE + ly));
      }
    }
    expect(kinds.has(TILE.SOLID)).toBe(true);
    expect(kinds.has(TILE.AIR)).toBe(true);
    expect(kinds.has(TILE.LADDER)).toBe(true);
    expect(kinds.has(null)).toBe(true);
  });

  it('チャンバーには縦に貫通する内部LADDER列が存在する(縦移動保証)', () => {
    const { rmx, rmy } = findWaterRoom(42);
    let maxRun = 0;
    for (let lx = 0; lx < ROOM_SIZE; lx++) {
      let run = 0, best = 0;
      for (let ly = 0; ly < ROOM_SIZE; ly++) {
        if (facilityTileAt(42, rmx * ROOM_SIZE + lx, rmy * ROOM_SIZE + ly) === TILE.LADDER) {
          run++; best = Math.max(best, run);
        } else run = 0;
      }
      maxRun = Math.max(maxRun, best);
    }
    expect(maxRun).toBeGreaterThan(ROOM_SIZE * 0.3);
  });

  it('決定論(再現): room内の複数点が毎回同じ', () => {
    const { rmx, rmy } = findWaterRoom(42);
    for (const [ox, oy] of [[70, 70], [10, 10]] as const) {
      const x = rmx * ROOM_SIZE + ox, y = rmy * ROOM_SIZE + oy;
      expect(facilityTileAt(42, x, y)).toBe(facilityTileAt(42, x, y));
    }
  });
});

describe('facilityTileAt 全系統(段階4)', () => {
  it('どの系統の present room でもチャンバーが生成される(SOLID/AIR/LADDER/null が出る)', () => {
    for (const sys of ['water', 'power', 'habitation', 'disposal', 'foundry'] as const) {
      const { rmx, rmy } = findRoomOfSystem(42, sys);
      const kinds = new Set<number | null>();
      for (let ly = 0; ly < ROOM_SIZE; ly += 2) {
        for (let lx = 0; lx < ROOM_SIZE; lx += 2) {
          kinds.add(facilityTileAt(42, rmx * ROOM_SIZE + lx, rmy * ROOM_SIZE + ly));
        }
      }
      expect(kinds.has(TILE.SOLID)).toBe(true);
      expect(kinds.has(TILE.AIR)).toBe(true);
      expect(kinds.has(TILE.LADDER)).toBe(true);
      expect(kinds.has(null)).toBe(true);
    }
  });

  it('不在(present=false)の room は null', () => {
    for (let rmx = 0; rmx < 2000; rmx++) {
      if (!roomAt(42, rmx * ROOM_SIZE, 0).present) {
        expect(facilityTileAt(42, rmx * ROOM_SIZE + 64, 64)).toBeNull();
        return;
      }
    }
    throw new Error('present=false の room が見つからない');
  });
});
