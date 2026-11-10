import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { bodyOverlapsSolid, tryDisplace, type Body, type TileLookup } from './physics';
import { carryRider, isRiding, LAND_TOL, landOnPlatform, RIDE_EPS, type Platform } from './platform';
import { Player, type PlayerInput } from './player';

/** 指定した (x, y) だけが SOLID の世界 */
function world(solids: readonly (readonly [number, number])[]): TileLookup {
  const set = new Set(solids.map(([x, y]) => `${x},${y}`));
  return (x: number, y: number): Tile => (set.has(`${x},${y}`) ? TILE.SOLID : TILE.AIR);
}

const OPEN: TileLookup = () => TILE.AIR;

function body(x: number, y: number): Body {
  return { x, y, w: 0.75, h: 1.75, vx: 0, vy: 0, onGround: true };
}

const IDLE: PlayerInput = { left: false, right: false, jump: false, up: false, down: false };
const DT = 1 / 60;

/**
 * main の 1 ステップと同じ順序: 足場を動かす(乗り手は先に運ぶ。stallWhenUp なら上昇の挟まりで止める)→
 * Player.update → 着地の解決 → 乗り手の判定。足場が動いたかを返す
 */
function step(
  player: Player, p: Platform, dx: number, dy: number, tiles: TileLookup, riding: boolean, input = IDLE,
): { moved: boolean; riding: boolean } {
  let moved = true;
  if (riding && (dx !== 0 || dy !== 0)) {
    if (carryRider(player.body, dx, dy, tiles, dy < 0) === 'stalled') moved = false;
  }
  if (moved) {
    p.x += dx;
    p.y += dy;
  }
  const prevBottom = player.body.y + player.body.h;
  player.update(input, DT, tiles);
  landOnPlatform(player.body, prevBottom, p, tiles);
  return { moved, riding: isRiding(player.body, p) };
}

describe('tryDisplace(運ぶ物理の衝突つき変位)', () => {
  it('開けた空間では変位をそのまま適用し、body は書き換えない', () => {
    const b = body(1, 2);
    const r = tryDisplace(b, 0.3, -0.2, OPEN);
    expect(r).toEqual({ x: 1.3, y: 1.8, blocked: false });
    expect(b.x).toBe(1);
    expect(b.y).toBe(2);
  });

  it('上の天井に阻まれると当たる手前で止まり blocked', () => {
    // 行 0 が天井。体の上端 1.5 から 1 上げると天井(下面 y=1)にめり込むので y=1 で止まる
    const tiles = world([[0, 0], [1, 0], [2, 0]]);
    const r = tryDisplace(body(1, 1.5), 0, -1, tiles);
    expect(r.blocked).toBe(true);
    expect(r.y).toBeCloseTo(1, 9);
    expect(bodyOverlapsSolid(tiles, 1, r.y, 0.75, 1.75)).toBe(false);
  });

  it('横の壁に阻まれると壁の手前で止まり、意図した変位を超えない', () => {
    const tiles = world([[3, 0], [3, 1], [3, 2], [3, 3]]);
    const r = tryDisplace(body(1.5, 1), 2, 0, tiles);
    expect(r.blocked).toBe(true);
    expect(r.x + 0.75).toBeLessThanOrEqual(3 + 1e-9);
    expect(r.x).toBeGreaterThan(2.1);
    const small = tryDisplace(body(1.5, 1), 0.1, 0, tiles);
    expect(small).toEqual({ x: 1.6, y: 1, blocked: false });
  });

  it('開始位置が固体と重なっているときは動かさない(埋まりを広げない)', () => {
    const tiles = world([[1, 1]]);
    const r = tryDisplace(body(1, 1), 0.5, 0.5, tiles);
    expect(r).toEqual({ x: 1, y: 1, blocked: true });
  });
});

