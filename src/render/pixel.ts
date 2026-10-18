import { nearestIndex } from './palette';
import { bayerOffset } from './dither';
import { STEEL } from './steel';

/** 量子化キャッシュの大きさ(2^16)。直接写像なので衝突時は上書きするだけ。 */
const QUANT_CACHE_BITS = 16;
const QUANT_CACHE_MASK = (1 << QUANT_CACHE_BITS) - 1;

/**
 * (Bayer位置0..15, r,g,b) → パレット添字 の直接写像キャッシュ。
 * ディザ量は Bayer 位置ごとに16通りしかないので、このキーで nearestIndex の結果は一意に決まる
 * (総当たりと完全一致)。画面は同色が大半を占めるため、毎フレームの総当たり32色比較を避けられる。
 */
interface QuantCache {
  strength: number;
  keys: Int32Array;
  vals: Uint8Array;
}
const quantCaches = new WeakMap<Uint8Array, QuantCache>();

function quantCacheFor(palRgb: Uint8Array, strength: number): QuantCache {
  let cache = quantCaches.get(palRgb);
  if (!cache || cache.strength !== strength) {
    cache = {
      strength,
      keys: new Int32Array(1 << QUANT_CACHE_BITS).fill(-1),
      vals: new Uint8Array(1 << QUANT_CACHE_BITS),
    };
    quantCaches.set(palRgb, cache);
  }
  return cache;
}

/**
 * RGBA画素配列(w×h)をディザ付きでパレット量子化する(in-place)。純関数・決定論。
 * strength は各チャンネルに足すディザ量(px値スケール。0で無効)。palRgb は paletteRgb()。
 * アルファは保持。パレットは [r,g,b]×N の Uint8Array。
 * 結果は画素ごとの nearestIndex 総当たりと完全一致する(キャッシュは速度のためだけ)。
 */
export function quantizeRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  palRgb: Uint8Array,
  strength: number,
): void {
  const { keys, vals } = quantCacheFor(palRgb, strength);
  const offsets = new Float64Array(16);
  for (let i = 0; i < 16; i++) offsets[i] = bayerOffset(i & 3, i >> 2) * strength;
  for (let y = 0; y < h; y++) {
    const row = (y & 3) << 2;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const r = data[o];
      const g = data[o + 1];
      const b = data[o + 2];
      const bi = row | (x & 3);
      const key = (bi << 24) | (r << 16) | (g << 8) | b;
      const slot = (Math.imul(key, 0x9e3779b1) >>> (32 - QUANT_CACHE_BITS)) & QUANT_CACHE_MASK;
      let idx: number;
      if (keys[slot] === key) {
        idx = vals[slot];
      } else {
        const d = offsets[bi];
        idx = nearestIndex(r + d, g + d, b + d, palRgb);
        keys[slot] = key;
        vals[slot] = idx;
      }
      data[o] = palRgb[idx * 3];
      data[o + 1] = palRgb[idx * 3 + 1];
      data[o + 2] = palRgb[idx * 3 + 2];
    }
  }
}

/** Internal pixel density per world tile for the high-fidelity renderer. */
export const HIGH_FIDELITY_TILE_PX = 12;

/** Dither strength in pixel-value units; visually tune only within the approved weak 8–16 range. */
export const DITHER_STRENGTH = 12;

export interface PixelLayout {
  bufW: number;
  bufH: number;
  scale: number;
}

export function computePixelLayout(
  screenW: number,
  screenH: number,
  targetTilesX: number,
  tilePx: number,
): PixelLayout {
  const targetBufW = targetTilesX * tilePx;
  const scale = Math.max(1, Math.round(screenW / targetBufW));
  return {
    scale,
    bufW: Math.max(160, Math.round(screenW / scale)),
    bufH: Math.max(90, Math.round(screenH / scale)),
  };
}

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
    const layout = computePixelLayout(screenW, screenH, this.targetTilesX, this.tilePx);
    this.scale = layout.scale;
    this.bufW = layout.bufW;
    this.bufH = layout.bufH;
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
