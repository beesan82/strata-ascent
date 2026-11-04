import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { Walker } from './enemy';

const noTiles = (): Tile => TILE.AIR;
/** y=10 行が床(x は全面) */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);
/** 床は x<8 まで(崖)、y=10 行 */
const ledgeTiles = (tx: number, ty: number): Tile => (ty === 10 && tx < 8 ? TILE.SOLID : TILE.AIR);
/** 床 + x=12 列の壁 */
const wallTiles = (tx: number, ty: number): Tile => {
  if (ty === 10) return TILE.SOLID;
  if (tx === 12 && ty < 10) return TILE.SOLID;
  return TILE.AIR;
};

describe('Walker(歩行敵)', () => {
  it('床の上を巡回し、重力で着地して落ちない', () => {
    const w = new Walker(2, 8, 1);
    for (let i = 0; i < 60; i++) w.update(1 / 60, floorTiles);
    expect(w.body.onGround).toBe(true);
    expect(w.body.x).toBeGreaterThan(2);
  });

  it('壁に当たると反転する', () => {
    const w = new Walker(9, 9, 1);
    for (let i = 0; i < 120; i++) w.update(1 / 60, wallTiles);
    expect(w.dir).toBe(-1);
    expect(w.body.x).toBeLessThan(11.2); // 壁(x=12)へめり込まない
  });

  it('床の端で反転し、落ちない', () => {
    const w = new Walker(5, 9, 1);
    for (let i = 0; i < 240; i++) w.update(1 / 60, ledgeTiles);
    expect(w.body.y).toBeLessThan(10); // 落ちていない
    expect(w.dir).toBe(-1); // 端で折り返した
  });

  it('3 発で倒れる(hit のたびに HP が減る)', () => {
    const w = new Walker(0, 0, 1);
    expect(w.hit(1)).toBe(false);
    expect(w.hit(1)).toBe(false);
    expect(w.hit(1)).toBe(true);
    expect(w.dead).toBe(true);
  });

  it('空中では重力で落ちる', () => {
    const w = new Walker(0, 0, 1);
    w.update(1 / 60, noTiles);
    expect(w.body.vy).toBeGreaterThan(0);
  });
});
