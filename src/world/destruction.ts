import { CHUNK_SIZE, TILE, type Tile } from './tiles';

/** 破壊差分ストア。破壊されたワールドタイル座標を保持する唯一の可変レイヤー */
export class Destruction {
  private cells = new Set<string>();

  get size(): number {
    return this.cells.size;
  }

  isDestroyed(x: number, y: number): boolean {
    return this.cells.has(`${x},${y}`);
  }

  /**
   * (x0,y0) から angle 方向へ length タイル、太さ radius(半径)のビームで
   * 経路上の非AIRタイルを破壊集合へ追加する。tiles は現在のタイル取得関数。
   * 影響を受けたチャンク座標("cx,cy")の集合を返す(キャッシュ無効化用)。
   */
  bore(x0: number, y0: number, angle: number, length: number, radius: number, tiles: (x: number, y: number) => Tile): Set<string> {
    const chunks = new Set<string>();
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    // ビームに垂直な方向(太さ方向)
    const px = -dy;
    const py = dx;
    for (let t = 0; t <= length; t += 0.5) {
      const cxx = x0 + dx * t;
      const cyy = y0 + dy * t;
      for (let r = -radius; r <= radius; r += 0.5) {
        const wx = Math.round(cxx + px * r);
        const wy = Math.round(cyy + py * r);
        if (tiles(wx, wy) === TILE.AIR) continue;
        const key = `${wx},${wy}`;
        if (this.cells.has(key)) continue;
        this.cells.add(key);
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cy = Math.floor(wy / CHUNK_SIZE);
        chunks.add(`${cx},${cy}`);
      }
    }
    return chunks;
  }
}
