import { nearestIndex } from './palette';
import { bayerOffset } from './dither';
import { STEEL } from './steel';

/**
 * 量子化キャッシュの大きさ(2^18)。隣り合う2枠を1組にした2-way(組の中は簡易LRU)。
 * 2^16 ではポストのグレイン(毎フレーム違う 3 枚、画素の半分を +1 する)が (色×Bayer) のキーを
 * 3 倍に増やして溢れ、光溜まりの下で 1 フレーム約 4000 回の総当たりが起きていた。2^18 で約 1/10 になる。
 */
const QUANT_CACHE_BITS = 18;
const QUANT_CACHE_SET_MASK = ((1 << QUANT_CACHE_BITS) - 1) & ~1;

/**
 * キー → 組の先頭枠。キー上位の Bayer 位置ビットまでよく混ぜる(murmur3 の fmix32)。
 * 単純な乗算ハッシュでは Bayer 位置だけ違う同色のキーが同じ枠に集まり、毎フレーム数千回の
 * 追い出し(=総当たり再計算)が起きていた。
 */
function quantSlot(key: number): number {
  let h = key ^ (key >>> 16);
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h & QUANT_CACHE_SET_MASK;
}

/** 整数距離のスケール。Bayer オフセット×強度 8 は 2/8 刻み(強度 12 では 3/8 刻み)なので ×8 で整数になる。 */
const INT_SCALE = 8;

/**
 * (Bayer位置0..15, r,g,b) → 量子化後の色 の直接写像キャッシュ。
 * ディザ量は Bayer 位置ごとに16通りしかないので、このキーで nearestIndex の結果は一意に決まる
 * (総当たりと完全一致)。画面は同色が大半を占めるため、毎フレームの総当たり32色比較を避けられる。
 * 値は書き戻す色を画素と同じ32bit配置(リトルエンディアンで r|g<<8|b<<16、アルファ0)で持つ。
 * offsets は Bayer 位置ごとのディザ量。intOffsets/palInt はミス時の整数距離用(全オフセット×8 が
 * 整数のときだけ使う。そうでない強度では nearestIndex に落ちる)。
 */
interface QuantCache {
  strength: number;
  keys: Int32Array;
  vals: Uint32Array;
  offsets: Float64Array;
  intExact: boolean;
  intOffsets: Int32Array;
  palInt: Int32Array;
}
const quantCaches = new WeakMap<Uint8Array, QuantCache>();

function quantCacheFor(palRgb: Uint8Array, strength: number): QuantCache {
  let cache = quantCaches.get(palRgb);
  if (!cache || cache.strength !== strength) {
    const offsets = new Float64Array(16);
    const intOffsets = new Int32Array(16);
    let intExact = true;
    for (let i = 0; i < 16; i++) {
      offsets[i] = bayerOffset(i & 3, i >> 2) * strength;
      const scaled = offsets[i] * INT_SCALE;
      if (!Number.isInteger(scaled)) intExact = false;
      intOffsets[i] = scaled;
    }
    const palInt = new Int32Array(palRgb.length);
    for (let i = 0; i < palRgb.length; i++) palInt[i] = palRgb[i] * INT_SCALE;
    cache = {
      strength,
      keys: new Int32Array(1 << QUANT_CACHE_BITS).fill(-1),
      vals: new Uint32Array(1 << QUANT_CACHE_BITS),
      offsets,
      intExact,
      intOffsets,
      palInt,
    };
    quantCaches.set(palRgb, cache);
  }
  return cache;
}

/**
 * nearestIndex と同じ結果を整数演算で求める(キャッシュミス時の総当たり)。
 * r8,g8,b8 はディザ量を足した値の ×8、palInt はパレット ×8。重み 0.30/0.59/0.11 は ×100 して
 * 30/59/11。距離の大小は浮動小数版と一致する(差が 0 でなければ 1/6400 以上あり、丸め誤差より
 * 桁違いに大きい)。唯一食い違い得るのは厳密な同距離で、そのときだけ浮動小数版と同じ比較に委ねる
 * (scripts/quantties.ts が全入力を数え上げ、強度 8 では同距離は 2^24×16 入力中 3363 件、うち整数の
 * 先勝ちと浮動小数の結果が割れるものが 735 件あることを確かめている。強度 12 では 205 件 / 46 件)。
 */
