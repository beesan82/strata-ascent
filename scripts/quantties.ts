// 使い方: npx vite-node scripts/quantties.ts
//   pixel.ts の整数距離(×8 スケール)と palette.ts の浮動小数距離の順序が食い違い得るのは
//   「厳密な同距離」のときだけ。2 色 i,j の距離差は (r,g,b) の一次式になるので、全 (i,j,Bayer位置)
//   について整数解を数え上げ、その入力で i,j が最近傍かを調べ、整数の先勝ちと浮動小数の結果が
//   割れる入力を JSON で列挙する(pixel.test.ts の同距離テストの表の出どころ。約 8 秒)。
//   パレットか DITHER_STRENGTH を変えたら回し直し、表を更新すること。
import { paletteRgb, nearestIndex } from '../src/render/palette';
import { bayerOffset } from '../src/render/dither';
import { DITHER_STRENGTH } from '../src/render/pixel';
const pal = paletteRgb();
const n = pal.length / 3;
const off8 = new Int32Array(16);
for (let i = 0; i < 16; i++) off8[i] = Math.round(bayerOffset(i & 3, i >> 2) * DITHER_STRENGTH * 8);
const P = (i: number, c: number) => pal[i * 3 + c] * 8;
let ties = 0, nearestTies = 0, divergent = 0;
const divergentList: number[][] = [];
const t0 = performance.now();
for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
  const dR = P(i, 0) - P(j, 0), dG = P(i, 1) - P(j, 1), dB = P(i, 2) - P(j, 2);
  const sR = P(i, 0) + P(j, 0), sG = P(i, 1) + P(j, 1), sB = P(i, 2) + P(j, 2);
  for (let bi = 0; bi < 16; bi++) {
    const o = off8[bi];
    // 30 dR (2(8r+o) - sR) + 59 dG (2(8g+o) - sG) + 11 dB (2(8b+o) - sB) = 0
    const cb = 11 * dB * 16; // b の係数
    for (let r = 0; r < 256; r++) {
      const tr = 30 * dR * (2 * (8 * r + o) - sR);
      for (let g = 0; g < 256; g++) {
        const rest = -(tr + 59 * dG * (2 * (8 * g + o) - sG));
        // 11 dB (2(8b+o) - sB) = rest
        if (cb === 0) { if (11 * dB * (2 * o - sB) !== rest) continue; for (let b = 0; b < 256; b++) check(r, g, b, bi, i, j); continue; }
        const num = rest - 11 * dB * (2 * o - sB);
        if (num % cb !== 0) continue;
        const b = num / cb;
        if (b >= 0 && b < 256) check(r, g, b, bi, i, j);
      }
    }
  }
}
function dist8(r: number, g: number, b: number, k: number) {
  const dr = r - P(k, 0), dg = g - P(k, 1), db = b - P(k, 2);
  return 30 * dr * dr + 59 * dg * dg + 11 * db * db;
}
function check(r: number, g: number, b: number, bi: number, i: number, j: number) {
  ties++;
  const o = off8[bi];
  const r8 = 8 * r + o, g8 = 8 * g + o, b8 = 8 * b + o;
  const d = dist8(r8, g8, b8, i);
  if (d !== dist8(r8, g8, b8, j)) throw new Error('bug');
  let best = Infinity;
  for (let k = 0; k < n; k++) best = Math.min(best, dist8(r8, g8, b8, k));
  if (d !== best) return;
  nearestTies++;
  // 浮動小数版(現行 nearestIndex)と整数版(先勝ち)の結果
  const f = nearestIndex(r + o / 8, g + o / 8, b + o / 8, pal);
  let bi2 = 0, bd = 0x7fffffff;
  for (let k = 0; k < n; k++) { const dk = dist8(r8, g8, b8, k); if (dk < bd) { bd = dk; bi2 = k; } }
  if (f !== bi2) { divergent++; divergentList.push([r, g, b, bi, f, bi2]); }
}
console.log(JSON.stringify(divergentList));
console.log(`ties=${ties} nearestTies=${nearestTies} divergent=${divergent} (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
