import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  BIOME_BLEND_HALF_WIDTH,
  biomeAt,
  biomeBlend,
  biomeBoundary,
  biomeCellAt,
  biomeFromIndex,
  biomeForCell,
  biomeForSystem,
  mixHex,
  SYSTEM_BIOME,
} from './biome';
import { relLum } from './steel';

describe('biomeForSystem', () => {
  it('returns the matching system biome', () => {
    expect(biomeForSystem('water')).toBe(SYSTEM_BIOME.water);
    expect(biomeForSystem('foundry')).toBe(SYSTEM_BIOME.foundry);
  });

  it('keeps system biomes renderable', () => {
    for (const system of ['water', 'power', 'habitation', 'disposal', 'foundry'] as const) {
      const biome = SYSTEM_BIOME[system];
      expect(biome.ambientLevel).toBeGreaterThan(0);
      expect(biome.ambientLevel).toBeLessThanOrEqual(1);
      expect(biome.palette.fillMid).toMatch(/^#[0-9a-f]{6}$/i);
      expect(biome.ambientColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(biome.bgLayers.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('gives system biomes distinct fill colors', () => {
    const mids = new Set(['water', 'power', 'habitation', 'disposal', 'foundry'].map(
      (system) => SYSTEM_BIOME[system as keyof typeof SYSTEM_BIOME].palette.fillMid));
    expect(mids.size).toBe(5);
  });
});

describe('visual biome cells', () => {
  const seed = 42;

  it('keeps every sampled cell width between 1,200 and 1,800 tiles', () => {
    for (let cell = -50; cell <= 50; cell++) {
      const width = biomeBoundary(seed, cell + 1) - biomeBoundary(seed, cell);
      expect(width).toBeGreaterThanOrEqual(1200);
      expect(width).toBeLessThanOrEqual(1800);
    }
  });

  it('is deterministic for cell selection and world coordinates', () => {
    expect(biomeBoundary(seed, -12)).toBe(biomeBoundary(seed, -12));
    expect(biomeForCell(seed, -12)).toBe(biomeForCell(seed, -12));
    expect(biomeAt(seed, 5000, -3000)).toBe(biomeAt(seed, 5000, -3000));
    expect(biomeAt(seed, 123, -3000)).toBe(biomeForCell(seed, biomeCellAt(seed, -3000)));
  });

  it('selects different biomes for every pair of adjacent cells', () => {
    for (let cell = -100; cell <= 100; cell++) {
      expect(biomeForCell(seed, cell)).not.toBe(biomeForCell(seed, cell + 1));
    }
  });

  it('keeps positive and negative directions independent', () => {
    const positive = Array.from({ length: 12 }, (_, i) => biomeForCell(seed, i + 1));
    const negative = Array.from({ length: 12 }, (_, i) => biomeForCell(seed, -(i + 1)));
    expect(positive).not.toEqual(negative);
  });

  it('blends across boundaries and restores the single-biome contract after them', () => {
    const edge = biomeBoundary(seed, 0);
    const before = biomeBlend(seed, 0, edge - BIOME_BLEND_HALF_WIDTH);
    const middle = biomeBlend(seed, 0, edge);
    const after = biomeBlend(seed, 0, edge + BIOME_BLEND_HALF_WIDTH);

    expect(before.from).toBe(biomeForCell(seed, -1));
    expect(before.to).toBe(biomeForCell(seed, 0));
    expect(before.t).toBe(0);
    expect(middle.t).toBe(0.5);
    expect(middle.ambientLevel).toBe((middle.from.ambientLevel + middle.to.ambientLevel) / 2);
    expect(middle.ambientColor).toBe(mixHex(middle.from.ambientColor, middle.to.ambientColor, 0.5));
    expect(middle.palette.fillMid).toBe(
      mixHex(middle.from.palette.fillMid, middle.to.palette.fillMid, 0.5),
    );
    expect(middle.palette.edge).toBe(
      mixHex(middle.from.palette.edge, middle.to.palette.edge, 0.5),
    );
    expect(middle.accent).toBe(mixHex(middle.from.accent, middle.to.accent, 0.5));
    expect(after.from).toBe(after.to);
    expect(after.from).toBe(biomeForCell(seed, 0));
    expect(after.t).toBe(0);
    expect(after.ambientLevel).toBe(after.from.ambientLevel);
    expect(after.ambientColor).toBe(after.from.ambientColor);
  });

  it('falls back to the cold-steel biome for an undefined selection', () => {
    expect(biomeFromIndex(-1)).toBe(BIOMES[0]);
    expect(biomeFromIndex(BIOMES.length)).toBe(BIOMES[0]);
  });
});

describe('tone and palette realism', () => {
  const systems = ['water', 'power', 'habitation', 'disposal', 'foundry'] as const;

  it('keeps all biome fill colors dark', () => {
    for (const system of systems) {
      expect(relLum(SYSTEM_BIOME[system].palette.fillMid)).toBeLessThan(0.03);
    }
  });

  it('keeps palette luminance ordered from dark to edge', () => {
    for (const system of systems) {
      const palette = SYSTEM_BIOME[system].palette;
      expect(relLum(palette.fillDark)).toBeLessThan(relLum(palette.fillMid));
      expect(relLum(palette.fillMid)).toBeLessThan(relLum(palette.fillLight));
      expect(relLum(palette.fillLight)).toBeLessThan(relLum(palette.edge));
    }
  });

  it('keeps ambient colors dark', () => {
    for (const system of systems) {
      expect(relLum(SYSTEM_BIOME[system].ambientColor)).toBeLessThan(0.03);
    }
  });

  it('keeps background layers no brighter than their tile fill', () => {
    for (const system of systems) {
      const biome = SYSTEM_BIOME[system];
      for (const layer of biome.bgLayers) {
        expect(relLum(layer.color)).toBeLessThanOrEqual(relLum(biome.palette.fillMid) + 1e-6);
      }
    }
  });
});

describe('mixHex', () => {
  it('mixes black and white at each endpoint and midpoint', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
