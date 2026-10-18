export interface CellRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type MaskAt = (cx: number, cy: number) => Uint8Array | undefined;

/**
 * チャンク(cx,cy)の再焼き込み範囲。自チャンクの破壊に加え、隣接チャンクの破壊のうち境界から
 * dilate セル以内のもの(オートタイルや痕跡判定でこのチャンクの見た目に効く)も含めた外接矩形を
 * dilate だけ広げ、チャンク内へ切り詰める。何もなければ null。部分再焼き込みで描き直す範囲に使う。
 */
export function dirtyBoundsAround(maskAt: MaskAt, cx: number, cy: number, size: number, dilate: number): CellRect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let ny = -1; ny <= 1; ny++) {
    for (let nx = -1; nx <= 1; nx++) {
      const mask = maskAt(cx + nx, cy + ny);
      if (!mask) continue;
      // 隣のマスクは境界側の dilate 幅だけ見る(ローカル座標で [-dilate, size+dilate) の範囲)
      const lx0 = nx < 0 ? size - dilate : 0;
      const lx1 = nx > 0 ? dilate - 1 : size - 1;
      const ly0 = ny < 0 ? size - dilate : 0;
      const ly1 = ny > 0 ? dilate - 1 : size - 1;
      for (let y = Math.max(0, ly0); y <= Math.min(size - 1, ly1); y++) {
        for (let x = Math.max(0, lx0); x <= Math.min(size - 1, lx1); x++) {
          if (mask[y * size + x] !== 1) continue;
          const wx = x + nx * size;
          const wy = y + ny * size;
          if (wx < x0) x0 = wx;
          if (wx > x1) x1 = wx;
          if (wy < y0) y0 = wy;
          if (wy > y1) y1 = wy;
        }
      }
    }
  }
  if (x1 === -Infinity) return null;
  x0 = Math.max(0, x0 - dilate);
  y0 = Math.max(0, y0 - dilate);
  x1 = Math.min(size - 1, x1 + dilate);
  y1 = Math.min(size - 1, y1 + dilate);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * 破壊のあったチャンク群から、焼き込みを無効化すべきチャンク("cx,cy")を返す。
 * 破壊チャンク自身に加え、境界から dilate セル以内に破壊がある側の隣接チャンクを含める。
 */
export function rebakeTargets(affected: Iterable<string>, maskAt: MaskAt, size: number, dilate: number): Set<string> {
  const out = new Set<string>();
  for (const key of affected) {
    out.add(key);
    const [cx, cy] = key.split(',').map(Number);
    const mask = maskAt(cx, cy);
    if (!mask) continue;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (mask[y * size + x] !== 1) continue;
        const nx0 = x < dilate ? -1 : 0;
        const nx1 = x >= size - dilate ? 1 : 0;
        const ny0 = y < dilate ? -1 : 0;
        const ny1 = y >= size - dilate ? 1 : 0;
        for (let ny = ny0; ny <= ny1; ny++)
          for (let nx = nx0; nx <= nx1; nx++)
            if (nx !== 0 || ny !== 0) out.add(`${cx + nx},${cy + ny}`);
      }
    }
  }
  return out;
}

/** rect を margin セルだけ広げ、[0,size) に切り詰める */
export function expandRect(r: CellRect, margin: number, size: number): CellRect {
  const x0 = Math.max(0, r.x - margin);
  const y0 = Math.max(0, r.y - margin);
  const x1 = Math.min(size, r.x + r.w + margin);
  const y1 = Math.min(size, r.y + r.h + margin);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
