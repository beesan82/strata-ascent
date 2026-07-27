import { nearestIndex } from './palette';
import { bayerOffset } from './dither';
import { STEEL } from './steel';

/**
 * RGBA画素配列(w×h)をディザ付きでパレット量子化する(in-place)。純関数・決定論。
 * strength は各チャンネルに足すディザ量(px値スケール。0で無効)。palRgb は paletteRgb()。
 * アルファは保持。パレットは [r,g,b]×N の Uint8Array。
 */
export function quantizeRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  palRgb: Uint8Array,
  strength: number,
): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = bayerOffset(x, y) * strength;
      const r = data[o] + d;
      const g = data[o + 1] + d;
      const b = data[o + 2] + d;
      const idx = nearestIndex(r, g, b, palRgb);
      data[o] = palRgb[idx * 3];
      data[o + 1] = palRgb[idx * 3 + 1];
      data[o + 2] = palRgb[idx * 3 + 2];
    }
  }
}

/** ディザ強度(px値スケール)。色帯を散らす量。実装時にスクショで 24〜40 を調整。 */
export const DITHER_STRENGTH = 32;

/**
 * ドット絵化パイプライン。内部低解像度canvasへ全レイヤーを描かせ、
 * 量子化+ディザして画面canvasへ整数倍で拡大転写する(nearest-neighbor)。
 * canvasに依存するためVitestでは扱わず、量子化コア(quantizeRgba)のみテストする。
 */
export class PixelPipeline {
  private buffer: HTMLCanvasElement;
  private bctx: CanvasRenderingContext2D;
  private palRgb: Uint8Array;
  bufW = 1;
  bufH = 1;
  scale = 1;

  constructor(palette: Uint8Array, private targetTilesX: number, private tilePx: number) {
    this.palRgb = palette;
    this.buffer = document.createElement('canvas');
    this.bctx = this.buffer.getContext('2d', { willReadFrequently: true })!;
  }

  /** 画面寸法から内部解像度と整数スケールを決める。renderer.resizeから呼ぶ。 */
  resize(screenW: number, screenH: number): void {
    const targetBufW = this.targetTilesX * this.tilePx; // 例 34*6=204
    this.scale = Math.max(1, Math.round(screenW / targetBufW));
    this.bufW = Math.max(160, Math.round(screenW / this.scale));
    this.bufH = Math.max(90, Math.round(screenH / this.scale));
    this.buffer.width = this.bufW;
    this.buffer.height = this.bufH;
    this.bctx.imageSmoothingEnabled = false;
  }

  /** renderer が全レイヤーを描く内部context。 */
  get ctx(): CanvasRenderingContext2D {
    return this.bctx;
  }

  /** 内部バッファを量子化し、画面へ整数拡大転写。余白(レターボックス)は最暗色で塗る。 */
  present(screenCtx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const img = this.bctx.getImageData(0, 0, this.bufW, this.bufH);
    quantizeRgba(img.data, this.bufW, this.bufH, this.palRgb, DITHER_STRENGTH);
    this.bctx.putImageData(img, 0, 0);
    screenCtx.imageSmoothingEnabled = false;
    screenCtx.fillStyle = STEEL.black;
    screenCtx.fillRect(0, 0, screenW, screenH);
    const dw = this.bufW * this.scale;
    const dh = this.bufH * this.scale;
    const dx = Math.floor((screenW - dw) / 2);
    const dy = Math.floor((screenH - dh) / 2);
    screenCtx.drawImage(this.buffer, dx, dy, dw, dh);
  }
}
