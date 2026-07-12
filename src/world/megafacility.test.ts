import { describe, expect, it } from 'vitest';
import { megaFacilityAt, MEGA_SIZE } from './megafacility';
import { sectorAt, SECTOR_SIZE } from './hierarchy';
import { TILE } from './tiles';

function hubWorld(seed: number, sx: number, sy: number) {
  const s = sectorAt(seed, sx * SECTOR_SIZE, sy * SECTOR_SIZE);
  return { x: sx * SECTOR_SIZE + s.hubX, y: sy * SECTOR_SIZE + s.hubY };
}

describe('megaFacilityAt', () => {
  it('決定論', () => {
    const { x, y } = hubWorld(42, 0, 0);
    expect(megaFacilityAt(42, x, y)).toBe(megaFacilityAt(42, x, y));
  });
  it('ハブ周辺に大構造(SOLID/AIR/LADDER が出る)', () => {
    const { x, y } = hubWorld(42, 0, 0);
    const kinds = new Set<number | null>();
    for (let dy = -MEGA_SIZE / 2; dy < MEGA_SIZE / 2; dy += 2)
      for (let dx = -MEGA_SIZE / 2; dx < MEGA_SIZE / 2; dx += 2)
        kinds.add(megaFacilityAt(42, Math.round(x + dx), Math.round(y + dy)));
    expect(kinds.has(TILE.SOLID)).toBe(true);
    expect(kinds.has(TILE.AIR)).toBe(true);
    expect(kinds.has(TILE.LADDER)).toBe(true);
  });
  it('ハブから MEGA_SIZE 離れた点は null', () => {
    const { x, y } = hubWorld(42, 0, 0);
    expect(megaFacilityAt(42, x + MEGA_SIZE, y + MEGA_SIZE)).toBeNull();
  });
  it('全高を貫く内部梯子(縦移動保証, run > MEGA_SIZE*0.4)', () => {
    const { x, y } = hubWorld(42, 0, 0);
    let maxRun = 0;
    for (let dx = -MEGA_SIZE / 2; dx < MEGA_SIZE / 2; dx++) {
      let run = 0, best = 0;
      for (let dy = -MEGA_SIZE / 2; dy < MEGA_SIZE / 2; dy++) {
        if (megaFacilityAt(42, Math.round(x + dx), Math.round(y + dy)) === TILE.LADDER) { run++; best = Math.max(best, run); }
        else run = 0;
      }
      maxRun = Math.max(maxRun, best);
    }
    expect(maxRun).toBeGreaterThan(MEGA_SIZE * 0.4);
  });
  it('複数セクターで生成される(別ハブでも大構造)', () => {
    for (const [sx, sy] of [[1, 0], [0, 1], [2, -1]] as const) {
      const { x, y } = hubWorld(42, sx, sy);
      expect(megaFacilityAt(42, x, y)).not.toBeNull();
    }
  });
});
