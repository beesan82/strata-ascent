import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from './biomeCells';
import { TERRAIN_PROFILE, terrainProfileFor } from './biomeTerrain';

describe('biome terrain profiles', () => {
  it('assigns the specified terrain parameters to every biome', () => {
    expect(TERRAIN_PROFILE).toEqual({
      coldSteel: { floorSpacing: 8, gapChance: 0.18, massThreshold: 0.55, cavityThreshold: 0.84, massScale: 28, cavityScale: 160, bridgeEvery: 4, segLen: 16, spawnMul: 1.0, collapseMul: 1.0 },
      habitation: { floorSpacing: 5, gapChance: 0.08, massThreshold: 0.42, cavityThreshold: 0.92, massScale: 14, cavityScale: 120, bridgeEvery: 3, segLen: 8, spawnMul: 0.8, collapseMul: 1.0 },
      disposal: { floorSpacing: 10, gapChance: 0.55, massThreshold: 0.6, cavityThreshold: 0.78, massScale: 40, cavityScale: 160, bridgeEvery: 4, segLen: 24, spawnMul: 1.0, collapseMul: 2.0 },
      waterVoid: { floorSpacing: 15, gapChance: 0.3, massThreshold: 0.74, cavityThreshold: 0.42, massScale: 36, cavityScale: 260, bridgeEvery: 6, segLen: 16, spawnMul: 0.7, collapseMul: 1.0 },
      power: { floorSpacing: 9, gapChance: 0.28, massThreshold: 0.58, cavityThreshold: 0.7, massScale: 28, cavityScale: 160, bridgeEvery: 4, segLen: 16, spawnMul: 1.2, collapseMul: 1.0 },
      foundry: { floorSpacing: 11, gapChance: 0.35, massThreshold: 0.58, cavityThreshold: 0.72, massScale: 32, cavityScale: 150, bridgeEvery: 5, segLen: 20, spawnMul: 1.3, collapseMul: 1.0 },
      biomech: { floorSpacing: 12, gapChance: 0.22, massThreshold: 0.5, cavityThreshold: 0.8, massScale: 48, cavityScale: 180, bridgeEvery: 4, segLen: 16, spawnMul: 1.1, collapseMul: 1.0 },
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
      expect(profile.floorSpacing).toBeGreaterThanOrEqual(5);
      expect(profile.floorSpacing).toBeLessThanOrEqual(15);
      expect(profile.gapChance).toBeGreaterThanOrEqual(0);
      expect(profile.gapChance).toBeLessThanOrEqual(1);
      expect(profile.massThreshold).toBeGreaterThanOrEqual(0);
      expect(profile.massThreshold).toBeLessThanOrEqual(1);
      expect(profile.cavityThreshold).toBeGreaterThanOrEqual(0);
      expect(profile.cavityThreshold).toBeLessThanOrEqual(1);
      expect(profile.massScale).toBeGreaterThan(0);
      expect(profile.cavityScale).toBeGreaterThan(0);
      expect(profile.bridgeEvery).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(profile.bridgeEvery)).toBe(true);
      expect(profile.segLen).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(profile.segLen)).toBe(true);
      expect(profile.spawnMul).toBeGreaterThan(0);
      expect(profile.collapseMul).toBeGreaterThan(0);
    }
  });

  it('gives foundry the greatest spawn multiplier and disposal the greatest collapse weight', () => {
    expect(TERRAIN_PROFILE.foundry.spawnMul).toBeGreaterThan(
      Math.max(...BIOME_IDS.filter((id) => id !== 'foundry').map((id) => TERRAIN_PROFILE[id].spawnMul)),
    );
    expect(TERRAIN_PROFILE.disposal.collapseMul).toBeGreaterThan(
      Math.max(...BIOME_IDS.filter((id) => id !== 'disposal').map((id) => TERRAIN_PROFILE[id].collapseMul)),
    );
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
      const p = TERRAIN_PROFILE[id];
      return `${p.floorSpacing}/${p.gapChance}/${p.massThreshold}/${p.cavityThreshold}/${p.massScale}/${p.cavityScale}/${p.bridgeEvery}/${p.segLen}`;
    });

    expect(new Set(tuples)).toHaveLength(BIOME_IDS.length);
  });
});
