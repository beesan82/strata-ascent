// 使い方: npx vite-node scripts/quantbench.ts <frame.bin>... [--iters=60]
//   scripts/dumpframe.mjs が書いた量子化前の画素で quantizeRgba を回し、1 フレームあたりの ms と
//   画素の内訳(4 px 左と同色の近道 / キャッシュ命中 / 総当たり)を出す。総当たりの参照実装と
//   全画素一致することも確かめる。present の量子化を触るときに、機械ノイズ無しで前後を比べる道具。
import { readFileSync } from 'node:fs';
import { quantizeRgba, DITHER_STRENGTH } from '../src/render/pixel';
import { paletteRgb, nearestIndex } from '../src/render/palette';
import { bayerOffset } from '../src/render/dither';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--'));
const iters = Number(argv.find((a) => a.startsWith('--iters='))?.split('=')[1] ?? 60);
const pal = paletteRgb();

function load(path: string): { w: number; h: number; data: Uint8ClampedArray } {
  const buf = readFileSync(path);
  const w = buf.readUInt32LE(0);
  const h = buf.readUInt32LE(4);
  const data = new Uint8ClampedArray(buf.buffer.slice(buf.byteOffset + 8, buf.byteOffset + 8 + w * h * 4));
  return { w, h, data };
}

function reference(src: Uint8ClampedArray, w: number, h: number): Uint8ClampedArray {
  const out = src.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const d = bayerOffset(x, y) * DITHER_STRENGTH;
      const idx = nearestIndex(out[o] + d, out[o + 1] + d, out[o + 2] + d, pal);
      out[o] = pal[idx * 3];
      out[o + 1] = pal[idx * 3 + 1];
      out[o + 2] = pal[idx * 3 + 2];
    }
  }
  return out;
}

/** 画素の内訳: 近道(4 px 左と同色)/ 同色キーの種類数 / 色の種類数 / 4 行上と同色 */
function profile(src: Uint8ClampedArray, w: number, h: number): string {
  const px = new Uint32Array(src.buffer, src.byteOffset, w * h);
  let left4 = 0;
  let up4 = 0;
  let left1 = 0;
  const colors = new Set<number>();
  const keys = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = px[y * w + x] & 0xffffff;
      colors.add(p);
      keys.add((((y & 3) << 2 | (x & 3)) << 24) | p);
      if (x >= 4 && p === (px[y * w + x - 4] & 0xffffff)) left4++;
      if (x >= 1 && p === (px[y * w + x - 1] & 0xffffff)) left1++;
      if (y >= 4 && p === (px[(y - 4) * w + x] & 0xffffff)) up4++;
    }
  }
  const n = w * h;
  const pct = (v: number) => `${(100 * v / n).toFixed(1)}%`;
  return `left4=${pct(left4)} left1=${pct(left1)} up4=${pct(up4)} colors=${colors.size} keys=${keys.size}`;
}

for (const file of files) {
  const { w, h, data } = load(file);
  const ref = reference(data, w, h);
  const once = data.slice();
  quantizeRgba(once, w, h, pal, DITHER_STRENGTH);
  let mismatch = 0;
  for (let i = 0; i < once.length; i++) if (once[i] !== ref[i]) mismatch++;
  // ウォームアップ(キャッシュを温める。実機でも前フレームで温まっている)
  for (let i = 0; i < 5; i++) quantizeRgba(data.slice(), w, h, pal, DITHER_STRENGTH);
  const times: number[] = [];
  for (let i = 0; i < iters; i++) {
    const copy = data.slice();
    const t0 = performance.now();
    quantizeRgba(copy, w, h, pal, DITHER_STRENGTH);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  const min = times[0];
  console.log(`${file}: ${w}x${h} quantize p50=${p50.toFixed(2)}ms min=${min.toFixed(2)}ms mismatch=${mismatch} | ${profile(data, w, h)}`);
}
