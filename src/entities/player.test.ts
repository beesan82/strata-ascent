import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { Player, type PlayerInput } from './player';

const noInput: PlayerInput = { left: false, right: false, jump: false, up: false, down: false };
const emptyTiles = (): Tile => TILE.AIR;
/** y=10行が床 */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);
/** x=3列が梯子、y=10行が床 */
const ladderTiles = (tx: number, ty: number): Tile => {
  if (ty === 10) return TILE.SOLID;
  if (tx === 3) return TILE.LADDER;
  return TILE.AIR;
};

describe('Player', () => {
  it('空中では重力で落ちる', () => {
    const p = new Player(0, 0);
    p.update(noInput, 1 / 60, emptyTiles);
    expect(p.body.vy).toBeGreaterThan(0);
    expect(p.body.y).toBeGreaterThan(0);
  });

  it('左右入力で移動する', () => {
    const p = new Player(5, 0);
    p.update({ ...noInput, right: true }, 1 / 60, emptyTiles);
    expect(p.body.x).toBeGreaterThan(5);
  });

  it('接地中のみジャンプできる', () => {
    const p = new Player(0, 8);
    // 着地するまで落とす
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    expect(p.body.onGround).toBe(true);
    p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
    expect(p.body.vy).toBeLessThan(0); // 上向き

    // 空中で再ジャンプはできない(vyは重力に従うだけ)
    const vyAfterJump = p.body.vy;
    p.update({ ...noInput, jump: true }, 1 / 60, floorTiles);
    expect(p.body.vy).toBeGreaterThan(vyAfterJump);
  });

  it('梯子の上では重力を受けず、上入力で昇れる', () => {
    const p = new Player(2.8, 5); // 体の中心xが梯子列(x=3)に重なる
    const y0 = p.body.y;
    p.update({ ...noInput, up: true }, 1 / 60, ladderTiles);
    expect(p.body.y).toBeLessThan(y0);
  });
});
