import type { BiomeBlend } from './biome';
import { mixHex } from './biome';
import type { Camera } from '../core/camera';
import { slotsInView, type Slot } from './megastructure/place';
import { buildStructure } from './megastructure/catalog';
import { makeRng } from './megastructure/rng';
import { hazeFactor, hazeColor } from './megastructure/atmosphere';
import type { DrawOp, StructureSpec, Tone } from './megastructure/spec';

/** 明度段 → 基準色への混合率(遠=暗, 近=明) */
const TONE_MIX: Record<Tone, number> = { far: 0.12, mid: 0.3, near: 0.5 };

export class MegaStructure {
  /** スロットキー → 生成済みスペック(損傷を量子化してキャッシュ) */
  private cache = new Map<string, StructureSpec>();

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

    const haze = hazeColor(bb.ambientColor);
    // 構造の基準色(黒に近い青灰。tone/かすみで持ち上げる)
    const baseDark = mixHex('#05090e', bb.ambientColor, 0.25);

    for (const s of slots) {
      const spec = this.specFor(s);
      // スロットの画面矩形。深度 factor で水平パララックス、基部は画面下 85% に接地。
      const scale = s.factor;
      const sw = s.span * ppt;
      const sh = sw * 1.1; // 構造の見かけ縦横比
      const sx = (s.worldX - cam.x * scale) * ppt + w / 2 - sw / 2;
      const baseY = h * 0.85 + cam.y * scale * 0.15 * ppt;
      const sy = baseY - sh;
      if (sx + sw < 0 || sx > w) continue;

      const hf = hazeFactor(s.depth);
      this.drawSpec(ctx, spec, sx, sy, sw, sh, baseDark, haze, hf);
    }
    ctx.globalAlpha = 1;
  }

  private specFor(s: Slot): StructureSpec {
    const q = Math.round(s.damage * 4) / 4; // 損傷を1/4刻みに量子化
    const key = `${s.key}:${s.type}:${q}`;
    let spec = this.cache.get(key);
    if (!spec) {
      spec = buildStructure(s.type, s.damage, makeRng(this.seed, s.variantSeed, Math.round(q * 100)));
      this.cache.set(key, spec);
    }
    return spec;
  }

  /** かすみを織り込んだ塗り色。tone で持ち上げ、かすみ係数で霞色へ寄せる。 */
  private fill(base: string, haze: string, tone: Tone, hf: number): string {
    const lit = mixHex(base, '#9fb4c8', TONE_MIX[tone]);
    return mixHex(lit, haze, hf);
  }

  private drawSpec(
    ctx: CanvasRenderingContext2D,
    spec: StructureSpec,
    ox: number, oy: number, sw: number, sh: number,
    base: string, haze: string, hf: number,
  ): void {
    const X = (x: number) => ox + x * sw;
    const Y = (y: number) => oy + y * sh;
    // 遠いほど全体を淡く(かすみで沈む)
    const alpha = 0.5 + (1 - hf) * 0.45;
    for (const op of spec.ops) {
      this.drawOp(ctx, op, X, Y, sw, sh, base, haze, hf, alpha);
    }
  }

  private drawOp(
    ctx: CanvasRenderingContext2D, op: DrawOp,
    X: (x: number) => number, Y: (y: number) => number, sw: number, sh: number,
    base: string, haze: string, hf: number, alpha: number,
  ): void {
    ctx.globalAlpha = alpha;
    switch (op.t) {
      case 'mass':
        ctx.fillStyle = this.fill(base, haze, op.tone, hf);
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      case 'cyl': {
        const g = ctx.createLinearGradient(X(op.x), 0, X(op.x) + op.w * sw, 0);
        g.addColorStop(0, this.fill(base, haze, 'far', hf));
        g.addColorStop(0.35, this.fill(base, haze, op.tone, hf));
        g.addColorStop(1, this.fill(base, haze, 'far', hf));
        ctx.fillStyle = g;
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      }
      case 'truss': {
        ctx.strokeStyle = this.fill(base, haze, 'mid', hf);
        ctx.lineWidth = Math.max(1, sw * 0.01);
        const x0 = X(op.x), y0 = Y(op.y), ww = op.w * sw, hh = op.h * sh;
        ctx.strokeRect(x0, y0, ww, hh);
        for (let b = 1; b < 5; b++) { const by = y0 + hh * (b / 5); ctx.beginPath(); ctx.moveTo(x0, by); ctx.lineTo(x0 + ww, by); ctx.stroke(); }
        break;
      }
      case 'pipe':
        ctx.strokeStyle = this.fill(base, haze, 'mid', hf);
        ctx.lineWidth = Math.max(1, op.width * sw);
        ctx.beginPath();
        op.pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
        ctx.stroke();
        break;
      case 'panels': {
        ctx.strokeStyle = this.fill(base, haze, 'near', hf);
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
        ctx.fillStyle = '#03060a';
        ctx.fillRect(X(op.x), Y(op.y), op.w * sw, op.h * sh);
        break;
      case 'frame':
        ctx.strokeStyle = this.fill(base, haze, 'near', hf);
        ctx.globalAlpha = alpha * 0.7;
        ctx.lineWidth = 1;
        for (let i = 0; i < 4; i++) { const fx = X(op.x) + op.w * sw * (i / 4); ctx.beginPath(); ctx.moveTo(fx, Y(op.y)); ctx.lineTo(fx, Y(op.y) + op.h * sh); ctx.stroke(); }
        ctx.globalAlpha = alpha;
        break;
      case 'rim':
        // リムライトはかすみで弱める(遠いほど淡い)
        ctx.strokeStyle = mixHex('#7d97ad', haze, hf);
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
    }
  }
}
