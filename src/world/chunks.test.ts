import { describe, expect, it } from 'vitest';
import { ChunkStore } from './chunks';
import { Destruction } from './destruction';
import { CHUNK_SIZE, TILE } from './tiles';
import { tileAt } from './worldgen';

/** seed 固定で最初に見つかる SOLID セルのワールド座標を返す(見つからなければ throw) */
function findSolid(seed: number): { x: number; y: number } {
  for (let y = -50; y < 0; y++)
    for (let x = 0; x < 200; x++)
      if (tileAt(seed, x, y) === TILE.SOLID) return { x, y };
  throw new Error('SOLID セルが見つからない');
}

describe('ChunkStore', () => {
  it('同じチャンクを二度取得するとキャッシュされた同一インスタンスを返す', () => {
    const store = new ChunkStore(42);
    const a = store.getChunk(0, 0);
    const b = store.getChunk(0, 0);
    expect(a).toBe(b);
    expect(store.size).toBe(1);
  });

  it('tileAtはworldgenの結果と一致する(負座標も含む)', () => {
    const store = new ChunkStore(42);
    for (const [x, y] of [[0, 0], [63, 63], [64, 64], [-1, -1], [-65, 130]] as const) {
      expect(store.tileAt(x, y)).toBe(tileAt(42, x, y));
    }
  });

  it('evictFarFromは遠いチャンクだけ破棄する', () => {
    const store = new ChunkStore(42);
    store.getChunk(0, 0);
    store.getChunk(1, 0);
    store.getChunk(10, 10);
    store.evictFarFrom(0, 0, 2);
    expect(store.size).toBe(2);
    // 近いチャンクは残っている(再生成されない=同一インスタンス)
    const kept = store.getChunk(1, 0);
    expect(store.size).toBe(2);
    expect(kept).toBe(store.getChunk(1, 0));
  });
});

describe('ChunkStore(Destruction 注入)', () => {
  it('破壊されたSOLIDセルは store.tileAt で AIR を返す', () => {
    const d = new Destruction();
    const { x, y } = findSolid(42);
    d.bore(x, y, 0, 0, 0, (ax, ay) => tileAt(42, ax, ay));
    const store = new ChunkStore(42, d);
    expect(store.tileAt(x, y)).toBe(TILE.AIR);
  });

  it('取得後に破壊 → invalidate → 再取得で AIR になる(無効化が効く)', () => {
    const d = new Destruction();
    const store = new ChunkStore(42, d);
    const { x, y } = findSolid(42);
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    // 先に取得(破壊前なので SOLID がキャッシュされる)
    expect(store.tileAt(x, y)).toBe(TILE.SOLID);
    // 破壊してもキャッシュ済みなので、無効化前は依然 SOLID
    d.bore(x, y, 0, 0, 0, (ax, ay) => tileAt(42, ax, ay));
    expect(store.tileAt(x, y)).toBe(TILE.SOLID);
    // 無効化 → 再生成 → 破壊適用で AIR
    store.invalidate(cx, cy);
    expect(store.tileAt(x, y)).toBe(TILE.AIR);
  });

  it('evictFarFrom で退避しても再取得で破壊が保持される(Destruction はキャッシュと独立)', () => {
    const d = new Destruction();
    const { x, y } = findSolid(42);
    d.bore(x, y, 0, 0, 0, (ax, ay) => tileAt(42, ax, ay));
    const store = new ChunkStore(42, d);
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    expect(store.tileAt(x, y)).toBe(TILE.AIR);
    // 該当チャンクを退避(遠方基準で必ず範囲外にする)
    store.evictFarFrom(cx + 100, cy + 100, 1);
    expect(store.size).toBe(0);
    // 再取得しても破壊は Destruction 側に残るため AIR
    expect(store.tileAt(x, y)).toBe(TILE.AIR);
  });
});
