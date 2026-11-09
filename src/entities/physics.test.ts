import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { findLedge, LEDGE_HANG_DEPTH, moveBody, type Body } from './physics';

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

  it('SOLIDに部分的に埋まった状態で開始しても停止して終了する(埋まりガード)', () => {
    // ty=5の一枚床に体の上端が食い込んだ状態。旧実装ではステップ探索が
    // 無限ループになるケース。テストが完走すること自体が停止性の証明。
    const b = makeBody(2, 5.5);
    b.vx = 7;
    b.vy = 10;
    moveBody(b, 1, testTiles);
    expect(b.x).toBe(2); // 位置は変化しない
    expect(b.y).toBe(5.5);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });

  it('完全にSOLID内部で開始しても停止して終了する(埋まりガード)', () => {
    const allSolid = (): Tile => TILE.SOLID;
    const b = makeBody(3, 3);
    b.vx = 5;
    b.vy = 5;
    moveBody(b, 1, allSolid);
    expect(b.x).toBe(3);
    expect(b.y).toBe(3);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
  });

  it('左に歩くと壁の右面で止まる', () => {
    const b = makeBody(13, 0); // 左端 = 13、壁(x=10)の右面 = 11
    b.vx = -10;
    moveBody(b, 1, testTiles);
    expect(b.x).toBeGreaterThanOrEqual(11 - 1e-6);
    expect(b.x).toBeLessThan(11.2);
    expect(b.vx).toBe(0);
  });

  it('上にジャンプすると天井の下面で止まり、onGroundにならない', () => {
    const b = makeBody(2, 8); // 上端 = 8、天井(ty=5)の下面 = 6
    b.vy = -10;
    moveBody(b, 1, testTiles);
    expect(b.y).toBeGreaterThanOrEqual(6 - 1e-6);
    expect(b.y).toBeLessThan(6.2);
    expect(b.vy).toBe(0);
    expect(b.onGround).toBe(false);
  });
});

describe('findLedge(崖つかみの成立判定)', () => {
  /** x>=5 かつ y>=10 が固体の塊。縁は (5, 10) */
  const blockRight = (tx: number, ty: number): Tile =>
    tx >= 5 && ty >= 10 ? TILE.SOLID : TILE.AIR;
  /** x<=4 かつ y>=10 が固体の塊。縁は (4, 10) */
  const blockLeft = (tx: number, ty: number): Tile =>
    tx <= 4 && ty >= 10 ? TILE.SOLID : TILE.AIR;

  it('右側の縁を掴める: 縁タイルとスナップ位置を返す', () => {
    const b = makeBody(4.25, 9.5); // 右端 = 5.0 で壁面に接する。上端 9.5、手の範囲は 9.5〜10.2
    const l = findLedge(b, blockRight, 1);
    expect(l).not.toBeNull();
    expect(l!.tx).toBe(5);
    expect(l!.ty).toBe(10);
    expect(l!.side).toBe(1);
    expect(l!.x).toBeCloseTo(5 - 0.75); // 側面が縁の側面に接する
    expect(l!.y).toBeCloseTo(10 + LEDGE_HANG_DEPTH); // 上端は縁の上面より少し下
  });

  it('左側の縁も掴める', () => {
    const b = makeBody(5, 9.5); // 左端 = 5.0 で壁(x<=4)の右面に接する
    const l = findLedge(b, blockLeft, -1);
    expect(l).not.toBeNull();
    expect(l!.tx).toBe(4);
    expect(l!.ty).toBe(10);
    expect(l!.side).toBe(-1);
    expect(l!.x).toBeCloseTo(5);
  });

  it('壁面から離れていれば掴めない(1/16 の衝突隙間は許す)', () => {
    expect(findLedge(makeBody(4.25 - 1 / 16, 9.5), blockRight, 1)).not.toBeNull();
    expect(findLedge(makeBody(3.5, 9.5), blockRight, 1)).toBeNull();
  });

  it('縁の上が塞がっていれば掴めない', () => {
    const wall = (tx: number, ty: number): Tile => (tx >= 5 && ty >= 9 ? TILE.SOLID : TILE.AIR);
    expect(findLedge(makeBody(4.25, 9.5), wall, 1)).toBeNull();
  });

  it('手の範囲(体上端〜+0.7)の外なら掴めない', () => {
    expect(findLedge(makeBody(4.25, 8.5), blockRight, 1)).toBeNull(); // 範囲 8.5〜9.2: 縁(10)はまだ下
    expect(findLedge(makeBody(4.25, 9.35), blockRight, 1)).not.toBeNull(); // 範囲 9.35〜10.05: 下端近くで成立
    expect(findLedge(makeBody(4.25, 10), blockRight, 1)).not.toBeNull(); // 上端が縁の上面と同じ高さ
    expect(findLedge(makeBody(4.25, 10.5), blockRight, 1)).toBeNull(); // 上端が縁より下: 行 11 の上は固体
  });

  it('固体でないタイル(梯子)は縁にならない', () => {
    const ladder = (tx: number, ty: number): Tile => (tx >= 5 && ty >= 10 ? TILE.LADDER : TILE.AIR);
    expect(findLedge(makeBody(4.25, 9.5), ladder, 1)).toBeNull();
  });

  it('HARD も縁になる', () => {
    const hard = (tx: number, ty: number): Tile => (tx >= 5 && ty >= 10 ? TILE.HARD : TILE.AIR);
    expect(findLedge(makeBody(4.25, 9.5), hard, 1)?.ty).toBe(10);
  });

  it('スナップ位置が固体と重なるなら掴めない', () => {
    const withFloor = (tx: number, ty: number): Tile =>
      blockRight(tx, ty) === TILE.SOLID || (tx === 4 && ty === 11) ? TILE.SOLID : TILE.AIR;
    expect(findLedge(makeBody(4.25, 9.5), withFloor, 1)).toBeNull();
  });

  it('反対側を指定すれば掴めない', () => {
    expect(findLedge(makeBody(4.25, 9.5), blockRight, -1)).toBeNull();
  });
});

it('HARD は SOLID と同じく衝突する(床として立てる)', () => {
  const tiles = (_x: number, y: number) => (y === 5 ? TILE.HARD : TILE.AIR);
  const body = { x: 0.1, y: 3, w: 0.75, h: 1.75, vx: 0, vy: 10, onGround: false };
  moveBody(body, 1 / 60, tiles);
  for (let i = 0; i < 60; i++) { body.vy += 30 / 60; moveBody(body, 1 / 60, tiles); }
  expect(body.onGround).toBe(true);
  // 衝突解決は 1/16 タイル刻みの探索なので、床面の手前 1/16 以内で止まる
  expect(body.y + body.h).toBeLessThanOrEqual(5);
  expect(body.y + body.h).toBeGreaterThan(5 - 1 / 16 - 1e-6);
});
