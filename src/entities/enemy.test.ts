import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { Walker, Flyer, nextFlyerMode } from './enemy';

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

describe('nextFlyerMode(飛行敵の状態遷移)', () => {
  it('感知半径 7 以内に入ると追尾へ移る', () => {
    expect(nextFlyerMode('patrol', 7)).toBe('chase');
    expect(nextFlyerMode('patrol', 3)).toBe('chase');
  });

  it('半径 10 を超えると巡回へ戻る', () => {
    expect(nextFlyerMode('chase', 10.5)).toBe('patrol');
  });

  it('7〜10 の帯では現在の状態を保つ(ヒステリシス)', () => {
    expect(nextFlyerMode('patrol', 8.5)).toBe('patrol');
    expect(nextFlyerMode('chase', 8.5)).toBe('chase');
    expect(nextFlyerMode('chase', 10)).toBe('chase');
    expect(nextFlyerMode('patrol', 7.5)).toBe('patrol');
  });
});

describe('Flyer(飛行ドローン)', () => {
  it('2 発で倒れる', () => {
    const f = new Flyer(10, 10, 0);
    expect(f.hit(1)).toBe(false);
    expect(f.hit(1)).toBe(true);
    expect(f.dead).toBe(true);
  });

  it('重力を受けず、巡回ではアンカーの ±6 タイル圏を往復する', () => {
    const f = new Flyer(30, 10, 0);
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < 60 * 20; i++) {
      f.update(1 / 60, noTiles, 1000, 1000); // プレイヤーは遠方(巡回のまま)
      minX = Math.min(minX, f.centerX);
      maxX = Math.max(maxX, f.centerX);
      // 重力で落下しない: アンカー高さ ±(うねり 0.8 + 余裕)に収まる
      expect(Math.abs(f.centerY - 10)).toBeLessThan(1.2);
    }
    expect(minX).toBeGreaterThan(30 - 6.6);
    expect(maxX).toBeLessThan(30 + 6.6);
    expect(maxX - minX).toBeGreaterThan(8); // 実際に往復している
  });

  it('プレイヤーが半径 7 以内に入ると追尾し、近づく', () => {
    const f = new Flyer(10, 10, 0);
    const before = Math.hypot(f.centerX - 14, f.centerY - 10);
    for (let i = 0; i < 60; i++) f.update(1 / 60, noTiles, 14, 10);
    expect(f.mode).toBe('chase');
    const after = Math.hypot(f.centerX - 14, f.centerY - 10);
    expect(after).toBeLessThan(before);
  });

  it('追尾速度はプレイヤーの歩行(6)より遅い', () => {
    const f = new Flyer(10, 10, 0);
    f.update(1 / 60, noTiles, 16, 10); // 距離 6 → 追尾
    const speed = Math.hypot(f.body.vx, f.body.vy);
    expect(speed).toBeGreaterThan(3);
    expect(speed).toBeLessThan(6);
  });

  it('プレイヤーが遠ざかると巡回へ戻る', () => {
    const f = new Flyer(10, 10, 0);
    for (let i = 0; i < 10; i++) f.update(1 / 60, noTiles, 14, 10);
    expect(f.mode).toBe('chase');
    f.update(1 / 60, noTiles, 100, 100);
    expect(f.mode).toBe('patrol');
  });

  it('追尾中に壁へ阻まれて 1 秒以上進めないと巡回へ戻る(固着防止)', () => {
    // x=13 列に壁。プレイヤーは壁の向こう側(14, 10)
    const wall = (tx: number): Tile => (tx === 13 ? TILE.SOLID : TILE.AIR);
    const f = new Flyer(10, 10, 0);
    let sawChase = false;
    let patrolRun = 0;
    let longestPatrolAfterChase = 0;
    for (let i = 0; i < 60 * 6; i++) {
      f.update(1 / 60, wall, 14, 10);
      if (f.mode === 'chase') {
        sawChase = true;
        patrolRun = 0;
      } else if (sawChase) {
        patrolRun++;
        longestPatrolAfterChase = Math.max(longestPatrolAfterChase, patrolRun);
      }
      expect(f.body.x + f.body.w).toBeLessThanOrEqual(13.01); // 壁をすり抜けていない
    }
    expect(sawChase).toBe(true);
    // 諦めて巡回へ戻り、少なくとも 0.5 秒は巡回に留まる(その場で固着し続けない)
    expect(longestPatrolAfterChase).toBeGreaterThanOrEqual(30);
  });
});