function nearestIndexInt(
  r8: number, g8: number, b8: number, palInt: Int32Array, palRgb: Uint8Array, d: number, p: number,
): number {
  let best = 0;
  let bestD = 0x7fffffff;
  const n = palInt.length / 3;
  for (let i = 0; i < n; i++) {
    const dr = r8 - palInt[i * 3];
    const dg = g8 - palInt[i * 3 + 1];
    const db = b8 - palInt[i * 3 + 2];
    const dist = 30 * dr * dr + 59 * dg * dg + 11 * db * db;
    if (dist < bestD) {
      bestD = dist;
      best = i;
    } else if (dist === bestD && floatDist(p, d, i, palRgb) < floatDist(p, d, best, palRgb)) {
      // 厳密な同距離: 浮動小数の参照実装(nearestIndex)の「d < bestD」判定と同じにする
      best = i;
    }
  }
  return best;
}

/** nearestIndex と同じ式・同じ演算順の浮動小数距離(同距離の裁定専用) */
function floatDist(p: number, d: number, i: number, palRgb: Uint8Array): number {
  const dr = (p & 255) + d - palRgb[i * 3];
  const dg = ((p >>> 8) & 255) + d - palRgb[i * 3 + 1];
  const db = ((p >>> 16) & 255) + d - palRgb[i * 3 + 2];
  return 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
}

/**
 * RGBA画素配列(w×h)をディザ付きでパレット量子化する(in-place)。純関数・決定論。
 * strength は各チャンネルに足すディザ量(px値スケール。0で無効)。palRgb は paletteRgb()。
 * アルファは保持。パレットは [r,g,b]×N の Uint8Array。
 * 結果は画素ごとの nearestIndex 総当たりと完全一致する(キャッシュは速度のためだけ)。
 * 画素は32bit単位で読み書きする(リトルエンディアン前提。ブラウザ/Nodeの実行環境はすべて該当)。
 */
export function quantizeRgba(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  palRgb: Uint8Array,
  strength: number,
): void {
  const { keys, vals, offsets, intExact, intOffsets, palInt } = quantCacheFor(palRgb, strength);
  const px = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const src4 = new Uint32Array(4);
  const out4 = new Uint32Array(4);
  for (let y = 0; y < h; y++) {
    const row = (y & 3) << 2;
    const base = y * w;
    for (let x = 0; x < w; x++) {
      const p = px[base + x];
      // 同じBayer位置になる4画素左と同色なら結果も同じ(平坦な面の大半はここで済み、表を引かない)
      if (x >= 4 && (p & 0xffffff) === (src4[x & 3] & 0xffffff)) {
        px[base + x] = (p & 0xff000000) | out4[x & 3];
        continue;
      }
      src4[x & 3] = p;
      const bi = row | (x & 3);
      const key = (bi << 24) | (p & 0xffffff);
      const slot = quantSlot(key);
      let out: number;
      if (keys[slot] === key) {
        out = vals[slot];
      } else if (keys[slot + 1] === key) {
        // 2番目で当たったら先頭と入れ替える(よく使う方を先頭に)
        out = vals[slot + 1];
        keys[slot + 1] = keys[slot];
        vals[slot + 1] = vals[slot];
        keys[slot] = key;
        vals[slot] = out;
      } else {
        const d = offsets[bi];
        let idx: number;
        if (intExact) {
          const d8 = intOffsets[bi];
          idx = nearestIndexInt(
            ((p & 255) << 3) + d8, (((p >>> 8) & 255) << 3) + d8, (((p >>> 16) & 255) << 3) + d8,
            palInt, palRgb, d, p,
          );
        } else {
          idx = nearestIndex((p & 255) + d, ((p >>> 8) & 255) + d, ((p >>> 16) & 255) + d, palRgb);
        }
        out = palRgb[idx * 3] | (palRgb[idx * 3 + 1] << 8) | (palRgb[idx * 3 + 2] << 16);
        // 先頭を2番目へ押し出して先頭に入れる
        keys[slot + 1] = keys[slot];
        vals[slot + 1] = vals[slot];
        keys[slot] = key;
        vals[slot] = out;
      }
      out4[x & 3] = out;
      px[base + x] = (p & 0xff000000) | out;
    }
  }
}

