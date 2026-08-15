import { describe, expect, it } from 'vitest';
import {
  BIOME_BLEND_HALF_WIDTH,
  BIOME_CELL_BASE,
  BIOME_CELL_JITTER,
  BIOME_IDS,
  biomeBoundary,
  biomeCellAt,
  biomeIdForCell,
} from './biomeCells';

describe('biome cells', () => {
  const seeds = [1, 42, 20260711];

  it('uses the short shared cell and blend constants', () => {
    expect(BIOME_CELL_BASE).toBe(375);
    expect(BIOME_CELL_JITTER).toBe(75);
    expect(BIOME_BLEND_HALF_WIDTH).toBe(50);
    expect(BIOME_IDS).toEqual(['coldSteel', 'habitation', 'disposal', 'waterVoid', 'power']);
  });

  it('keeps every sampled cell width between 300 and 450 tiles', () => {
    for (const seed of seeds) {
      for (let cell = -100; cell <= 100; cell++) {
        const width = biomeBoundary(seed, cell + 1) - biomeBoundary(seed, cell);
        expect(width).toBeGreaterThanOrEqual(300);
        expect(width).toBeLessThanOrEqual(450);
      }
    }
  });

  it('is deterministic, uses all supported IDs, and never repeats across adjacent cells', () => {
    for (const seed of seeds) {
      for (let cell = -100; cell <= 100; cell++) {
        const id = biomeIdForCell(seed, cell);
        expect(BIOME_IDS).toContain(id);
        expect(id).toBe(biomeIdForCell(seed, cell));
        expect(id).not.toBe(biomeIdForCell(seed, cell + 1));
      }
    }
  });

  it('keeps positive and negative 20-cell ID sequences independent', () => {
    for (const seed of seeds) {
      const positive = Array.from({ length: 20 }, (_, i) => biomeIdForCell(seed, i + 1));
      const negative = Array.from({ length: 20 }, (_, i) => biomeIdForCell(seed, -(i + 1)));
      expect(positive).not.toEqual(negative);
    }
  });

  it('assigns the tile before each sampled boundary to the prior cell and the boundary to its cell', () => {
    for (const seed of seeds) {
      for (let cell = -100; cell <= 100; cell++) {
        const edge = biomeBoundary(seed, cell);
        expect(biomeCellAt(seed, edge - 1)).toBe(cell - 1);
        expect(biomeCellAt(seed, edge)).toBe(cell);
      }
    }
  });
});
