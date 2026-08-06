export const PIXEL_PALETTE: readonly string[] = [
  '#020408', '#03050a', '#04070c', '#05090f',
  '#070c12', '#091017', '#0a121a', '#0d141c',
  '#10171f', '#131b24', '#16202b', '#192633',
  '#1c3040', '#203446', '#22384a', '#263d51',
  '#2a4258', '#2f4961', '#33506a', '#39536c',
  '#3d566e', '#456078', '#4a6a84', '#53738c',
  '#5f7d94', '#6d899f', '#7d97ad', '#c7d0ce',
  '#3d2618', '#5a3a24', '#9a6d32', '#caa64a',
];

/** パレットを [r,g,b, r,g,b, ...] の数値配列に展開(量子化ループ用に一度だけ) */
export function paletteRgb(): Uint8Array {
  const out = new Uint8Array(PIXEL_PALETTE.length * 3);
  for (let i = 0; i < PIXEL_PALETTE.length; i++) {
    const p = parseInt(PIXEL_PALETTE[i].slice(1), 16);
    out[i * 3] = (p >> 16) & 255;
    out[i * 3 + 1] = (p >> 8) & 255;
    out[i * 3 + 2] = p & 255;
  }
  return out;
}

/**
 * (r,g,b) に最も近いパレット色の添字。知覚寄りの重み付きユークリッド距離
 * (0.30/0.59/0.11)で、緑の差を強く見る。純関数・決定論。
 * palRgb は paletteRgb() の出力(呼び出し側で使い回す)。
 */
export function nearestIndex(r: number, g: number, b: number, palRgb: Uint8Array): number {
  let best = 0;
  let bestD = Infinity;
  const n = palRgb.length / 3;
  for (let i = 0; i < n; i++) {
    const dr = r - palRgb[i * 3];
    const dg = g - palRgb[i * 3 + 1];
    const db = b - palRgb[i * 3 + 2];
    const d = 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
