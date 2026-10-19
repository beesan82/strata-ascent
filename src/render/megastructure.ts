import type { BiomeBlend } from './biome';
import type { Camera } from '../core/camera';
import { slotsInView, type Slot } from './megastructure/place';
import { buildStructure, type StructureType } from './megastructure/catalog';
import { makeRng } from './megastructure/rng';
import { hazeFactor, hazeColor, structureFill } from './megastructure/atmosphere';
import { STEEL, mixHex } from './steel';
import type { DrawOp, StructureSpec } from './megastructure/spec';
import { bakeKey, bakeLayout, LruCache, specBounds, visibleBlit } from './megastructure/bake';

/** 焼き込み済みの塔 1 本。origin は塔原点(左上)のキャンバス内位置。 */
interface BakedTower {
  canvas: HTMLCanvasElement;
  originX: number;
  originY: number;
}

export class MegaStructure {
  /** スロットキー → 生成済みスペック(損傷を量子化してキャッシュ) */
  private cache = new Map<string, StructureSpec>();
  /** キャッシュ上限。超えたら最古から捨てる(可視は数十なので実害なし。specは再生成が安価) */
  private static readonly CACHE_CAP = 600;
  /**
   * 焼き込みキャンバスのキャッシュ。毎フレーム塔を描き直すと(ソフトウェア描画で)約 5 ms 掛かるので、
   * (spec キー, 見かけ幅, 環境色, かすみ) ごとに一度 CPU キャンバスへ描き、以後は drawImage で貼る。
   * 可視は数十本で、キーは歩いても変わらない(sw はズーム由来、環境色は縦移動の混合帯でのみ変わる)。
   * 1 本 ≈ 330×420 px ≈ 0.5 MB なので上限 64 で 32 MB 止まり。
   */
  static readonly BAKE_CAP = 64;
  private bakes = new LruCache<BakedTower>(MegaStructure.BAKE_CAP);

  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: Camera,
    w: number,
    h: number,
    ppt: number,
    bb: BiomeBlend,
  ): void {
    const spanTiles = w / ppt;
    const slots = slotsInView(this.seed, cam.x, spanTiles, cam.y);
    // 遠(depth小)から描くと近が上に来る
    slots.sort((a, b) => a.depth - b.depth);

    ctx.save();
    ctx.globalAlpha = 1; // 塔ごとの alpha は焼き込み側に含めてある
    for (const s of slots) {
      // スロットの画面矩形。深度 factor で水平パララックス、基部は画面下 90% の地平に接地。
      // 縦は遠背景として地平固定(絶対高度で飛ばないよう縦パララックスは持たない)。
      const scale = s.factor;
      const sw = s.span * ppt;
      const sh = sw * 1.25; // 塔状に縦長。基部から立ち上がり空洞を埋める
      const sx = (s.worldX - cam.x * scale) * ppt + w / 2 - sw / 2;
      if (sx + sw < 0 || sx > w) continue; // 画面外は spec 生成前に捨てる

      const spec = this.specFor(s);
      const baseY = h * 0.9;
      const sy = baseY - sh;
      const hf = hazeFactor(s.depth);
      const baked = this.bakedFor(s, spec, sw, sh, bb.ambientColor, hf);
      // 焼き込みは整数画素に貼る(副画素位置の AA は捨て、塔の縁は 1 px 刻みで動く)。
      // 主バッファは imageSmoothingEnabled=false なので小数位置に貼っても最近傍で同じ結果になる。
      const dx = Math.round(sx) - baked.originX;
      const dy = Math.round(sy) - baked.originY;
      const r = visibleBlit(dx, dy, baked.canvas.width, baked.canvas.height, w, h);
      if (!r) continue;
      ctx.drawImage(baked.canvas, r.sx, r.sy, r.w, r.h, r.dx, r.dy, r.w, r.h);
    }
    ctx.restore();
  }

  /** 塔 1 本の焼き込みを返す(無ければ描いてキャッシュ)。 */
  private bakedFor(
    s: Slot, spec: StructureSpec, sw: number, sh: number, ambientColor: string, hf: number,
  ): BakedTower {
    const key = bakeKey({ specKey: this.specKey(s), sw, ambientColor, hf });
    const hit = this.bakes.get(key);
    if (hit) return hit;
    const layout = bakeLayout(specBounds(spec, sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    // 読み戻しはしないが、GPU 無し前提の CPU キャンバスに揃える(chunkbake と同じ)
    const bctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.drawSpec(bctx, spec, layout.originX, layout.originY, sw, sh, ambientColor, hf);
    const baked = { canvas, originX: layout.originX, originY: layout.originY };
    this.bakes.set(key, baked);
    return baked;
  }

  /** spec キャッシュのキー(損傷を 1/4 刻みに量子化)。焼き込みキーの材料にもなる。 */
  private specKey(s: Slot): string {
    const q = Math.round(s.damage * 4) / 4;
    const type: StructureType = s.biomech ? 'biomech' : s.type;
    return `${s.key}:${type}:${q}`;
  }

  private specFor(s: Slot): StructureSpec {
    const q = Math.round(s.damage * 4) / 4; // 損傷を1/4刻みに量子化
    const type: StructureType = s.biomech ? 'biomech' : s.type;
    const key = this.specKey(s);
    let spec = this.cache.get(key);
    if (!spec) {
      spec = buildStructure(type, s.damage, makeRng(this.seed, s.variantSeed, Math.round(q * 100)));
      this.cache.set(key, spec);
      if (this.cache.size > MegaStructure.CACHE_CAP) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    return spec;
  }

  private drawSpec(
    ctx: CanvasRenderingContext2D,
    spec: StructureSpec,
    ox: number, oy: number, sw: number, sh: number,
    ambientColor: string, hf: number,
  ): void {
    const X = (x: number) => ox + x * sw;
    const Y = (y: number) => oy + y * sh;
    // 遠いほど全体を淡く(かすみで沈む)。闇に埋もれないよう下限を高めに。
    const alpha = 0.6 + (1 - hf) * 0.35;
    for (const op of spec.ops) {
      this.drawOp(ctx, op, X, Y, sw, sh, ambientColor, hf, alpha);
    }
  }

  private drawOp(
    ctx: CanvasRenderingContext2D, op: DrawOp,
    X: (x: number) => number, Y: (y: number) => number, sw: number, sh: number,
    ambientColor: string, hf: number, alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    switch (op.t) {
      case 'mass':
        ctx.fillStyle = structureFill(ambientColor, op.tone, hf);
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      case 'cyl': {
        const g = ctx.createLinearGradient(X(op.x), 0, X(op.x) + op.w * sw, 0);
        g.addColorStop(0, structureFill(ambientColor, 'far', hf));
        g.addColorStop(0.35, structureFill(ambientColor, op.tone, hf));
        g.addColorStop(1, structureFill(ambientColor, 'far', hf));
        ctx.fillStyle = g;
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      }
      case 'truss': {
        ctx.strokeStyle = structureFill(ambientColor, 'mid', hf);
        ctx.lineWidth = Math.max(1, sw * 0.01);
        const x0 = X(op.x), y0 = Y(op.y), ww = op.w * sw, hh = op.h * sh;
        ctx.strokeRect(x0, y0, ww, hh);
        for (let b = 1; b < 5; b++) { const by = y0 + hh * (b / 5); ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x0 + ww, by); ctx.stroke(); }
        break;
      }
      case 'pipe':
        ctx.strokeStyle = structureFill(ambientColor, 'mid', hf);
        ctx.lineWidth = Math.max(1, op.width * sw);
        ctx.beginPath();
        op.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        break;
      case 'panels': {
        ctx.strokeStyle = structureFill(ambientColor, 'near', hf);
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = 1;
        const cols = Math.max(2, Math.floor(op.w * sw / 14));
        const rows = Math.max(2, Math.floor(op.h * sh / 12));
        for (let c = 0; c <= cols; c++) { const px = X(op.x) + (op.w * sw) * (c / cols); ctx.beginPath(); ctx.moveTo(px, Y(op.y)); ctx.lineTo(px, Y(op.y) + op.h * sh); ctx.stroke(); }
        for (let r = 0; r <= rows; r++) { const py = Y(op.y) + (op.h * sh) * (r / rows); ctx.beginPath(); ctx.moveTo(X(op.x), py); ctx.lineTo(X(op.x) + op.w * sw, py); ctx.stroke(); }
        ctx.globalAlpha = alpha;
        break;
      }
      case 'gap':
        ctx.fillStyle = STEEL.bg;
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      case 'frame':
        ctx.strokeStyle = structureFill(ambientColor, 'near', hf);
        ctx.globalAlpha = alpha * 0.7;
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const fx = X(op.x) + op.w * sw * (i / 4); ctx.beginPath(); ctx.moveTo(fx, Y(op.y)); ctx.lineTo(fx, Y(op.y) + op.h * sh); ctx.stroke(); }
        ctx.globalAlpha = alpha;
        break;
      case 'rim':
        // リムライトはかすみで弱める(遠いほど淡い)。輪郭の可読性はこの明ラインが担う
        ctx.strokeStyle = mixHex(STEEL.rim, hazeColor(ambientColor), hf);
        ctx.globalAlpha = (0.4 + (1 - hf) * 0.5);
        ctx.lineWidth = Math.max(1, sw * 0.006);
        ctx.beginPath();
        op.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        ctx.globalAlpha = alpha;
        break;
      case 'glow': {
        const col = op.kind === 'heat' ? '#c8641e' : '#8fd0ff';
        const r = op.r * sw;
        const g = ctx.createRadialGradient(X(op.x), Y(op.y), 0, X(op.x), Y(op.y), r * 3);
        g.addColorStop(0, col);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.globalAlpha = (op.kind === 'heat' ? 0.5 : 0.35) * (1 - hf);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(X(op.x), Y(op.y), r * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = alpha;
        break;
      }
      default: {
        const _exhaustive: never = op;
        void _exhaustive;
        break;
      }
    }
  }
}
