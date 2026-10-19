import { describe, expect, it } from 'vitest';
import { Destruction } from './destruction';
import { CHUNK_SIZE, TILE, type Tile } from './tiles';

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

  it('bore はタイル不明(undefined=未生成チャンク)の位置を判定せず破壊集合へ入れる', () => {
    const d = new Destruction();
    // x>=64(チャンク1以降)は未生成扱い。生成せずに済ませ、生成時に applyTo で反映する
    const partial = (x: number, y: number): Tile | undefined => (x >= CHUNK_SIZE ? undefined : testTiles(x, y));
    const chunks = d.bore(0, 5, 0, 100, 1, partial);
    expect(d.isDestroyed(3, 5)).toBe(true);
    expect(d.isDestroyed(3, 6)).toBe(false); // 既知のAIRは従来どおり無視
    expect(d.isDestroyed(80, 6)).toBe(true); // 未生成側は元がAIRでも記録(反映してもAIRのまま)
    expect(chunks.has('1,0')).toBe(true);
    const chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(TILE.SOLID);
    d.applyTo(chunk, 1, 0);
    expect(chunk[6 * CHUNK_SIZE + (80 - CHUNK_SIZE)]).toBe(TILE.AIR);
    expect(chunk[9 * CHUNK_SIZE + (80 - CHUNK_SIZE)]).toBe(TILE.SOLID);
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

  it('applyTo はそのチャンク内の破壊タイルだけをAIRにする(負座標チャンクも)', () => {
    const d = new Destruction();
    // 左向きに床(y=5)を横切る → 負のチャンク(-1,0)にも破壊が入る
    d.bore(5, 5, Math.PI, 20, 0, testTiles);
    expect(d.isDestroyed(-3, 5)).toBe(true);
    const chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(TILE.SOLID);
    d.applyTo(chunk, -1, 0);
    // (-3,5) はチャンク(-1,0)のローカル(61,5)
    expect(chunk[5 * CHUNK_SIZE + 61]).toBe(TILE.AIR);
    expect(chunk[4 * CHUNK_SIZE + 61]).toBe(TILE.SOLID);
    // 破壊のないチャンクには触らない
    const untouched = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(TILE.SOLID);
    d.applyTo(untouched, 3, 3);
    expect(untouched.every((t) => t === TILE.SOLID)).toBe(true);
  });

  it('size は破壊タイル数(同じタイルを二度数えない)', () => {
    const d = new Destruction();
    d.bore(0, 5, 0, 20, 0, testTiles);
    const n = d.size;
    expect(n).toBeGreaterThan(0);
    d.bore(0, 5, 0, 20, 0, testTiles);
    expect(d.size).toBe(n);
  });

  it('縦方向・斜め方向でも破壊が経路に沿う', () => {
    const d = new Destruction();
    d.bore(10, 0, Math.PI / 2, 10, 0, testTiles); // 下向きに壁(x=10)を貫く
    expect(d.isDestroyed(10, 3)).toBe(true);
    expect(d.isDestroyed(10, 5)).toBe(true);
  });

  it('maskOf はチャンクの破壊マスク(1=破壊)を返し、破壊のないチャンクは undefined', () => {
    const d = new Destruction();
    d.bore(0, 5, 0, 20, 0, testTiles);
    const mask = d.maskOf(0, 0)!;
    expect(mask[5 * CHUNK_SIZE + 7]).toBe(1);
    expect(mask[4 * CHUNK_SIZE + 7]).toBe(0);
    expect(d.maskOf(3, 3)).toBeUndefined();
  });
});

it('bore は HARD を破壊しない(SOLID は破壊する)', () => {
  const d = new Destruction();
  const tiles = (x: number, y: number): Tile => (y === 5 ? (x < 10 ? TILE.SOLID : TILE.HARD) : TILE.AIR);
  d.bore(0, 5, 0, 20, 0, tiles);
  expect(d.isDestroyed(3, 5)).toBe(true);
  expect(d.isDestroyed(15, 5)).toBe(false);
});

it('bore は未生成(undefined)でも破壊不能と判定された位置を記録しない(隣の未生成位置は従来どおり記録)', () => {
  const d = new Destruction();
  const unknown = (): Tile | undefined => undefined;
  // x=10 の列だけ破壊不能(界面の板)とみなす
  const isIndestructible = (x: number) => x === 10;
  d.bore(0, 5, 0, 20, 0, unknown, isIndestructible);
  expect(d.isDestroyed(10, 5)).toBe(false);
  expect(d.isDestroyed(11, 5)).toBe(true);
  expect(d.isDestroyed(9, 5)).toBe(true);
});

it('applyTo はマスクが 1 でも HARD のタイルを消さない(多層防御)', () => {
  const d = new Destruction();
  d.bore(0, 5, 0, 20, 0, () => undefined);
  expect(d.isDestroyed(7, 5)).toBe(true);
  const chunk = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(TILE.SOLID);
  chunk[5 * CHUNK_SIZE + 7] = TILE.HARD;
  d.applyTo(chunk, 0, 0);
  expect(chunk[5 * CHUNK_SIZE + 7]).toBe(TILE.HARD);
  expect(chunk[5 * CHUNK_SIZE + 6]).toBe(TILE.AIR);
});
