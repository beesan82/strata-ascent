import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import {
  sampleOpenness,
  targetZoomForOpenness,
  MIN_ZOOM,
  MAX_ZOOM,
  OPENNESS_LO,
  OPENNESS_HI,
} from './zoom';

describe('sampleOpenness', () => {
  it('全AIRなら開放度1', () => {
    const openness = sampleOpenness(() => TILE.AIR, 0, 0, 5, 1);
    expect(openness).toBe(1);
  });

  it('全SOLIDなら開放度0', () => {
    const openness = sampleOpenness(() => TILE.SOLID, 0, 0, 5, 1);
    expect(openness).toBe(0);
  });

  it('LADDERは開放とみなす', () => {
    const openness = sampleOpenness(() => TILE.LADDER, 0, 0, 5, 1);
    expect(openness).toBe(1);
  });

  it('市松模様なら約0.5', () => {
    const tileAt = (x: number, y: number) => ((x + y) % 2 === 0 ? TILE.SOLID : TILE.AIR);
    const openness = sampleOpenness(tileAt, 0, 0, 10, 1);
    expect(openness).toBeGreaterThan(0.4);
    expect(openness).toBeLessThan(0.6);
  });
});

describe('targetZoomForOpenness', () => {
  it('閉塞(LO以下)は標準ズーム', () => {
    expect(targetZoomForOpenness(OPENNESS_LO)).toBeCloseTo(MAX_ZOOM, 5);
    expect(targetZoomForOpenness(0)).toBeCloseTo(MAX_ZOOM, 5);
  });

  it('十分開放(HI以上)は最大ズームアウト', () => {
    expect(targetZoomForOpenness(OPENNESS_HI)).toBeCloseTo(MIN_ZOOM, 5);
    expect(targetZoomForOpenness(1)).toBeCloseTo(MIN_ZOOM, 5);
  });

  it('開放度が上がるほどズームは単調に小さくなる', () => {
    const a = targetZoomForOpenness(0.6);
    const b = targetZoomForOpenness(0.75);
    const c = targetZoomForOpenness(0.85);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });

  it('範囲外入力でも[MIN_ZOOM, MAX_ZOOM]にクランプ', () => {
    expect(targetZoomForOpenness(-5)).toBe(MAX_ZOOM);
    expect(targetZoomForOpenness(5)).toBe(MIN_ZOOM);
  });
});
