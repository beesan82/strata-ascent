/** 4×4 Bayer 行列(0..15)。順序付きディザの閾値パターン。 */
export const BAYER4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/**
 * (x,y) の Bayer 閾値オフセット [-0.5, 0.5)。4×4周期(負座標も対応)。
 * 量子化前に各チャンネルへ offset*strength を足すと、色帯の階段が空間的に散る。
 */
export function bayerOffset(x: number, y: number): number {
  const ix = ((x % 4) + 4) % 4;
  const iy = ((y % 4) + 4) % 4;
  return BAYER4[iy * 4 + ix] / 16 - 0.5;
}
