import type { BiomeId } from './biomeCells';

export interface TerrainProfile {
  floorSpacing: number;
  gapChance: number;
  massThreshold: number;
  cavityThreshold: number;
}

export const TERRAIN_PROFILE: Record<BiomeId, TerrainProfile> = {
  coldSteel: { floorSpacing: 8, gapChance: 0.18, massThreshold: 0.55, cavityThreshold: 0.84 },
  habitation: { floorSpacing: 6, gapChance: 0.12, massThreshold: 0.48, cavityThreshold: 0.9 },
  disposal: { floorSpacing: 10, gapChance: 0.48, massThreshold: 0.61, cavityThreshold: 0.74 },
  waterVoid: { floorSpacing: 14, gapChance: 0.32, massThreshold: 0.72, cavityThreshold: 0.56 },
  power: { floorSpacing: 9, gapChance: 0.28, massThreshold: 0.58, cavityThreshold: 0.7 },
};

export function terrainProfileFor(id: BiomeId): TerrainProfile {
  return TERRAIN_PROFILE[id] ?? TERRAIN_PROFILE.coldSteel;
}
