import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE } from '../world/tiles';
import { regionAt } from '../world/hierarchy';
import { biomeBoundary } from './biome';
import { chunkVisualAt } from './chunkbake';

const centerY = (cy: number): number => cy * CHUNK_SIZE + CHUNK_SIZE / 2;
const chunkContainingCenter = (worldY: number): number =>
  Math.floor((worldY - CHUNK_SIZE / 2) / CHUNK_SIZE);

describe('chunk visual biome selection', () => {
  it('changes tile palette between visual cells inside one facility region', () => {
    const seed = 42;
    const edge = biomeBoundary(seed, 2);
    const beforeCy = chunkContainingCenter((biomeBoundary(seed, 1) + edge) / 2);
    const afterCy = chunkContainingCenter((edge + biomeBoundary(seed, 3)) / 2);

    expect(regionAt(seed, 0, centerY(beforeCy)).system).toBe(
      regionAt(seed, 0, centerY(afterCy)).system,
    );

    const before = chunkVisualAt(seed, 0, beforeCy);
    const after = chunkVisualAt(seed, 0, afterCy);
    expect(before.from).toBe(before.to);
    expect(after.from).toBe(after.to);
    expect(before.from).not.toBe(after.from);
    expect(before.palette).not.toEqual(after.palette);
  });

  it('advances a bounded palette blend across chunk centers near a visual boundary', () => {
    const seed = 42;
    const edge = biomeBoundary(seed, 2);
    const before = chunkVisualAt(seed, 0, chunkContainingCenter(edge - 32));
    const after = chunkVisualAt(seed, 0, chunkContainingCenter(edge + 32));

    expect(before.from).toBe(after.from);
    expect(before.to).toBe(after.to);
    expect(before.t).toBeGreaterThan(0);
    expect(after.t).toBeLessThan(1);
    expect(before.t).toBeLessThan(after.t);
    expect(before.palette.fillMid).not.toBe(after.palette.fillMid);
    expect(before.cacheKey).not.toBe(after.cacheKey);
  });
});
