import { hash2 } from '../world/noise';

interface Layer {
  factor: number; // カメラ移動への追従率(小さいほど遠い)
  alpha: number;
  slotW: number; // 塔の配置スロット幅(タイル)
  deckH: number; // デッキの配置スロット高(タイル)
  color: string;
}

const LAYERS: Layer[] = [
  { factor: 0.35, alpha: 0.1, slotW: 22, deckH: 16, color: '#8fa0b0' },
  { factor: 0.18, alpha: 0.05, slotW: 34, deckH: 26, color: '#8fa0b0' },
];

/** 闇の奥にかすかに見える巨大構造のパララックス遠景(決定論的) */
export class Background {
  constructor(private seed: number) {}

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, w: number, h: number, ppt: number): void {
    LAYERS.forEach((L, li) => {
      const offX = camX * L.factor * ppt;
      const offY = camY * L.factor * 0.6 * ppt;
      ctx.globalAlpha = L.alpha;
      ctx.fillStyle = L.color;

      // 縦の巨大塔
      const slotPx = L.slotW * ppt;
      const k0 = Math.floor((offX - w / 2) / slotPx) - 1;
      const k1 = Math.floor((offX + w / 2) / slotPx) + 1;
      for (let k = k0; k <= k1; k++) {
        if (hash2(this.seed + 900 + li, k, 0) > 0.55) continue;
        const tw = (0.12 + hash2(this.seed + 901 + li, k, 1) * 0.5) * slotPx;
        const tx = k * slotPx - offX + w / 2 + hash2(this.seed + 902 + li, k, 2) * slotPx * 0.4;
        ctx.fillRect(tx, 0, tw, h);
      }

      // 水平デッキ
      const rowPx = L.deckH * ppt;
      const j0 = Math.floor((offY - h / 2) / rowPx) - 1;
      const j1 = Math.floor((offY + h / 2) / rowPx) + 1;
      for (let j = j0; j <= j1; j++) {
        if (hash2(this.seed + 903 + li, 0, j) > 0.3) continue;
        const jy = j * rowPx - offY + h / 2;
        const dw = (0.3 + hash2(this.seed + 904 + li, 1, j) * 0.7) * w;
        const dx = hash2(this.seed + 905 + li, 2, j) * (w - dw);
        ctx.fillRect(dx, jy, dw, Math.max(2, 0.6 * ppt));
      }
    });
    ctx.globalAlpha = 1;
  }
}
