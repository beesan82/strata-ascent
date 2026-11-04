import { describe, expect, it } from 'vitest';
import {
  BIOME_BLEND_HALF_WIDTH,
  BIOME_CELL_BASE,
  BIOME_CELL_JITTER,
  BIOME_DISTRICT_NAME,
  BIOME_IDS,
  biomeBoundary,
  biomeCellAt,
  biomeIdForCell,
  districtNameForCell,
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

  it('uses deterministic signed jitter across both sides of zero', () => {
    const jitters = new Set<number>();
    for (const seed of seeds) {
      for (let cell = -100; cell <= 100; cell++) {
        const jitter = biomeBoundary(seed, cell) - cell * BIOME_CELL_BASE;
        expect(Number.isInteger(jitter)).toBe(true);
        expect(jitter).toBeGreaterThanOrEqual(-BIOME_CELL_JITTER);
        expect(jitter).toBeLessThanOrEqual(BIOME_CELL_JITTER);
        jitters.add(jitter);
      }
    }
    expect(Math.min(...jitters)).toBeLessThan(0);
    expect(Math.max(...jitters)).toBeGreaterThan(0);
  });

  it('derives each boundary from that cell\'s direct signed-hash fixture', () => {
    expect([
      biomeBoundary(42, -2),
      biomeBoundary(42, -1),
      biomeBoundary(42, 0),
      biomeBoundary(42, 1),
      biomeBoundary(42, 2),
      biomeBoundary(42, 3),
    ]).toEqual([-715, -348, 2, 409, 744, 1088]);
  });

  it('is deterministic, uses all supported IDs, and never repeats across adjacent cells', () => {
    const selectedIds = new Set<typeof BIOME_IDS[number]>();
    for (const seed of seeds) {
      for (let cell = -100; cell <= 100; cell++) {
        const id = biomeIdForCell(seed, cell);
        expect(BIOME_IDS).toContain(id);
        selectedIds.add(id);
        expect(id).toBe(biomeIdForCell(seed, cell));
        expect(id).not.toBe(biomeIdForCell(seed, cell + 1));
      }
    }
    expect(selectedIds).toEqual(new Set(BIOME_IDS));
  });

  it('fixes cell 0 to coldSteel for every seed', () => {
    for (const seed of seeds) {
      expect(biomeIdForCell(seed, 0)).toBe('coldSteel');
    }
  });

  it('contains every district exactly once per 5-cell cycle', () => {
    for (const seed of seeds) {
      for (let cycle = -20; cycle <= 20; cycle++) {
        const ids = Array.from({ length: 5 }, (_, i) => biomeIdForCell(seed, cycle * 5 + i));
        expect(new Set(ids)).toEqual(new Set(BIOME_IDS));
      }
    }
  });

  it('never repeats a district across a cycle boundary', () => {
    for (const seed of seeds) {
      for (let cycle = -20; cycle < 20; cycle++) {
        expect(biomeIdForCell(seed, cycle * 5 + 4)).not.toBe(biomeIdForCell(seed, (cycle + 1) * 5));
      }
    }
  });

  it('gives every district a Japanese district name', () => {
    expect(BIOME_DISTRICT_NAME).toEqual({
      coldSteel: '寒鋼基層',
      habitation: '居住区画',
      disposal: '廃棄沈殿層',
      waterVoid: '大空洞水域',
      power: '電力区',
    });
    for (const seed of seeds) {
      for (let cell = -20; cell <= 20; cell++) {
        expect(districtNameForCell(seed, cell)).toBe(BIOME_DISTRICT_NAME[biomeIdForCell(seed, cell)]);
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
