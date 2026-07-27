/** 4×4 Bayer 行列(0..15)。順序付きディザの閾値パターン。 */
export const BAYER4: readonly number[] = [
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
];

/**
 * (x,y) の Bayer 閾値オフセット [-0.46875, 0.46875]。4×4周期(負座標も対応)。
 * 量子化前に各チャンネルへ offset*strength を足すと、色帯の階段が空間的に散る。
 * 区間中心を使うため16マスの平均は厳密に0(一律加算しても暗方向/明方向バイアスを生まない)。
 * x, y は整数ピクセル座標であること(非整数を渡すと BAYER4 の添字が非整数になり NaN を返す)。
 */
export function bayerOffset(x: number, y: number): number {
  const ix = ((x % 4) + 4) % 4;
  const iy = ((y % 4) + 4) % 4;
  return (BAYER4[iy * 4 + ix] + 0.5) / 16 - 0.5;
}
