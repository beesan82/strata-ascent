import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from './biomeCells';
import { TERRAIN_PROFILE, terrainProfileFor } from './biomeTerrain';

describe('biome terrain profiles', () => {
  it('assigns the specified terrain parameters to every biome', () => {
    expect(TERRAIN_PROFILE).toEqual({
      coldSteel: { floorSpacing: 8, gapChance: 0.18, massThreshold: 0.55, cavityThreshold: 0.84 },
      habitation: { floorSpacing: 6, gapChance: 0.12, massThreshold: 0.48, cavityThreshold: 0.9 },
      disposal: { floorSpacing: 10, gapChance: 0.48, massThreshold: 0.61, cavityThreshold: 0.74 },
      waterVoid: { floorSpacing: 14, gapChance: 0.32, massThreshold: 0.72, cavityThreshold: 0.56 },
      power: { floorSpacing: 9, gapChance: 0.28, massThreshold: 0.58, cavityThreshold: 0.7 },
    });

    for (const id of BIOME_IDS) {
      expect(terrainProfileFor(id)).toBe(TERRAIN_PROFILE[id]);
    }
  });

  it('falls back to the cold-steel profile by identity for an invalid runtime ID', () => {
    expect(terrainProfileFor('not-a-biome' as keyof typeof TERRAIN_PROFILE)).toBe(TERRAIN_PROFILE.coldSteel);
  });

  it('keeps all profile values in valid terrain ranges', () => {
    for (const id of BIOME_IDS) {
      const profile = terrainProfileFor(id);
      expect(profile.floorSpacing).toBeGreaterThanOrEqual(6);
      expect(profile.floorSpacing).toBeLessThanOrEqual(14);
      expect(profile.gapChance).toBeGreaterThanOrEqual(0);
      expect(profile.gapChance).toBeLessThanOrEqual(1);
      expect(profile.massThreshold).toBeGreaterThanOrEqual(0);
      expect(profile.massThreshold).toBeLessThanOrEqual(1);
      expect(profile.cavityThreshold).toBeGreaterThanOrEqual(0);
      expect(profile.cavityThreshold).toBeLessThanOrEqual(1);
    }
  });

  it('gives disposal the greatest floor-gap chance', () => {
    expect(TERRAIN_PROFILE.disposal.gapChance).toBeGreaterThan(
      Math.max(...BIOME_IDS.filter((id) => id !== 'disposal').map((id) => TERRAIN_PROFILE[id].gapChance)),
    );
  });

  it('makes water void the least structurally dense and most cavity-dense profile', () => {
    expect(TERRAIN_PROFILE.waterVoid.massThreshold).toBeGreaterThan(
      Math.max(...BIOME_IDS.filter((id) => id !== 'waterVoid').map((id) => TERRAIN_PROFILE[id].massThreshold)),
    );
    expect(TERRAIN_PROFILE.waterVoid.cavityThreshold).toBeLessThan(
      Math.min(...BIOME_IDS.filter((id) => id !== 'waterVoid').map((id) => TERRAIN_PROFILE[id].cavityThreshold)),
    );
  });

  it('keeps each biome terrain tuple distinct', () => {
    const tuples = BIOME_IDS.map((id) => {
      const { floorSpacing, gapChance, massThreshold, cavityThreshold } = TERRAIN_PROFILE[id];
      return `${floorSpacing}/${gapChance}/${massThreshold}/${cavityThreshold}`;
    });

    expect(new Set(tuples)).toHaveLength(BIOME_IDS.length);
  });
});
