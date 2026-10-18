import { CHUNK_SIZE, type Tile } from './tiles';
import type { Destruction } from './destruction';
import { generateChunk } from './worldgen';

/** チャンクの遅延生成・キャッシュ・破棄。ワールドへの唯一のアクセス窓口 */
export class ChunkStore {
  private chunks = new Map<string, Uint8Array>();

  constructor(readonly seed: number, private destruction?: Destruction) {}

  get size(): number {
    return this.chunks.size;
  }

  /** チャンクのタイルデータが生成済み(キャッシュ中)か */
  has(cx: number, cy: number): boolean {
    return this.chunks.has(`${cx},${cy}`);
  }

  getChunk(cx: number, cy: number): Uint8Array {
    const key = `${cx},${cy}`;
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = generateChunk(this.seed, cx, cy);
      this.destruction?.applyTo(chunk, cx, cy);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** キャッシュから該当チャンクを削除(次回getChunkで再生成→破壊適用) */
  invalidate(cx: number, cy: number): void {
    this.chunks.delete(`${cx},${cy}`);
  }

  /** 生成済みチャンクのキャッシュへ破壊を反映する(再生成しない)。未生成なら何もしない(生成時に反映される) */
  applyDestruction(cx: number, cy: number): void {
    const chunk = this.chunks.get(`${cx},${cy}`);
    if (chunk) this.destruction?.applyTo(chunk, cx, cy);
  }

  /** 生成済みチャンクならタイルを返し、未生成なら生成せず undefined を返す */
  peekTileAt(x: number, y: number): Tile | undefined {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const chunk = this.chunks.get(`${cx},${cy}`);
    if (!chunk) return undefined;
    return chunk[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)] as Tile;
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