/**
 * 1 タイルあたりの内部ピクセル密度（高精細レンダラ用）。
 * 12 → 15（2026-11-09 のスパイク裁定、計画 docs/superpowers/plans/2026-11-09-resolution.md）:
 * 計測基準の 1280×720 では整数 scale が 3 のままバッファ寸法不変（427×240）でフレーム
 * コストが増えず、広い画面でのみ一段上がる（1920×1080: 384×216 → 480×270、iPhone 横持ち
 * 物理 2556×1179: 426×197 → 511×236）。18（= 1280 で 640×360、画素 2.25 倍）は量子化が
 * 画素数に比例して伸び、present の p50 が +2.5〜+6.5ms 増えて採用基準（render p50 の増加
 * +1.0ms 以内）を超えたため不採用。ズーム 1 での ppt は全画面で BAKE_PPT(16) 以下に収まり、
 * チャンク焼き込みの実解像度も損なわない。
 */
export const HIGH_FIDELITY_TILE_PX = 15;

/**
 * Dither strength in pixel-value units; visually tune only within the approved weak 8–16 range.
 * 段階 1 で 12 → 8 を採用(2026-11-08 の A/B 裁定): 3 場面比較で平坦面の網点が
 * 計測でも目視でも減り(4×4 ブロック内色数 3.51 → 3.05)、新たなバンディングは出なかった。
 */
export const DITHER_STRENGTH = 8;

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
    // 空のフィルが毎フレーム全面を不透明に塗るので alpha:false(不透明サーフェス)。getImageData の
    // 読み戻しで premultiplied → straight の変換が要らなくなる。
    this.bctx = this.buffer.getContext('2d', { willReadFrequently: true, alpha: false })!;
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

  /**
   * 直近 present の内訳(ms): [getImageData(同期ラスタ化込み), quantizeRgba, putImageData, 画面への転写]。
   * 計測用(main の ?stats=1 → scripts/frametime.mjs)。
   */
  lastParts = new Float64Array(4);
  /** true のとき次の present で量子化前の生画素を lastRaw に複写する(scripts/dumpframe.mjs 用) */
  captureRaw = false;
  lastRaw: Uint8ClampedArray | null = null;

  /** 内部バッファを量子化し、画面へ整数拡大転写。余白(レターボックス)は最暗色で塗る。 */
  present(screenCtx: CanvasRenderingContext2D, screenW: number, screenH: number): void {
    const parts = this.lastParts;
    const t0 = performance.now();
    const img = this.bctx.getImageData(0, 0, this.bufW, this.bufH);
    if (this.captureRaw) {
      this.lastRaw = img.data.slice();
      this.captureRaw = false;
    }
    const t1 = performance.now();
    quantizeRgba(img.data, this.bufW, this.bufH, this.palRgb, DITHER_STRENGTH);
    const t2 = performance.now();
    this.bctx.putImageData(img, 0, 0);
    const t3 = performance.now();
    screenCtx.imageSmoothingEnabled = false;
    screenCtx.fillStyle = STEEL.black;
    screenCtx.fillRect(0, 0, screenW, screenH);
    const dw = this.bufW * this.scale;
    const dh = this.bufH * this.scale;
    const dx = Math.floor((screenW - dw) / 2);
    const dy = Math.floor((screenH - dh) / 2);
    screenCtx.drawImage(this.buffer, dx, dy, dw, dh);
    const t4 = performance.now();
    parts[0] = t1 - t0;
    parts[1] = t2 - t1;
    parts[2] = t3 - t2;
    parts[3] = t4 - t3;
  }
}
