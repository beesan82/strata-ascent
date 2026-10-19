import { HOLE_OFFSET, HOLE_WIDTH, mod } from '../world/interface';
import { STEEL } from './steel';

/**
 * 超構造体材パレット(設計書 §6.1)。界面の板(HARD)はほぼ黒・平坦で、16 タイルごとの継ぎ目線、
 * 下面の垂下リブ、上下面の硬い 2 px エッジだけで量塊を示す。面内の装飾・ディザは入れない。
 * ここは純粋関数(焼き込みは chunkbake.ts)。
 */

/** 板の塗り。PIXEL_PALETTE の 4 番目。鋼の fillDark(#070c12)より暗く、空のフィルより僅かに明るい */
export const HARD_FILL = '#05090f';
/** 継ぎ目線(1 px) */
export const HARD_SEAM = STEEL.stringer;
/** 上面(新しい層の床)のエッジ */
export const HARD_EDGE_TOP = STEEL.railTop;
/** 下面(前の層の天井)のエッジ */
export const HARD_EDGE_BOTTOM = STEEL.bayEdge;
/** 側面(縦坑・大穴の壁)のエッジ */
export const HARD_EDGE_SIDE = STEEL.post;

export const SEAM_SPACING = 16;
export const RIB_SPACING = 8;
/** 硬いエッジの太さ(焼き込み px) */
export const EDGE_PX = 2;
/** エッジ強度がこの水平距離(タイル)で最小になる */
export const EDGE_FALLOFF_TILES = 256;

/** 継ぎ目線: 16 タイルごとの縦(v)・横(h)。ワールド座標基準なのでチャンクをまたいでも揃う */
export function hardSeamAt(wx: number, wy: number): { v: boolean; h: boolean } {
  return { v: mod(wx, SEAM_SPACING) === 0, h: mod(wy, SEAM_SPACING) === 0 };
}

/** 下面の垂下リブ: 8 タイルごと */
export function hardRibAt(wx: number): boolean {
  return mod(wx, RIB_SPACING) === 0;
}

/** エッジの強度(§6.1「光柱に近いほど強い」): 大穴の真下で 1、256 タイル以遠で 0.3 */
export function hardEdgeStrength(dxToHole: number): number {
  return 1 - 0.7 * Math.min(1, Math.abs(dxToHole) / EDGE_FALLOFF_TILES);
}

/** 大穴(孔 +24〜+72)の中心 X = 孔 +48 */
export function holeCenterX(px: number): number {
  return px + HOLE_OFFSET + HOLE_WIDTH / 2;
}
