import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { JUMP_VELOCITY, Player, type PlayerInput } from './player';

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

  it('梯子を登り切って自bandの床行を越えられる(足元判定で頂上バグを回避)', () => {
    // 床帯(band)の梯子は自bandの床行(ty=10)で終わる。梯子の穴はx=3列のみで、
    // 他の列は床行がSOLID。梯子はband内(ty=10..17)を貫通し、床行(ty=10)も
    // 穴(LADDER)として貫いている(worldgenの実装を模す)。
    const climbPastFloorTiles = (tx: number, ty: number): Tile => {
      if (tx === 3 && ty >= 10 && ty <= 17) return TILE.LADDER;
      if (ty === 10) return TILE.SOLID;
      return TILE.AIR;
    };
    const p = new Player(3.1, 15); // 梯子の下の方、体は梯子列(x=3)に収まる(隣列とはみ出さない)
    const upInput = { ...noInput, up: true };
    let minFeet = Infinity;
    for (let i = 0; i < 300; i++) {
      p.update(upInput, 1 / 60, climbPastFloorTiles); // 5秒登り続ける
      minFeet = Math.min(minFeet, p.body.y + p.body.h);
    }
    // 中心タイルのみの旧判定では、体の中心が床行(y=10)を越えた瞬間onLadderがfalseになり、
    // 足はまだ梯子列(穴)の中で上昇の途中なのに重力に切り替わってしまい、
    // 床の上(y<=10)まで登り切れず頂上で足踏みし続ける(実測: 中心のみ判定だとminFeetは
    // 10.58程度で頭打ちになり、決して10を下回らない)。
    // 足元判定を加えた新実装では、床の上まで登り切れる。
    expect(minFeet).toBeLessThanOrEqual(10);

    // 上入力を離し、右へ踏み出して穴の外(SOLIDな床)へ移動すると着地する
    const stepOff = { ...noInput, right: true };
    for (let i = 0; i < 120; i++) p.update(stepOff, 1 / 60, climbPastFloorTiles);
    expect(p.body.onGround).toBe(true);
  });

  it('梯子上でジャンプ入力するとJUMP_VELOCITYで離脱できる', () => {
    const p = new Player(2.8, 12); // 梯子列(x=3)の途中
    p.update({ ...noInput, jump: true }, 1 / 60, ladderTiles);
    expect(p.body.vy).toBe(JUMP_VELOCITY);
  });
});

describe('Player 向きと歩行位相', () => {
  it('左右入力で向きが変わり、入力がなければ維持される', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    p.update({ ...noInput, left: true }, 1 / 60, floorTiles);
    expect(p.facing).toBe(-1);
    p.update(noInput, 1 / 60, floorTiles);
    expect(p.facing).toBe(-1);
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.facing).toBe(1);
  });

  it('接地して歩いている間だけwalkPhaseが進む', () => {
    const p = new Player(0, 8);
    for (let i = 0; i < 120; i++) p.update(noInput, 1 / 60, floorTiles);
    const before = p.walkPhase;
    p.update(noInput, 1 / 60, floorTiles);
    expect(p.walkPhase).toBe(before); // 静止中は進まない
    p.update({ ...noInput, right: true }, 1 / 60, floorTiles);
    expect(p.walkPhase).toBeGreaterThan(before);
  });
});
