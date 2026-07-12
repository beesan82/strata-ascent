import { hash2 } from '../world/noise';
import type { BiomeBlend, BgLayer } from './biome';

/**
 * バイオーム配色の多層パララックス遠景(決定論的・継ぎ目なし)。
 *
 * 現在地バイオーム(bb.from)の bgLayers を奥→手前で描く。各層は factor で
 * カメラ追従率が変わり、構造は整数スロット番号でハッシュ配置するためパンしても
 * 継ぎ目が出ない。バイオーム遷移は短い(遷移帯60タイル)ため from の層のみ描く。
 */
export class Background {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    w: number,
    h: number,
    ppt: number,
    bb: BiomeBlend,
  ): void {
    const layers = bb.from.bgLayers;
    for (let li = 0; li < layers.length; li++) {
      const L = layers[li];
      switch (L.kind) {
        case 'tower': this.towers(ctx, L, li, camX, w, h, ppt); break;
        case 'deck': this.decks(ctx, L, li, camY, w, h, ppt); break;
        case 'haze': this.haze(ctx, L, li, camY, w, h, ppt); break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /** 近い層ほど不透明(0.2〜0.45に収める) */
  private alphaFor(base: number, factor: number): number {
    return Math.min(0.45, base * (0.7 + factor));
  }

  /** 縦の巨大塔: 画面全高のバーをスロット単位で配置し水平パララックス */
  private towers(ctx: CanvasRenderingContext2D, L: BgLayer, li: number, camX: number, w: number, h: number, ppt: number): void {
    ctx.globalAlpha = this.alphaFor(0.34, L.factor);
    ctx.fillStyle = L.color;
    const slotTiles = 13 + Math.round(L.factor * 20);
    const slotPx = slotTiles * ppt;
    const offX = camX * L.factor * ppt;
    const k0 = Math.floor((offX - w / 2) / slotPx) - 1;
    const k1 = Math.floor((offX + w / 2) / slotPx) + 1;
    const s = this.seed + 100 + li * 7;
    for (let k = k0; k <= k1; k++) {
      // density = 出現確率。閾値超えは欠落。
      if (hash2(s, k, 0) > L.density) continue;
      const tw = (0.18 + hash2(s, k, 1) * 0.42) * slotPx;
      const jitter = hash2(s, k, 2) * (slotPx - tw);
      const tx = k * slotPx - offX + w / 2 + jitter;
      // 塔頭を少し変えて高さの違う構造群に見せる(下端は常に画面外まで)
      const top = -h * 0.1 + hash2(s, k, 3) * h * 0.35;
      ctx.fillRect(tx, top, tw, h - top + h * 0.1);
    }
  }

  /** 水平デッキ: 行単位のバーを垂直パララックスで配置 */
  private decks(ctx: CanvasRenderingContext2D, L: BgLayer, li: number, camY: number, w: number, h: number, ppt: number): void {
    ctx.globalAlpha = this.alphaFor(0.3, L.factor);
    ctx.fillStyle = L.color;
    const rowTiles = 11 + Math.round(L.factor * 18);
    const rowPx = rowTiles * ppt;
    const offY = camY * L.factor * 0.6 * ppt;
    const j0 = Math.floor((offY - h / 2) / rowPx) - 1;
    const j1 = Math.floor((offY + h / 2) / rowPx) + 1;
    const s = this.seed + 300 + li * 7;
    const thick = Math.max(2, 0.7 * ppt);
    for (let j = j0; j <= j1; j++) {
      if (hash2(s, 0, j) > L.density) continue;
      const jy = j * rowPx - offY + h / 2;
      const dw = (0.35 + hash2(s, 1, j) * 0.55) * w;
      const dx = hash2(s, 2, j) * (w - dw);
      ctx.fillRect(dx, jy, dw, thick);
      // デッキ下面のリブ(細い影)で厚みを持たせる
      ctx.globalAlpha = this.alphaFor(0.18, L.factor);
      ctx.fillRect(dx, jy + thick, dw, Math.max(1, thick * 0.5));
      ctx.globalAlpha = this.alphaFor(0.3, L.factor);
    }
  }

  /** かすみ: 非常に淡い水平の色帯(垂直グラデーション) */
  private haze(ctx: CanvasRenderingContext2D, L: BgLayer, _li: number, camY: number, w: number, h: number, ppt: number): void {
    const offY = camY * L.factor * 0.4 * ppt;
    // 画面中央付近をゆっくり漂う帯
    const bandH = h * 0.7;
    const cy = h / 2 - offY * 0.15;
    const y0 = cy - bandH / 2;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + bandH);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, L.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = this.alphaFor(0.22, L.factor);
    ctx.fillStyle = g;
    ctx.fillRect(0, y0, w, bandH);
  }
}
