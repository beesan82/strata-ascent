import type { ChunkStore } from '../world/chunks';
import { CHUNK_SIZE, TILE } from '../world/tiles';
import { blobId } from './tileset/autotile';
import type { Atlas } from './tileset/atlas';
import { generateAtlas } from './tileset/generate';
import { stratumIndexAt } from '../world/strata';
import { regionAt } from '../world/hierarchy';
import { conduitAt } from '../world/network';
import { BIOMES } from './biome';
import { decorateChunk, PALETTE, type DecorOp } from './decor';

/** 焼き込み解像度(px/タイル)。表示は拡縮されるが16pxあれば線は読める */
export const BAKE_PPT = 16;

/**
 * 物理装飾(surface以外)の元色となるPALETTE値の集合。
 * これらの色で描かれる装飾はチャンクのバイオームaccent色へ置換して塗り分ける。
 */
const ACCENT_SOURCE_COLORS: ReadonlySet<string> = new Set([
  PALETTE.rail, PALETTE.rung, PALETTE.hoop, PALETTE.pipe, PALETTE.pipeThin,
  PALETTE.bracket, PALETTE.cable, PALETTE.wire, PALETTE.grill,
  PALETTE.debris, PALETTE.debrisLine,
]);

/** チャンク1枚を一度だけオフスクリーンCanvasへ焼き込み、以後はdrawImageで貼る */
export class ChunkBaker {
  private cache = new Map<string, HTMLCanvasElement>();
  private patterns = new Map<string, CanvasPattern>();
  /** バイオームindex → タイルアトラス(生成は高価なのでキャッシュ) */
  private atlasByBiome = new Map<number, Atlas>();

  constructor(private seed: number) {}

  /** バイオームindexに対応する色付きアトラスを取得(なければ生成してキャッシュ) */
  private atlasFor(biomeIdx: number): Atlas {
    let atlas = this.atlasByBiome.get(biomeIdx);
    if (!atlas) {
      atlas = generateAtlas(BIOMES[biomeIdx].palette);
      this.atlasByBiome.set(biomeIdx, atlas);
    }
    return atlas;
  }

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

    // チャンク中心のワールドyでバイオームを決める。1チャンク=64タイルは
    // バイオーム帯(500タイル)に十分収まるため、境界をまたぐ1チャンクだけが
    // 全タイルで片側のバイオーム色になるが、ライティングで視覚的に馴染むため許容する。
    const centerY = cy * CHUNK_SIZE + CHUNK_SIZE / 2;
    const bIdx = stratumIndexAt(centerY) % BIOMES.length;
    const atlas = this.atlasFor(bIdx);
    const biome = BIOMES[bIdx];

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
        const r = atlas.rect(blobId(nb));
        ctx.drawImage(
          atlas.source,
          r.sx, r.sy, r.sw, r.sh,
          tx * BAKE_PPT, ty * BAKE_PPT, BAKE_PPT + 1, BAKE_PPT + 1,
        );
      }
    }

    // 装飾(アトラスが描く表面線画=surfaceタグ付きはスキップ、物理装飾は残す)。
    // 物理装飾のうちPALETTEのaccent系色で描かれるものはバイオームaccentへ置換し、
    // 配管・レール・瓦礫などの物理ディテールを階層ごとの色調に統一する。
    ctx.lineCap = 'round';
    for (const op of decorateChunk(this.seed, cx, cy)) {
      if (op.surface) continue;
      this.draw(ctx, ACCENT_SOURCE_COLORS.has(op.color) ? { ...op, color: biome.accent } : op);
    }

    // 配管コリドー: 水系統のconduitに配管ラインを重ね、通路が「配管」として読めるようにする。
    // 水系統ゲートはregionAtキャッシュのヒットで安価に判定し、水系統のときだけconduitAtを呼ぶ
    // (networkTileAtと同じ条件なので、conduitが歩けるタイルを生む場所と正確に一致する)。
    // 装飾は焼き込みキャンバスへの描画のみ。tileAt/ゲームプレイには一切影響しない。
    const P = BAKE_PPT;
    ctx.strokeStyle = biome.accent;
    ctx.lineWidth = Math.max(1, 0.14 * P);
    for (let ty = 0; ty < CHUNK_SIZE; ty++) {
      const wy = by + ty;
      for (let tx = 0; tx < CHUNK_SIZE; tx++) {
        const wx = bx + tx;
        if (regionAt(this.seed, wx, wy).system !== 'water') continue;
        const c = conduitAt(this.seed, wx, wy);
        if (!c) continue;
        ctx.beginPath();
        if (c.role === 'vertical') {
          // 縦シャフト: タイル中央に縦配管/ケーブルを1本
          const x = (tx + 0.5) * P;
          ctx.moveTo(x, ty * P);
          ctx.lineTo(x, (ty + 1) * P);
        } else {
          // 水平コリドー(floor/inside): タイル上部に水平配管を1本
          const y = (ty + 0.18) * P;
          ctx.moveTo(tx * P, y);
          ctx.lineTo((tx + 1) * P, y);
        }
        ctx.stroke();
      }
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
