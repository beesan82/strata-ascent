import type { BiomeId } from './biomeCells';

export interface TerrainProfile {
  floorSpacing: number;
  gapChance: number;
  massThreshold: number;
  cavityThreshold: number;
  /** 柱・壁塊ノイズの粒度。大きいほど塊が大きく滑らか */
  massScale: number;
  /** 巨大空洞ノイズの粒度。大きいほど空洞が巨大 */
  cavityScale: number;
  /** 空洞内に残る橋（床帯）の間隔（床帯の本数単位） */
  bridgeEvery: number;
  /** 床セグメントの長さ。欠落の「粒」の大きさ */
  segLen: number;
}

export const TERRAIN_PROFILE: Record<BiomeId, TerrainProfile> = {
  coldSteel: { floorSpacing: 8, gapChance: 0.18, massThreshold: 0.55, cavityThreshold: 0.84, massScale: 28, cavityScale: 160, bridgeEvery: 4, segLen: 16 },
  habitation: { floorSpacing: 5, gapChance: 0.08, massThreshold: 0.42, cavityThreshold: 0.92, massScale: 14, cavityScale: 120, bridgeEvery: 3, segLen: 8 },
  disposal: { floorSpacing: 10, gapChance: 0.55, massThreshold: 0.6, cavityThreshold: 0.78, massScale: 40, cavityScale: 160, bridgeEvery: 4, segLen: 24 },
  waterVoid: { floorSpacing: 15, gapChance: 0.3, massThreshold: 0.74, cavityThreshold: 0.42, massScale: 36, cavityScale: 260, bridgeEvery: 6, segLen: 16 },
  power: { floorSpacing: 9, gapChance: 0.28, massThreshold: 0.58, cavityThreshold: 0.7, massScale: 28, cavityScale: 160, bridgeEvery: 4, segLen: 16 },
};

export function terrainProfileFor(id: BiomeId): TerrainProfile {
  return TERRAIN_PROFILE[id] ?? TERRAIN_PROFILE.coldSteel;
}
