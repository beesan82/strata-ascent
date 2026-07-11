import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { blobId } from './tileset/autotile';
import type { Atlas } from './tileset/atlas';
import { decorateChunk, PALETTE, type DecorOp } from './decor';

/** 焼き込み解像度(px/タイル)。表示は拡縮されるが16pxあれば線は読める */
export const BAKE_PPT = 16;

/**
 * アトラスが辺/角/継ぎ目/リベットを描くようになったため、装飾側の
 * 「表面線画」色はスキップする(二重描画防止)。物理的装飾は残す。
 */
const SKIP_COLORS = new Set<string>([PALETTE.edgeTop, PALETTE.edgeSide, PALETTE.seam, PALETTE.rivet]);

/** チャンク1枚を一度だけオフスクリーンCanvasへ焼き込み、以後はdrawImageで貼る */
export class ChunkBaker {
  private cache = new Map<string, HTMLCanvasElement>();
  private patterns = new Map<string, CanvasPattern>();

  constructor(private seed: number, private atlas: Atlas) {}

  get size(): number {
    return this.cache.size;
  }

  get(cx: number, cy: number, store: ChunkStore): HTMLCanvasElement {
    const key = `${cx},${cy}`;
    let canvas = this.cache.get(key);
    if (!canvas) {
      canvas = this.bake(cx, cy, store);
      this.cache.set(key, canvas);
    }
    return canvas;
  }

  /** ChunkStoreのevictFarFromと同じ規則でキャッシュを破棄する(main側で対で呼ぶ) */
  evictFarFrom(cx: number, cy: number, radius: number): void {
    for (const key of this.cache.keys()) {
      const [kx, ky] = key.split(',').map(Number);
      if (Math.max(Math.abs(kx - cx), Math.abs(ky - cy)) > radius) {
        this.cache.delete(key);
      }
    }
  }

  private bake(cx: number, cy: number, store: ChunkStore): HTMLCanvasElement {
    const px = CHUNK_SIZE * BAKE_PPT;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d')!;
    // タイルは滑らかに陰影付けされているが、境界で隣接アトラスセルを拾わないよう
    // スムージングを無効化してエッジをこの解像度で明瞭に保つ。
    ctx.imageSmoothingEnabled = false;
    const chunk = store.getChunk(cx, cy);
    const bx = cx * CHUNK_SIZE;
    const by = cy * CHUNK_SIZE;

    // ベース: SOLIDタイルを8近傍から求めたブロブIDでオートタイル描画する。
    // 近傍参照はstore.tileAt(純粋)経由でチャンクをまたいでも継ぎ目なく一致する。
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      const wy = by + ty;
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        const wx = bx + tx;
        const nb = {
          n: store.tileAt(wx, wy - 1) === TILE.SOLID,
          e: store.tileAt(wx + 1, wy) === TILE.SOLID,
          s: store.tileAt(wx, wy + 1) === TILE.SOLID,
          w: store.tileAt(wx - 1, wy) === TILE.SOLID,
          ne: store.tileAt(wx + 1, wy - 1) === TILE.SOLID,
          se: store.tileAt(wx + 1, wy + 1) === TILE.SOLID,
          sw: store.tileAt(wx - 1, wy + 1) === TILE.SOLID,
          nw: store.tileAt(wx - 1, wy - 1) === TILE.SOLID,
        };
        const r = this.atlas.rect(blobId(nb));
        ctx.drawImage(
          this.atlas.source,
          r.sx, r.sy, r.sw, r.sh,
          tx * BAKE_PPT, ty * BAKE_PPT, BAKE_PPT + 1, BAKE_PPT + 1,
        );
      }
    }

    // 装飾(アトラスが描く表面線画=hatch/edge/seam/rivetはスキップ、物理装飾は残す)
    ctx.lineCap = 'round';
    for (const op of decorateChunk(this.seed, cx, cy)) {
      if (op.kind === 'hatch') continue;
      if ((op.kind === 'line' || op.kind === 'dot') && SKIP_COLORS.has(op.color)) continue;
      this.draw(ctx, op);
    }
    return canvas;
  }

  private draw(ctx: CanvasRenderingContext2D, op: DecorOp): void {
    const P = BAKE_PPT;
    switch (op.kind) {
      case 'line':
        ctx.strokeStyle = op.color;
        ctx.lineWidth = Math.max(1, op.w * P);
        ctx.beginPath();
        ctx.moveTo(op.x1 * P, op.y1 * P);
        ctx.lineTo(op.x2 * P, op.y2 * P);
        ctx.stroke();
        break;
      case 'dot':
        ctx.fillStyle = op.color;
        ctx.beginPath();
        ctx.arc(op.x * P, op.y * P, Math.max(1, op.r * P), 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'poly': {
        ctx.beginPath();
        ctx.moveTo(op.pts[0] * P, op.pts[1] * P);
        for (let i = 2; i < op.pts.length; i += 2) ctx.lineTo(op.pts[i] * P, op.pts[i + 1] * P);
        if (op.fill) {
          ctx.closePath();
          ctx.fillStyle = op.color;
          ctx.fill();
        } else {
          ctx.strokeStyle = op.color;
          ctx.lineWidth = Math.max(1, op.w * P);
          ctx.stroke();
        }
        break;
      }
      case 'hatch': {
        ctx.save();
        ctx.beginPath();
        ctx.rect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.clip();
        ctx.fillStyle = this.hatchPattern(op.spacing, op.color, !!op.cross);
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.restore();
        break;
      }
    }
  }

  private hatchPattern(spacing: number, color: string, cross: boolean): CanvasPattern {
    const key = `${spacing}|${color}|${cross ? 'x' : '/'}`;
    let pat = this.patterns.get(key);
    if (!pat) {
      const s = Math.max(3, Math.round(spacing * BAKE_PPT));
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const pctx = c.getContext('2d')!;
      pctx.lineWidth = 1;
      // 主方向の45°線(タイル境界で連続するようセル内で完結する複数本)
      pctx.strokeStyle = color;
      pctx.beginPath();
      pctx.moveTo(0, s);
      pctx.lineTo(s, 0);
      pctx.moveTo(-s / 2, s / 2);
      pctx.lineTo(s / 2, -s / 2);
      pctx.moveTo(s / 2, s * 1.5);
      pctx.lineTo(s * 1.5, s / 2);
      pctx.stroke();
      if (cross) {
        // 逆向き45°線を淡く重ねてクロスハッチ(格子ではなく織り目状の陰影で密度アップ)
        pctx.globalAlpha = 0.5;
        pctx.beginPath();
        pctx.moveTo(0, 0);
        pctx.lineTo(s, s);
        pctx.moveTo(s / 2, -s / 2);
        pctx.lineTo(s * 1.5, s / 2);
        pctx.moveTo(-s / 2, s / 2);
        pctx.lineTo(s / 2, s * 1.5);
        pctx.stroke();
        pctx.globalAlpha = 1;
      }
      pat = pctx.createPattern(c, 'repeat')! as CanvasPattern;
      this.patterns.set(key, pat);
    }
    return pat;
  }
}
