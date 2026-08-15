import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  BIOME_BLEND_HALF_WIDTH,
  BIOME_CELL_BASE,
  BIOME_CELL_JITTER,
  VISUAL_BIOME,
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
import { nearestIndex, paletteRgb } from './palette';
import { BIOME_IDS, biomeIdForCell } from '../world/biomeCells';

const rgbDistance = (a: string, b: string): number => {
  const aa = parseInt(a.slice(1), 16);
  const bb = parseInt(b.slice(1), 16);
  const dr = ((aa >> 16) & 255) - ((bb >> 16) & 255);
  const dg = ((aa >> 8) & 255) - ((bb >> 8) & 255);
  const db = (aa & 255) - (bb & 255);
  return Math.hypot(dr, dg, db);
};

const quantizedHex = (hex: string): string => {
  const value = parseInt(hex.slice(1), 16);
  const rgb = paletteRgb();
  const index = nearestIndex((value >> 16) & 255, (value >> 8) & 255, value & 255, rgb);
  return `#${[rgb[index * 3], rgb[index * 3 + 1], rgb[index * 3 + 2]]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
};

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

  it('re-exports the shared short cell constants', () => {
    expect(BIOME_CELL_BASE).toBe(375);
    expect(BIOME_CELL_JITTER).toBe(75);
    expect(BIOME_BLEND_HALF_WIDTH).toBe(50);
  });

  it('keeps every sampled cell width between 300 and 450 tiles', () => {
    for (let cell = -50; cell <= 50; cell++) {
      const width = biomeBoundary(seed, cell + 1) - biomeBoundary(seed, cell);
      expect(width).toBeGreaterThanOrEqual(300);
      expect(width).toBeLessThanOrEqual(450);
    }
  });

  it('is deterministic for cell selection and world coordinates', () => {
    expect(biomeBoundary(seed, -12)).toBe(biomeBoundary(seed, -12));
    expect(biomeForCell(seed, -12)).toBe(biomeForCell(seed, -12));
    expect(biomeAt(seed, 5000, -3000)).toBe(biomeAt(seed, 5000, -3000));
    expect(biomeAt(seed, 123, -3000)).toBe(biomeForCell(seed, biomeCellAt(seed, -3000)));
  });

  it('maps shared biome IDs to visual biomes in their stable order', () => {
    expect(BIOMES).toEqual(BIOME_IDS.map((id) => VISUAL_BIOME[id]));
    for (let cell = -100; cell <= 100; cell++) {
      expect(biomeForCell(seed, cell)).toBe(VISUAL_BIOME[biomeIdForCell(seed, cell)]);
    }
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

describe('visual biome separation', () => {
  const visualBiomes = BIOME_IDS.map((id) => VISUAL_BIOME[id]);

  it('keeps every biome visual tuple distinct', () => {
    const tuples = new Set(visualBiomes.map((biome) => JSON.stringify({
      ambientColor: biome.ambientColor,
      ambientLevel: biome.ambientLevel,
      fillMid: biome.palette.fillMid,
      accent: biome.accent,
      layers: biome.bgLayers.map(({ color, density, factor, kind }) => [color, density, factor, kind]),
    })));
    expect(tuples.size).toBe(BIOME_IDS.length);
  });

  it('keeps ambient, accent, and foreground background colors materially separated', () => {
    for (let i = 0; i < visualBiomes.length; i++) {
      for (let j = i + 1; j < visualBiomes.length; j++) {
        expect(rgbDistance(visualBiomes[i].ambientColor, visualBiomes[j].ambientColor)).toBeGreaterThanOrEqual(18);
        expect(rgbDistance(visualBiomes[i].accent, visualBiomes[j].accent)).toBeGreaterThanOrEqual(40);
        expect(rgbDistance(visualBiomes[i].bgLayers[0].color, visualBiomes[j].bgLayers[0].color)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('preserves materially distinct visual-biome swatches after final palette quantization', () => {
    const swatches = visualBiomes.map((biome) => ({
      ambientColor: quantizedHex(biome.ambientColor),
      fillMid: quantizedHex(biome.palette.fillMid),
      edge: quantizedHex(biome.palette.edge),
      accent: quantizedHex(biome.accent),
    }));

    expect(new Set(swatches.map((swatch) => JSON.stringify(swatch))).size).toBe(BIOME_IDS.length);
    for (let i = 0; i < swatches.length; i++) {
      for (let j = i + 1; j < swatches.length; j++) {
        expect(rgbDistance(swatches[i].fillMid, swatches[j].fillMid)).toBeGreaterThanOrEqual(20);
      }
    }

    expect(rgbDistance(swatches[0].edge, swatches[3].edge)).toBeGreaterThanOrEqual(12);
    expect(rgbDistance(swatches[1].accent, swatches[3].accent)).toBeGreaterThanOrEqual(12);
  });

  it('keeps background layers valid while retaining towers, decks, and biome-specific haze', () => {
    const signatures = new Set<string>();
    for (const biome of visualBiomes) {
      expect(biome.bgLayers.length).toBeGreaterThanOrEqual(2);
      signatures.add(biome.bgLayers.map((layer) => layer.kind).join(','));
      for (const layer of biome.bgLayers) {
        expect(layer.color).toMatch(/^#[0-9a-f]{6}$/i);
        expect(layer.factor).toBeGreaterThan(0);
        expect(layer.factor).toBeLessThanOrEqual(1);
        expect(layer.density).toBeGreaterThan(0);
        expect(layer.density).toBeLessThanOrEqual(1);
      }
    }
    expect(signatures.size).toBeGreaterThanOrEqual(2);
    expect(visualBiomes.filter((biome) => biome.bgLayers.some((layer) => layer.kind === 'haze'))).toHaveLength(2);

    const layerDensity = (biome: typeof visualBiomes[number], kind: 'tower' | 'deck' | 'haze'): number =>
      biome.bgLayers.find((layer) => layer.kind === kind)?.density ?? 0;
    expect(layerDensity(VISUAL_BIOME.habitation, 'tower')).toBeGreaterThan(layerDensity(VISUAL_BIOME.waterVoid, 'tower'));
    expect(layerDensity(VISUAL_BIOME.habitation, 'deck')).toBeGreaterThan(layerDensity(VISUAL_BIOME.waterVoid, 'deck'));
    expect(layerDensity(VISUAL_BIOME.waterVoid, 'haze')).toBeGreaterThan(layerDensity(VISUAL_BIOME.habitation, 'haze'));
    expect(layerDensity(VISUAL_BIOME.disposal, 'deck')).toBeGreaterThan(layerDensity(VISUAL_BIOME.disposal, 'tower'));
  });
});

describe('mixHex', () => {
  it('mixes black and white at each endpoint and midpoint', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
