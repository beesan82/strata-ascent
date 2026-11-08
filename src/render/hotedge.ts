/**
 * 掘削縁の熱色残光(段階 3、設計 §5.1)の判定。
 * 掘削直後の縁に熱色を残す表現は焼き込み側に相乗りさせ、時間で冷える切り替えは
 * 「期限が来たら 1 回だけ再焼き込みする」ことで行う(毎フレームの再焼き込みはしない)。
 * ここは「どの面が掘削縁か」の純粋関数だけを持つ。
 */
import { TILE, isSolid } from '../world/tiles';

/** 発射後、掘削縁が熱色で残る秒数(ChunkBaker の期限管理で使う) */
export const HEAT_SECONDS = 6;

export type HotSide = 'n' | 'e' | 's' | 'w';

export interface HotEdge {
  /** チャンク内タイル座標 */
  x: number;
  y: number;
  /** クレーターに面している辺 */
  side: HotSide;
}

/**
 * (size+2)×(size+2) のグリッド。中心 size×size が対象チャンク、
 * 周囲 1 セルは隣接チャンク分(境界の縁判定用)。添字は (y+1)*(size+2)+(x+1)。
 */
export interface HotEdgeGrids {
  /** 現在地形(破壊反映済み) */
  current: Uint8Array;
  /** 元地形(破壊前) */
  pristine: Uint8Array;
  /** 破壊マスク(0/1) */
  destroyed: Uint8Array;
}

/** クレーター = 破壊済み かつ 元地形が空気でないセル(未生成への記録だけのセルを除く) */
function isCrater(g: HotEdgeGrids, n: number, x: number, y: number): boolean {
  const i = (y + 1) * n + (x + 1);
  return g.destroyed[i] === 1 && g.pristine[i] !== TILE.AIR;
}

/**
 * 掘削縁の一覧: 現在固体のタイルのうち、4 近傍のいずれかがクレーターである面。
 * HARD も固体として縁を持つ(板の際を掘った熱が板の面に残る)。
 */
export function hotEdges(g: HotEdgeGrids, size: number): HotEdge[] {
  const n = size + 2;
  const out: HotEdge[] = [];
  const sides: Array<[number, number, HotSide]> = [
    [0, -1, 'n'],
    [1, 0, 'e'],
    [0, 1, 's'],
    [-1, 0, 'w'],
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isSolid(g.current[(y + 1) * n + (x + 1)])) continue;
      for (const [dx, dy, side] of sides) {
        if (isCrater(g, n, x + dx, y + dy)) out.push({ x, y, side });
      }
    }
  }
  return out;
}
