import { hash2 } from '../../world/noise';

/**
 * プレート割り(見た目大幅改善 段階 1、設計 §3.1)。
 * タイル単位のパネル割り(≒1m 周期で「人間の部屋の内装」のスケール感を与えていた)に代わり、
 * ワールド座標を 2〜4 タイルの大きなプレートへ割り付け、プレート単位の明度段と
 * 境界の継ぎ目だけで面を読む。割り付けはワールド座標のハッシュのみから決まるため、
 * チャンク境界や部分再焼き込みで切れない(HARD 板の継ぎ目と同じ流儀)。純粋・決定論。
 *
 * 軸の割り付け: 12 タイルのスーパー区間を、2〜4 の和が 12 になる固定パターン列の
 * いずれかで割る。スーパー区間ごとにパターンをハッシュで選ぶので、行の高さ列は
 * 全世界で共有され(横の継ぎ目が一直線に通る)、列の幅列は行ごとに変わる。
 */

/** 12 を 2〜4 の和で表す割り付けパターン(面の大きさの振れ幅を狭めない範囲で用意) */
const PARTITIONS: readonly (readonly number[])[] = [
  [3, 3, 3, 3],
  [4, 4, 4],
  [2, 4, 3, 3],
  [4, 2, 3, 3],
  [3, 4, 2, 3],
  [2, 3, 4, 3],
  [3, 3, 2, 4],
  [4, 3, 2, 3],
  [2, 2, 4, 4],
  [3, 2, 4, 3],
  [4, 4, 2, 2],
  [2, 4, 4, 2],
];
const SUPER = 12;
/** パターン内の最大分割数(最小 2 → 6)。行 ID の一意化に使う */
const MAX_PARTS = 6;

const SALT_ROW_PATTERN = 4101;
const SALT_COL_PATTERN = 4102;
const SALT_TONE = 4103;

function patternFor(seed: number, salt: number, key: number): readonly number[] {
  const i = Math.floor(hash2(seed + salt, key, 7919) * PARTITIONS.length);
  return PARTITIONS[Math.min(PARTITIONS.length - 1, i)];
}

/** value が属する分割の [開始オフセット, 添字, 長さ] をスーパー区間内の相対座標で返す */
function locate(seed: number, salt: number, key: number, within: number): { start: number; index: number; len: number } {
  const pat = patternFor(seed, salt, key);
  let start = 0;
  for (let i = 0; i < pat.length; i++) {
    if (within < start + pat[i]) return { start, index: i, len: pat[i] };
    start += pat[i];
  }
  // within は 0..SUPER-1 のはずだが、念のため最後の分割に倒す
  return { start: SUPER - pat[pat.length - 1], index: pat.length - 1, len: pat[pat.length - 1] };
}

export type PlateTone = 0 | 1 | 2;

export interface PlateInfo {
  /** プレート原点(ワールド座標) */
  ox: number;
  oy: number;
  /** プレートの幅・高さ(タイル、2〜4) */
  w: number;
  h: number;
  /** このタイルのプレート内位置(0 始まり) */
  lx: number;
  ly: number;
  /** 明度段(0=暗、1=中(素)、2=明)。面の大きな明度構造 */
  tone: PlateTone;
  /** プレート上境界(このタイルの上端が継ぎ目) */
  seamTop: boolean;
  /** プレート左境界(このタイルの左端が継ぎ目) */
  seamLeft: boolean;
}

/** ワールド座標 (wx, wy) のタイルが属するプレートを返す。純粋・決定論。 */
export function plateAt(seed: number, wx: number, wy: number): PlateInfo {
  // 行: 全世界で共有する高さ列(スーパー行ごとにパターンを選ぶ)
  const sRow = Math.floor(wy / SUPER);
  const rowLoc = locate(seed, SALT_ROW_PATTERN, sRow, wy - sRow * SUPER);
  const oy = sRow * SUPER + rowLoc.start;
  const h = rowLoc.len;
  const ly = wy - oy;
  const rowId = sRow * MAX_PARTS + rowLoc.index;

  // 列: 行ごとに幅列が変わる(スーパー列 × 行でパターンを選ぶ)
  const sCol = Math.floor(wx / SUPER);
  const colLoc = locate(seed, SALT_COL_PATTERN, rowId * 131 + sCol, wx - sCol * SUPER);
  const ox = sCol * SUPER + colLoc.start;
  const w = colLoc.len;
  const lx = wx - ox;
  const colId = sCol * MAX_PARTS + colLoc.index;

  const t = hash2(seed + SALT_TONE, rowId, colId);
  const tone: PlateTone = t < 0.34 ? 0 : t < 0.78 ? 1 : 2;

  return { ox, oy, w, h, lx, ly, tone, seamTop: ly === 0, seamLeft: lx === 0 };
}
