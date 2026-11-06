import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from './tiles';
import { findFloorRuns, chooseSpawns, spawnRateForLayer, findAirPockets, chooseFlyerSpawns, flyerMulFor } from './spawn';
import { BIOME_IDS } from './biomeCells';

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

  it('地区倍率 rateMul は出現率に乗る(0 で消え、既定 1 は従来と同じ)', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    expect(chooseSpawns(999, 4, runs, [], 0)).toHaveLength(0);
    expect(chooseSpawns(999, 4, runs, [], 1)).toEqual(chooseSpawns(999, 4, runs, []));
  });

  it('撃破済み(defeated)のスポーンは除外される(第2弾 §4 の記録保持)', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    const base = chooseSpawns(123, 5, runs, []);
    expect(base.length).toBeGreaterThan(0);
    const killed = new Set([base[0].id]);
    const filtered = chooseSpawns(123, 5, runs, [], 1, killed);
    expect(filtered.some((s) => s.id === base[0].id)).toBe(false);
    // 残りのスポーンは撃破済み以外から出る
    expect(filtered.every((s) => !killed.has(s.id))).toBe(true);
    // 全て撃破済みなら何も出ない
    const all = new Set(base.map((s) => s.id));
    expect(chooseSpawns(123, 5, runs, [], 1, all)).toHaveLength(0);
  });

  it('defeated が空集合・省略なら従来と同一の結果になる', () => {
    const runs = findFloorRuns(world, 0, 0, 40, 20);
    expect(chooseSpawns(999, 4, runs, [], 1, new Set())).toEqual(chooseSpawns(999, 4, runs, []));
    expect(chooseSpawns(999, 4, runs, [], 1, undefined)).toEqual(chooseSpawns(999, 4, runs, []));
  });

  it('地区倍率を上げると出現が単調に増える', () => {
    // 長さ 20 の床を 60 間隔で並べ、倍率 0.7 / 1.0 / 1.3 で数える(密度上限に当たらない間隔)
    const segments = (tx: number, ty: number): Tile =>
      ty === 10 && tx >= 0 && tx < 6000 && tx % 60 < 20 ? TILE.SOLID : TILE.AIR;
    const runs = findFloorRuns(segments, 0, 0, 6000, 20);
    expect(runs.length).toBe(100);
    const counts = [0.7, 1.0, 1.3].map((mul) => chooseSpawns(7, 30, runs, [], mul).length);
    expect(counts[0]).toBeLessThan(counts[1]);
    expect(counts[1]).toBeLessThan(counts[2]);
  });
});

/** 全面が空気(飛行敵のポケットが全面に取れる) */
const openSky = (): Tile => TILE.AIR;
/** 横 4 タイルしか空いていない細い縦穴(5 幅のポケットは入らない) */
const narrowShaft = (tx: number, ty: number): Tile =>
  tx >= 10 && tx < 14 && ty >= 0 && ty < 30 ? TILE.AIR : TILE.SOLID;
/** 高さ 3 しか空いていない低い空間(4 高のポケットは入らない) */
const lowSpace = (tx: number, ty: number): Tile =>
  tx >= 0 && tx < 40 && ty >= 10 && ty < 13 ? TILE.AIR : TILE.SOLID;

describe('findAirPockets', () => {
  it('5 幅 × 4 高の AIR 矩形が収まる左上を列挙する', () => {
    const pockets = findAirPockets(openSky, 0, 0, 20, 12);
    expect(pockets.length).toBeGreaterThan(0);
    expect(pockets[0]).toEqual({ x: 0, y: 0 });
    // 左上は範囲内に 5×4 が収まる位置だけ
    expect(pockets.every((p) => p.x + 5 <= 20 && p.y + 4 <= 12)).toBe(true);
  });

  it('幅 5・高さ 4 に満たない空間にはポケットが取れない', () => {
    expect(findAirPockets(narrowShaft, 0, 0, 40, 30)).toHaveLength(0);
    expect(findAirPockets(lowSpace, 0, 0, 40, 30)).toHaveLength(0);
  });

  it('固体だらけの世界ではポケットは無い', () => {
    const solid = (): Tile => TILE.SOLID;
    expect(findAirPockets(solid, 0, 0, 40, 30)).toHaveLength(0);
  });
});

describe('chooseFlyerSpawns / flyerMulFor', () => {
  const pockets = findAirPockets(openSky, 0, 0, 80, 40);

  it('地区ゲートは大空洞水域のみ 1.0、他地区は 0(第2弾 段階 1)', () => {
    expect(flyerMulFor('waterVoid')).toBe(1);
    for (const id of BIOME_IDS) {
      if (id !== 'waterVoid') expect(flyerMulFor(id)).toBe(0);
    }
  });

  it('大空洞水域では出現し、他地区では一切出ない', () => {
    expect(chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', []).length).toBeGreaterThan(0);
    for (const id of BIOME_IDS) {
      if (id !== 'waterVoid') {
        expect(chooseFlyerSpawns(55, 5, pockets, [], id, [])).toHaveLength(0);
      }
    }
  });

  it('第 0 層では出ない(Walker と基礎率を共有)', () => {
    expect(chooseFlyerSpawns(55, 0, pockets, [], 'waterVoid', [])).toHaveLength(0);
  });

  it('ID は f: 接頭辞で、同じ入力では同じ結果になる(決定論)', () => {
    const a = chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', []);
    const b = chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', []);
    expect(a).toEqual(b);
    expect(a.every((s) => s.id.startsWith('f:'))).toBe(true);
  });

  it('撃破済み(defeated)は除外される', () => {
    const base = chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', []);
    expect(base.length).toBeGreaterThan(0);
    const all = new Set(base.map((s) => s.id));
    expect(chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', [], all)).toHaveLength(0);
    const one = new Set([base[0].id]);
    const filtered = chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', [], one);
    expect(filtered.some((s) => s.id === base[0].id)).toBe(false);
  });

  it('大広間の矩形と重なるポケットからは出ない', () => {
    const everywhere = [{ x0: -100, x1: 200, y0: -100, y1: 200 }];
    expect(chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', everywhere)).toHaveLength(0);
    // 広間が遠ければ影響しない
    const far = [{ x0: 500, x1: 700, y0: 500, y1: 700 }];
    expect(chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', far).length).toBeGreaterThan(0);
  });

  it('保護点の近傍には出ない', () => {
    const base = chooseFlyerSpawns(55, 5, pockets, [], 'waterVoid', []);
    expect(base.length).toBeGreaterThan(0);
    const blocked = chooseFlyerSpawns(55, 5, pockets,
      base.map((s) => ({ x: s.x, y: s.y, r: 40 })), 'waterVoid', []);
    expect(blocked).toHaveLength(0);
  });
});
