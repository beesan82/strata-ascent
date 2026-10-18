import { CHUNK_SIZE, TILE, type Tile } from './tiles';

/**
 * 破壊差分ストア。破壊されたワールドタイル座標を保持する唯一の可変レイヤー。
 * チャンクごとに CHUNK_SIZE² のマスク(1=破壊済み)を持つ。タイル単位の文字列キーを避け、
 * 照会を配列参照1回に、チャンク再生成時の適用を破壊のあるチャンクだけに限定する。
 */
export class Destruction {
  private masks = new Map<string, Uint8Array>();
  private count = 0;

  get size(): number {
    return this.count;
  }

  isDestroyed(x: number, y: number): boolean {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cy = Math.floor(y / CHUNK_SIZE);
    const mask = this.masks.get(`${cx},${cy}`);
    if (!mask) return false;
    return mask[(y - cy * CHUNK_SIZE) * CHUNK_SIZE + (x - cx * CHUNK_SIZE)] === 1;
  }

  /** チャンク(cx,cy)の破壊マスク(CHUNK_SIZE², 1=破壊済み)。破壊がなければ undefined。読み取り専用として扱う */
  maskOf(cx: number, cy: number): Uint8Array | undefined {
    return this.masks.get(`${cx},${cy}`);
  }

  /** チャンク(cx,cy)の生成直後のタイル配列へ破壊を反映する(in-place)。破壊がなければ何もしない */
  applyTo(chunk: Uint8Array, cx: number, cy: number): void {
    const mask = this.masks.get(`${cx},${cy}`);
    if (!mask) return;
    for (let i = 0; i < mask.length; i++) if (mask[i] === 1) chunk[i] = TILE.AIR;
  }

  /**
   * (x0,y0) から angle 方向へ length タイル、太さ radius(半径)のビームで
   * 経路上の非AIRタイルを破壊集合へ追加する。tiles は現在のタイル取得関数。
   * tiles が undefined を返す位置(未生成チャンク)は判定せずに記録する。生成時に applyTo で
   * 反映され、元がAIRでもAIRのままなので見た目は変わらない。発射時の同期生成を避けるため。
   * 影響を受けたチャンク座標("cx,cy")の集合を返す(キャッシュ無効化用)。
   */
  bore(
    x0: number, y0: number, angle: number, length: number, radius: number,
    tiles: (x: number, y: number) => Tile | undefined,
  ): Set<string> {
    const chunks = new Set<string>();
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // ビームに垂直な方向(太さ方向)
    const px = -dy;
    const py = dx;
    // 同一チャンク内の連続サンプルでMap参照を繰り返さないよう直前のマスクを覚える
    let lastKey = '';
    let lastCx = NaN;
    let lastCy = NaN;
    let mask: Uint8Array | undefined;
    for (let t = 0; t <= length; t += 0.5) {
      const cxx = x0 + dx * t;
      const cyy = y0 + dy * t;
      for (let r = -radius; r <= radius; r += 0.5) {
        const wx = Math.round(cxx + px * r);
        const wy = Math.round(cyy + py * r);
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        if (cx !== lastCx || cy !== lastCy) {
          lastCx = cx;
          lastCy = cy;
          lastKey = `${cx},${cy}`;
          mask = this.masks.get(lastKey);
        }
        const i = (wy - cy * CHUNK_SIZE) * CHUNK_SIZE + (wx - cx * CHUNK_SIZE);
        if (mask && mask[i] === 1) continue;
        const t = tiles(wx, wy);
        if (t === TILE.AIR) continue;
        // 破壊不能(界面の板)は掘れない
        if (t === TILE.HARD) continue;
        if (!mask) {
          mask = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
          this.masks.set(lastKey, mask);
        }
        mask[i] = 1;
        this.count++;
        chunks.add(lastKey);
      }
    }
    return chunks;
  }
}
