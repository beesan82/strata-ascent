/** 対象タイルの8近傍がSOLID(同種)かどうか */
export interface Neighbors {
  n: boolean; e: boolean; s: boolean; w: boolean;
  ne: boolean; se: boolean; sw: boolean; nw: boolean;
}

/**
 * 到達可能な正規化マスクを昇順で密な索引へ写す(モジュール読込時に1度構築)。
 * 角は両隣の辺が両方SOLIDのときのみ有効、という標準47ブロブ規則。
 */
const CANONICAL: Map<number, number> = (() => {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) {
    const n = !!(m & 1), e = !!(m & 2), s = !!(m & 4), w = !!(m & 8);
    const ne = n && e && !!(m & 16);
    const se = s && e && !!(m & 32);
    const sw = s && w && !!(m & 64);
    const nw = n && w && !!(m & 128);
    const canon =
      (n ? 1 : 0) | (e ? 2 : 0) | (s ? 4 : 0) | (w ? 8 : 0) |
      (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0);
    seen.add(canon);
  }
  const map = new Map<number, number>();
  [...seen].sort((a, b) => a - b).forEach((canon, i) => map.set(canon, i));
  return map;
})();

/** 標準47ブロブの形状数 */
export const BLOB_COUNT = CANONICAL.size;

/**
 * 8近傍 → 0..BLOB_COUNT-1 の決定論的なタイル形状ID。
 * 辺(N,E,S,W)を基本に、角(NE,SE,SW,NW)は両隣の辺が繋がっている場合のみ意味を持つ。
 */
export function blobId(nb: Neighbors): number {
  const ne = nb.n && nb.e && nb.ne;
  const se = nb.s && nb.e && nb.se;
  const sw = nb.s && nb.w && nb.sw;
  const nw = nb.n && nb.w && nb.nw;
  const canon =
    (nb.n ? 1 : 0) | (nb.e ? 2 : 0) | (nb.s ? 4 : 0) | (nb.w ? 8 : 0) |
    (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0);
  return CANONICAL.get(canon)!;
}
