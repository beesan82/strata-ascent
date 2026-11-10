import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { bodyOverlapsSolid, type TileLookup } from './physics';
import { Builder, BUILDER_H, BUILDER_SPEED, BUILDER_W } from './builder';

/** 行 10 が x∈[0,20) の床。walls なら x=-1 と x=20 に壁 */
function room(walls: boolean): TileLookup {
  return (x: number, y: number): Tile => {
    if (walls && (x === -1 || x === 20) && y <= 10) return TILE.SOLID;
    if (y === 10 && x >= 0 && x < 20) return TILE.SOLID;
    return TILE.AIR;
  };
}

function simulate(tiles: TileLookup, seconds: number): { b: Builder; flips: number; minX: number; maxX: number; maxBottom: number } {
  const b = new Builder(5, 10 - BUILDER_H, 1);
  let flips = 0;
  let dir = b.dir;
  let minX = Infinity;
  let maxX = -Infinity;
  let maxBottom = -Infinity;
  for (let i = 0; i < seconds * 60; i++) {
    b.update(1 / 60, tiles);
    if (b.dir !== dir) {
      flips++;
      dir = b.dir;
    }
    minX = Math.min(minX, b.body.x);
    maxX = Math.max(maxX, b.body.x);
    maxBottom = Math.max(maxBottom, b.body.y + b.body.h);
    expect(bodyOverlapsSolid(tiles, b.body.x, b.body.y, b.body.w, b.body.h)).toBe(false);
  }
  return { b, flips, minX, maxX, maxBottom };
}

describe('建設者(歩行の流用)', () => {
  it('寸法は約 2×2.5 で、歩行敵よりゆっくり歩く', () => {
    expect(BUILDER_W).toBe(2);
    expect(BUILDER_H).toBe(2.5);
    expect(BUILDER_SPEED).toBeLessThan(2);
  });

  it('壁で反転して床の上を往復する', () => {
    const r = simulate(room(true), 90);
    expect(r.flips).toBeGreaterThanOrEqual(2);
    expect(r.minX).toBeGreaterThanOrEqual(0 - 1e-9);
    expect(r.maxX + BUILDER_W).toBeLessThanOrEqual(20 + 1e-9);
    expect(r.maxBottom).toBeLessThanOrEqual(10 + 1e-9);
    expect(r.b.body.onGround).toBe(true);
  });

  it('床の端で反転して落ちない', () => {
    const r = simulate(room(false), 90);
    expect(r.flips).toBeGreaterThanOrEqual(2);
    expect(r.maxBottom).toBeLessThanOrEqual(10 + 1e-9);
    expect(r.b.body.onGround).toBe(true);
  });
});
