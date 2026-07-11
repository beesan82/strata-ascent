import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { moveBody, type Body } from './physics';

/** y=5行だけが床、x=10列だけが壁のテストワールド */
const testTiles = (tx: number, ty: number): Tile => {
  if (ty === 5) return TILE.SOLID;
  if (tx === 10) return TILE.SOLID;
  return TILE.AIR;
};

const emptyTiles = (): Tile => TILE.AIR;

function makeBody(x: number, y: number): Body {
  return { x, y, w: 0.75, h: 1.75, vx: 0, vy: 0, onGround: false };
}

describe('moveBody', () => {
  it('何もない空間では等速で動く', () => {
    const b = makeBody(0, 0);
    b.vx = 4;
    b.vy = 2;
    moveBody(b, 0.5, emptyTiles);
    expect(b.x).toBeCloseTo(2);
    expect(b.y).toBeCloseTo(1);
    expect(b.onGround).toBe(false);
  });

  it('落下すると床の上で止まり、onGroundになる', () => {
    const b = makeBody(2, 2); // 体の底 = 3.75、床上面 = 5
    b.vy = 10;
    moveBody(b, 1, testTiles);
    expect(b.y + b.h).toBeLessThanOrEqual(5 + 1e-6);
    expect(b.y + b.h).toBeGreaterThan(4.8); // 床のすぐ上まで詰めている
    expect(b.vy).toBe(0);
    expect(b.onGround).toBe(true);
  });

  it('壁に向かって歩くと壁の手前で止まる', () => {
    const b = makeBody(8, 0); // 右端 = 8.75、壁の左面 = 10
    b.vx = 10;
    moveBody(b, 1, testTiles);
    expect(b.x + b.w).toBeLessThanOrEqual(10 + 1e-6);
    expect(b.x + b.w).toBeGreaterThan(9.8);
    expect(b.vx).toBe(0);
  });

  it('梯子タイルは通り抜けられる(SOLIDのみが衝突対象)', () => {
    const ladderTiles = (_tx: number, ty: number): Tile =>
      ty === 5 ? TILE.LADDER : TILE.AIR;
    const b = makeBody(0, 3);
    b.vy = 10;
    moveBody(b, 1, ladderTiles);
    expect(b.y).toBeCloseTo(13); // 素通り
  });
});
