import { describe, expect, it } from 'vitest';
import { ChunkStore } from './chunks';
import { tileAt } from './worldgen';

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
