import { CHUNK_SIZE, type Tile } from './tiles';
import type { Destruction } from './destruction';
import { generateChunk } from './worldgen';

/** チャンクの遅延生成・キャッシュ・破棄。ワールドへの唯一のアクセス窓口 */
export class ChunkStore {
  private chunks = new Map<string, Uint8Array>();
  /** 生成直後(破壊反映前)の元地形。装飾など元地形を見る処理が worldgen を引き直さずに済むように */
  private pristine = new Map<string, Uint8Array>();

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
      this.pristine.set(key, chunk.slice());
      this.destruction?.applyTo(chunk, cx, cy);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  /** キャッシュから該当チャンクを削除(次回getChunkで再生成→破壊適用) */
  invalidate(cx: number, cy: number): void {
    this.chunks.delete(`${cx},${cy}`);
    this.pristine.delete(`${cx},${cy}`);
  }

  /** 生成済みチャンクのキャッシュへ破壊を反映する(再生成しない)。未生成なら何もしない(生成時に反映される) */
  applyDestruction(cx: number, cy: number): void {
    const chunk = this.chunks.get(`${cx},${cy}`);
    if (chunk) this.destruction?.applyTo(chunk, cx, cy);
  }

  /** チャンクの破壊マスク(部分再焼き込みの範囲決定用)。破壊がなければ undefined */
  destroyedMask(cx: number, cy: number): Uint8Array | undefined {
    return this.destruction?.maskOf(cx, cy);
  }

  /** 生成済みチャンクならタイルを返し、未生成なら生成せず undefined を返す */
  peekTileAt(x: number, y: number): Tile | undefined {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const chunk = this.chunks.get(`${cx},${cy}`);
    if (!chunk) return undefined;
    return chunk[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)] as Tile;
  }

  /**
   * チャンク(cx,cy)と周囲 pad タイル(pad <= CHUNK_SIZE)を (CHUNK_SIZE+2pad)² の配列に並べる
   * (必要なチャンクは自動生成)。値は tileAt と同じ。焼き込みのように近傍を大量に引く処理で、
   * タイルごとの Map 参照を3×3チャンク分の参照9回に減らすため。
   */
  tilesAround(cx: number, cy: number, pad: number): Uint8Array {
    return this.gather(cx, cy, pad, (x, y) => this.getChunk(x, y));
  }

  /** tilesAround の元地形版(破壊を反映しない。値は worldgen の tileAt と同じ) */
  pristineAround(cx: number, cy: number, pad: number): Uint8Array {
    return this.gather(cx, cy, pad, (x, y) => {
      this.getChunk(x, y);
      return this.pristine.get(`${x},${y}`)!;
    });
  }

  private gather(cx: number, cy: number, pad: number, chunkAt: (cx: number, cy: number) => Uint8Array): Uint8Array {
    const n = CHUNK_SIZE + pad * 2;
    const out = new Uint8Array(n * n);
    for (let ny = -1; ny <= 1; ny++) {
      for (let nx = -1; nx <= 1; nx++) {
        // このチャンクのうち出力範囲に入る部分(チャンクローカル座標)
        const x0 = nx < 0 ? CHUNK_SIZE - pad : 0;
        const x1 = nx > 0 ? pad : CHUNK_SIZE;
        const y0 = ny < 0 ? CHUNK_SIZE - pad : 0;
        const y1 = ny > 0 ? pad : CHUNK_SIZE;
        if (x0 >= x1 || y0 >= y1) continue;
        const chunk = chunkAt(cx + nx, cy + ny);
        for (let y = y0; y < y1; y++) {
          const oy = y + ny * CHUNK_SIZE + pad;
          const ox = x0 + nx * CHUNK_SIZE + pad;
          out.set(chunk.subarray(y * CHUNK_SIZE + x0, y * CHUNK_SIZE + x1), oy * n + ox);
        }
      }
    }
    return out;
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
        this.pristine.delete(key);
      }
    }
  }
}
