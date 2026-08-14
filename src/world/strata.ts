/** 階層(高度帯)ごとの生成パラメータ */
import { hash2 } from './noise';

export interface Stratum {
  name: string;
  /** 床の垂直間隔(タイル) */
  floorSpacing: number;
  /** 床セグメント(16タイル幅)が欠落する確率 */
  gapChance: number;
  /** 柱・壁塊ノイズの閾値。低いほど構造が密 */
  massThreshold: number;
  /** 巨大空洞ノイズの閾値。低いほど空洞が広い */
  cavityThreshold: number;
}

export const STRATUM_HEIGHT = 500;

export const STRATA: readonly Stratum[] = [
  { name: '最下層',   floorSpacing: 8,  gapChance: 0.15, massThreshold: 0.55, cavityThreshold: 0.85 },
  { name: '居住区跡', floorSpacing: 10, gapChance: 0.2,  massThreshold: 0.6,  cavityThreshold: 0.8 },
  { name: '廃棄物層', floorSpacing: 12, gapChance: 0.45, massThreshold: 0.62, cavityThreshold: 0.78 },
  { name: '大空洞帯', floorSpacing: 14, gapChance: 0.35, massThreshold: 0.7,  cavityThreshold: 0.6 },
  { name: '上層',     floorSpacing: 12, gapChance: 0.3,  massThreshold: 0.68, cavityThreshold: 0.7 },
];

/** ワールドy座標 → 階層インデックス(0始まり、ループ前の通し番号) */
export function stratumIndexAt(worldY: number): number {
  return Math.floor(worldY / STRATUM_HEIGHT);
}

/** ワールドy座標 → 階層パラメータ(末尾以降はループ) */
export function stratumAt(seed: number, worldY: number): Stratum {
  const band = stratumIndexAt(worldY);
  const normalizedParity = ((band % 2) + 2) % 2;
  const pool = normalizedParity === 0 ? [0, 1] : [2, 3, 4];
  const selection = Math.floor(hash2(seed + 811, band, band < 0 ? -1 : 1) * pool.length);
  return STRATA[pool[selection]] ?? STRATA[0];
}
