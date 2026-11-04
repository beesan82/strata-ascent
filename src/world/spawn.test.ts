import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from './tiles';
import { findFloorRuns, chooseSpawns, spawnRateForLayer } from './spawn';

/** y=10 行が床。x が 0..19 で連続し、x=24..30 にも短い床 */
const world = (tx: number, ty: number): Tile => {
  if (ty === 10 && tx >= 0 && tx < 20) return TILE.SOLID;
  if (ty === 10 && tx >= 24 && tx < 31) return TILE.SOLID;
  return TILE.AIR;
};
/** ランの上に天井(頭上 1 タイル)がある世界 */
const lowCeiling = (tx: number, ty: number): Tile => {
  if (ty === 10 && tx >= 0 && tx < 20) return TILE.SOLID;
  if (ty === 9 && tx >= 0 && tx < 20) return TILE.SOLID;
  return TILE.AIR;
};
/** 床の上に梯子が立つ世界(梯子列はランに含めない) */
const ladderWorld = (tx: number, ty: number): Tile => {
  if (ty === 10 && tx >= 0 && tx < 20) return TILE.SOLID;
  if (tx === 5 && ty < 10) return TILE.LADDER;
  return TILE.AIR;
};

describe('findFloorRuns', () => {
  it('頭上が空いた平坦な床のランを拾う', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    expect(runs.length).toBe(2);
    expect(runs[0]).toMatchObject({ floorY: 10, len: 20 });
    expect(runs[1]).toMatchObject({ floorY: 10, len: 7 });
  });

  it('頭上 2 タイルに天井がある床行は含めない(天井の上は別の床として拾ってよい)', () => {
    const runs = findFloorRuns(lowCeiling, 0, 0, 40, 20);
    expect(runs.every((r) => r.floorY !== 10)).toBe(true);
  });

  it('梯子が立つ列でランが切れる', () => {
    const runs = findFloorRuns(ladderWorld, 0, 0, 40, 20);
    // 梯子列(x=5)の前後で 2 本に分かれる想定だが、仕様上「頭上が梯子」は不一致で切れる
    expect(runs.every((r) => !(r.x <= 5 && 5 < r.x + r.len))).toBe(true);
  });

  it('短いラン(5 未満)は拾わない', () => {
    const short = (tx: number, ty: number): Tile => (ty === 10 && tx >= 0 && tx < 4 ? TILE.SOLID : TILE.AIR);
    expect(findFloorRuns(short, 0, 0, 40, 20)).toHaveLength(0);
  });
});

describe('chooseSpawns / spawnRateForLayer', () => {
  it('第 0 層は出現率 0 で、層が進むと上がり上限がある', () => {
    expect(spawnRateForLayer(0)).toBe(0);
    expect(spawnRateForLayer(1)).toBeGreaterThan(0);
    expect(spawnRateForLayer(50)).toBeLessThanOrEqual(0.7);
  });

  it('第 0 層では何も選ばれない', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    expect(chooseSpawns(123, 0, runs, [])).toHaveLength(0);
  });

  it('保護点の近傍には出さない', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    const all = chooseSpawns(123, 5, runs, []);
    const guarded = chooseSpawns(123, 5, runs, all.map((s) => ({ x: s.x, y: s.y, r: 40 })));
    expect(guarded).toHaveLength(0);
  });

  it('同じシードでは同じ結果になる(決定論)', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    expect(chooseSpawns(999, 4, runs, [])).toEqual(chooseSpawns(999, 4, runs, []));
  });
});