describe('carryRider / landOnPlatform / isRiding', () => {
  it('全部運べたら carried、横で阻まれたら阻まれる手前まで動いて left、上昇の挟まりで stalled なら動かない', () => {
    const b1 = body(0, 0);
    expect(carryRider(b1, 0.5, 0, OPEN, false)).toBe('carried');
    expect(b1.x).toBe(0.5);

    const wall = world([[2, 0], [2, 1]]);
    const b2 = body(0.5, 0.1);
    expect(carryRider(b2, 2, 0, wall, false)).toBe('left');
    expect(b2.x + b2.w).toBeLessThanOrEqual(2 + 1e-9);

    const ceiling = world([[0, 0], [1, 0]]);
    const b3 = body(0.5, 1.05);
    expect(carryRider(b3, 0, -0.1, ceiling, true)).toBe('stalled');
    expect(b3.y).toBe(1.05);
  });

  it('落ちてきて上面を越えた体を上面へ置き、接地させる', () => {
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    const b = body(1, 10 - 1.75 - 0.05);
    b.onGround = false;
    b.vy = 6;
    const prevBottom = b.y + b.h;
    b.y += 0.1; // 更新で上面を越えた
    expect(landOnPlatform(b, prevBottom, p, OPEN)).toBe(true);
    expect(b.y + b.h).toBe(10);
    expect(b.vy).toBe(0);
    expect(b.onGround).toBe(true);
    expect(isRiding(b, p)).toBe(true);
  });

  it('上昇中・下から来た体・横に外れた体は拾わない(一方通行の床)', () => {
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    const rising = body(1, 8.3);
    rising.vy = -5;
    expect(landOnPlatform(rising, 10.1, p, OPEN)).toBe(false);
    const below = body(1, 8.5);
    below.vy = 2;
    expect(landOnPlatform(below, 10 + LAND_TOL + 0.1, p, OPEN)).toBe(false);
    const aside = body(5, 8.3);
    aside.vy = 2;
    expect(landOnPlatform(aside, 10, p, OPEN)).toBe(false);
  });

  it('置いた位置が地形と重なるなら拾わない(足場で体を埋めない)', () => {
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    const tiles = world([[1, 8]]);
    const b = body(1, 9.0);
    b.vy = 2;
    expect(landOnPlatform(b, 10, p, tiles)).toBe(false);
  });

  it('乗っている判定は足元と上面の差が RIDE_EPS 以内で、接地していること', () => {
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    expect(isRiding(body(1, 10 - 1.75 - RIDE_EPS / 2), p)).toBe(true);
    expect(isRiding(body(1, 10 - 1.75 - RIDE_EPS * 2), p)).toBe(false);
    const air = body(1, 10 - 1.75);
    air.onGround = false;
    expect(isRiding(air, p)).toBe(false);
  });
});

describe('運ぶ物理(Player 結合)', () => {
  it('下降する足場に立ったプレイヤーは足場と一緒に下りて乗ったまま', () => {
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    const player = new Player(1, 10 - 1.75);
    player.body.onGround = true;
    let riding = isRiding(player.body, p);
    expect(riding).toBe(true);
    for (let i = 0; i < 120; i++) riding = step(player, p, 0, 5 * DT, OPEN, riding).riding;
    expect(riding).toBe(true);
    expect(p.y).toBeCloseTo(20, 6);
    expect(player.body.y + player.body.h).toBeCloseTo(p.y, 6);
  });

  it('上昇する足場は天井に頭が当たるステップで止まり、体は埋まらない', () => {
    // 行 3 が天井(下面 y=4)。体の上端が 4 に届くと足場の上面は 5.75 で止まる
    const ceiling: [number, number][] = [];
    for (let x = -2; x < 8; x++) ceiling.push([x, 3]);
    const tiles = world(ceiling);
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    const player = new Player(1, 10 - 1.75);
    player.body.onGround = true;
    let riding = true;
    let stalls = 0;
    for (let i = 0; i < 240; i++) {
      const r = step(player, p, 0, -5 * DT, tiles, riding);
      riding = r.riding;
      if (!r.moved) stalls++;
      expect(bodyOverlapsSolid(tiles, player.body.x, player.body.y, player.body.w, player.body.h)).toBe(false);
    }
    expect(stalls).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(5.75 - 0.1);
    expect(riding).toBe(true);
  });

  it('横に運ばれて壁に阻まれると置いていかれ、足場が抜けたら落ちる(壁にめり込まない)', () => {
    const wall: [number, number][] = [];
    for (let y = 0; y < 30; y++) wall.push([8, y]);
    const tiles = world(wall);
    const p: Platform = { id: 'p', x: 0, y: 10, w: 6 };
    const player = new Player(3, 10 - 1.75);
    player.body.onGround = true;
    let riding = true;
    for (let i = 0; i < 300; i++) {
      riding = step(player, p, 4 * DT, 0, tiles, riding).riding;
      expect(player.body.x + player.body.w).toBeLessThanOrEqual(8 + 1e-9);
    }
    // 足場は壁をすり抜けて先へ行き、プレイヤーは壁の手前に残って落ちている
    expect(p.x).toBeGreaterThan(8);
    expect(riding).toBe(false);
    expect(player.body.y + player.body.h).toBeGreaterThan(10.5);
  });

  it('乗ったまま歩いて縁から降りられ、跳べば離れる', () => {
    const p: Platform = { id: 'p', x: 0, y: 10, w: 4 };
    const player = new Player(1.5, 10 - 1.75);
    player.body.onGround = true;
    let riding = true;
    riding = step(player, p, 0, 0, OPEN, riding, { ...IDLE, jump: true }).riding;
    expect(riding).toBe(false);
    expect(player.body.vy).toBeLessThan(0);

    const walker = new Player(1.5, 10 - 1.75);
    walker.body.onGround = true;
    riding = true;
    for (let i = 0; i < 90; i++) riding = step(walker, p, 0, 0, OPEN, riding, { ...IDLE, right: true }).riding;
    expect(walker.body.x).toBeGreaterThan(p.x + p.w);
    expect(riding).toBe(false);
    expect(walker.body.y + walker.body.h).toBeGreaterThan(10.5);
  });
});
