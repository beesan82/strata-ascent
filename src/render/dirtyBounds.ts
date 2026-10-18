export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * size×size のマスク(1=対象)の外接矩形を dilate セルだけ広げて返す(範囲外は切り詰め)。
 * 対象がなければ null。部分再焼き込みのクリップ領域に使う。
 * 複数矩形のクリップはGPUキャンバスで継ぎ目やタイル端の画素が全面焼き込みと食い違うため、
 * 1矩形に限っている。
 */
export function dirtyBounds(mask: Uint8Array, size: number, dilate: number): CellRect | null {
  let x0 = size, y0 = size, x1 = -1, y1 = -1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (mask[y * size + x] !== 1) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - dilate);
  y0 = Math.max(0, y0 - dilate);
  x1 = Math.min(size - 1, x1 + dilate);
  y1 = Math.min(size - 1, y1 + dilate);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
