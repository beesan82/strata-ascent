import type { ChunkStore } from '../world/chunks';
import { stratumIndexAt } from '../world/strata';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { decorateChunk, type DecorOp } from './decor';

/** 焼き込み解像度(px/タイル)。表示は拡縮されるが16pxあれば線は読める */
export const BAKE_PPT = 16;

/** 階層ごとのSOLIDベース色(わずかな色味の違い) */
const SOLID_FILLS = ['#161b20', '#171c18', '#1d1a16', '#151721', '#1a151c'];

/** チャンク1枚を一度だけオフスクリーンCanvasへ焼き込み、以後はdrawImageで貼る */
export class ChunkBaker {
  private cache = new Map<string, HTMLCanvasElement>();
  private patterns = new Map<string, CanvasPattern>();

  constructor(private seed: number) {}

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
    const chunk = store.getChunk(cx, cy);

    // ベース: SOLIDタイルを階層色で塗る(+1pxで継ぎ目の光漏れ防止)
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      const fill = SOLID_FILLS[stratumIndexAt(cy * CHUNK_SIZE + ty) % SOLID_FILLS.length];
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        if (chunk[ty * CHUNK_SIZE + tx] !== TILE.SOLID) continue;
        ctx.fillStyle = fill;
        ctx.fillRect(tx * BAKE_PPT, ty * BAKE_PPT, BAKE_PPT + 1, BAKE_PPT + 1);
      }
    }

    // 装飾
    ctx.lineCap = 'round';
    for (const op of decorateChunk(this.seed, cx, cy)) this.draw(ctx, op);
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
        ctx.fillStyle = this.hatchPattern(op.spacing, op.color);
        ctx.fillRect(op.x * P, op.y * P, op.w * P, op.h * P);
        ctx.restore();
        break;
      }
    }
  }

  private hatchPattern(spacing: number, color: string): CanvasPattern {
    const key = `${spacing}|${color}`;
    let pat = this.patterns.get(key);
    if (!pat) {
      const s = Math.max(3, Math.round(spacing * BAKE_PPT));
      const c = document.createElement('canvas');
      c.width = s;
      c.height = s;
      const pctx = c.getContext('2d')!;
      pctx.strokeStyle = color;
      pctx.lineWidth = 1;
      pctx.beginPath();
      // 45°線(タイル境界で連続するようセル内で完結する複数本)
      pctx.moveTo(0, s);
      pctx.lineTo(s, 0);
      pctx.moveTo(-s / 2, s / 2);
      pctx.lineTo(s / 2, -s / 2);
      pctx.moveTo(s / 2, s * 1.5);
      pctx.lineTo(s * 1.5, s / 2);
      pctx.stroke();
      pat = pctx.createPattern(c, 'repeat')! as CanvasPattern;
      this.patterns.set(key, pat);
    }
    return pat;
  }
}
