import { CHUNK_SIZE, TILE, type Tile } from './tiles';
import type { Destruction } from './destruction';
import { generateChunk } from './worldgen';

/** チャンクの遅延生成・キャッシュ・破棄。ワールドへの唯一のアクセス窓口 */
export class ChunkStore {
  private chunks = new Map<string, Uint8Array>();

  constructor(readonly seed: number, private destruction?: Destruction) {}

  get size(): number {
    return this.chunks.size;
  }

  getChunk(cx: number, cy: number): Uint8Array {
    const key = `${cx},${cy}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = generateChunk(this.seed, cx, cy);
      if (this.destruction) this.applyDestruction(chunk, cx, cy, this.destruction);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  private applyDestruction(chunk: Uint8Array, cx: number, cy: number, destruction: Destruction): void {
    if (destruction.size === 0) return;
    const base = cx * CHUNK_SIZE;
    const baseY = cy * CHUNK_SIZE;
    for (let ty = 0; ty < CHUNK_SIZE; ty++)
      for (let tx = 0; tx < CHUNK_SIZE; tx++)
        if (destruction.isDestroyed(base + tx, baseY + ty)) chunk[ty * CHUNK_SIZE + tx] = TILE.AIR;
  }

  /** キャッシュから該当チャンクを削除(次回getChunkで再生成→破壊適用) */
  invalidate(cx: number, cy: number): void {
    this.chunks.delete(`${cx},${cy}`);
  }

  /** ワールドタイル座標でタイルを引く(必要なチャンクは自動生成) */
  tileAt(x: number, y: number): Tile {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const tx = x - cx * CHUNK_SIZE;
    const ty = y - cy * CHUNK_SIZE;
    return this.getChunk(cx, cy)[ty * CHUNK_SIZE + tx] as Tile;
  }

  /** 指定チャンクからチェビシェフ距離radiusを超えるチャンクを破棄 */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    for (const key of this.chunks.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) {
        this.chunks.delete(key);
      }
    }
  }
}
