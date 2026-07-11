/** 対象タイルの8近傍がSOLID(同種)かどうか */
export interface Neighbors {
  n: boolean; e: boolean; s: boolean; w: boolean;
  ne: boolean; se: boolean; sw: boolean; nw: boolean;
}

/** タイルの各辺がAIR(=非SOLID)に面するか */
export interface EdgeMask {
  top: boolean; right: boolean; bottom: boolean; left: boolean;
}

/**
 * 8近傍 → 正規化された8bitマスク。
 * 角は両隣の辺が両方SOLIDのときのみ有効、という標準47ブロブ規則。
 * この1関数がCANONICAL構築ループとblobIdの両方で使われる(規則の単一情報源)。
 */
function canonMask(nb: Neighbors): number {
  const ne = nb.n && nb.e && nb.ne;
  const se = nb.s && nb.e && nb.se;
  const sw = nb.s && nb.w && nb.sw;
  const nw = nb.n && nb.w && nb.nw;
  return (
    (nb.n ? 1 : 0) | (nb.e ? 2 : 0) | (nb.s ? 4 : 0) | (nb.w ? 8 : 0) |
    (ne ? 16 : 0) | (se ? 32 : 0) | (sw ? 64 : 0) | (nw ? 128 : 0)
  );
}

/** 生の8bitマスク m から Neighbors を構築 */
function neighborsFromBits(m: number): Neighbors {
  return {
    n: !!(m & 1), e: !!(m & 2), s: !!(m & 4), w: !!(m & 8),
    ne: !!(m & 16), se: !!(m & 32), sw: !!(m & 64), nw: !!(m & 128),
  };
}

/**
 * 到達可能な正規化マスクを昇順で密な索引へ写す(モジュール読込時に1度構築)。
 * 併せて blobId → 各辺がAIRに面するか の逆引き表も構築する。
 */
const CANONICAL: Map<number, number> = new Map();
const EDGES: EdgeMask[] = [];
(() => {
  const seen = new Set<number>();
  for (let m = 0; m < 256; m++) {
    seen.add(canonMask(neighborsFromBits(m)));
  }
  [...seen].sort((a, b) => a - b).forEach((canon, i) => {
    CANONICAL.set(canon, i);
    // 辺ビットは canon マスクの一部なので canon(=blobId)ごとに一意に定まる。
    EDGES[i] = {
      top: !(canon & 1),    // n がSOLIDでなければ上辺はAIRに面する
      right: !(canon & 2),  // e
      bottom: !(canon & 4), // s
      left: !(canon & 8),   // w
    };
  });
})();

/** 標準47ブロブの形状数 */
export const BLOB_COUNT = CANONICAL.size;

/**
 * 8近傍 → 0..BLOB_COUNT-1 の決定論的なタイル形状ID。
 * 辺(N,E,S,W)を基本に、角(NE,SE,SW,NW)は両隣の辺が繋がっている場合のみ意味を持つ。
 */
export function blobId(nb: Neighbors): number {
  return CANONICAL.get(canonMask(nb))!;
}

/**
 * 逆引き: 指定ブロブIDのタイルで、どの辺がAIR(=非SOLID)に面するか。
 * タイルアート生成器が縁取り/角の描画に使う。
 */
export function edgesForBlobId(id: number): EdgeMask {
  return { ...EDGES[id] };
}
