import { describe, expect, it } from 'vitest';
import { Destruction } from './destruction';
import { TILE, type Tile } from './tiles';

/** y=5行が床、x=10列が壁、他はAIRのテストワールド */
const testTiles = (x: number, y: number): Tile => {
  if (y === 5) return TILE.SOLID;
  if (x === 10) return TILE.SOLID;
  return TILE.AIR;
};

describe('Destruction', () => {
  it('初期状態では何も破壊されていない', () => {
    const d = new Destruction();
    expect(d.isDestroyed(0, 0)).toBe(false);
    expect(d.size).toBe(0);
  });

  it('bore は経路上の非AIRタイルのみ破壊集合へ入れる(AIRは無視)', () => {
    const d = new Destruction();
    // 水平右向きに床(y=5)を横切るビーム。始点(0,5)から角度0で length 20, radius 1
    d.bore(0, 5, 0, 20, 1, testTiles);
    // 経路上の床タイル(y=5, x=0..20 かつ radius内)は破壊される
    expect(d.isDestroyed(3, 5)).toBe(true);
    expect(d.isDestroyed(10, 5)).toBe(true); // 壁と床の交点も
    // AIRだった箇所(y=6 は radius1 で y=5±1 に入るが元AIR)は破壊集合に入らない
    expect(d.isDestroyed(3, 8)).toBe(false); // 経路外
  });

  it('isDestroyed は破壊した座標で true、それ以外 false(決定論)', () => {
    const d = new Destruction();
    d.bore(0, 5, 0, 20, 0, testTiles); // radius0=中心線のみ
    expect(d.isDestroyed(7, 5)).toBe(true);
    expect(d.isDestroyed(7, 5)).toBe(true); // 再問い合わせ一致
    expect(d.isDestroyed(7, 4)).toBe(false);
  });

  it('bore は影響を受けたチャンク座標の集合を返す', () => {
    const d = new Destruction();
    const chunks = d.bore(0, 5, 0, 200, 1, testTiles); // 長いビーム→複数チャンク
    expect(chunks.size).toBeGreaterThan(0);
    // 破壊タイル (100,5) が属するチャンク (1,0) が含まれる (CHUNK_SIZE=64)
    expect(chunks.has('1,0')).toBe(true);
  });

  it('縦方向・斜め方向でも破壊が経路に沿う', () => {
    const d = new Destruction();
    d.bore(10, 0, Math.PI / 2, 10, 0, testTiles); // 下向きに壁(x=10)を貫く
    expect(d.isDestroyed(10, 3)).toBe(true);
    expect(d.isDestroyed(10, 5)).toBe(true);
  });
});
