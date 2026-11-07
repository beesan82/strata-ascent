import { describe, expect, it } from 'vitest';
import {
  chooseSupplyCaches,
  restStockSecondFor,
  supplyFor,
  supplyTableFor,
} from './supply';
import type { FloorRun, ProtectedPoint, SpawnRect } from './spawn';
import { BIOME_IDS } from './biomeCells';

const SEED = 20260711;

function run(x: number, floorY: number, len = 10): FloorRun {
  return { x, floorY, len };
}

/** いろいろな位置のランをまとめて作る(選定の入力) */
function manyRuns(): FloorRun[] {
  const runs: FloorRun[] = [];
  for (let i = 0; i < 30; i++) runs.push(run(100 + i * 37, 500 - i * 13, 5 + (i % 12)));
  return runs;
}

describe('chooseSupplyCaches(選定)', () => {
  it('決定的: 同じ入力は常に同じ結果', () => {
    const runs = manyRuns();
    const a = chooseSupplyCaches(SEED, runs, [], []);
    const b = chooseSupplyCaches(SEED, runs, [], []);
    expect(a).toEqual(b);
  });

  it('最大 1 件だけ返す', () => {
    expect(chooseSupplyCaches(SEED, manyRuns(), [], []).length).toBeLessThanOrEqual(1);
  });

  it('ランが無ければ空', () => {
    expect(chooseSupplyCaches(SEED, [], [], [])).toEqual([]);
  });

  it('ID は s:${run.x},${run.floorY} の形で、位置はランの内側', () => {
    const runs = manyRuns();
    const [c] = chooseSupplyCaches(SEED, runs, [], []);
    if (c) {
      const src = runs.find((r) => `s:${r.x},${r.floorY}` === c.id);
      expect(src).toBeDefined();
      expect(c.x).toBeGreaterThanOrEqual(src!.x);
      expect(c.x).toBeLessThan(src!.x + src!.len);
      expect(c.floorY).toBe(src!.floorY);
    }
  });

  it('保護範囲内は置かない(当選候補を守ると別の場所が選ばれる)', () => {
    const runs = manyRuns();
    const [c] = chooseSupplyCaches(SEED, runs, [], []);
    expect(c).toBeDefined();
    const guard: ProtectedPoint[] = [{ x: c.x, y: c.floorY, r: 3 }];
    const guarded = chooseSupplyCaches(SEED, runs, guard, []);
    for (const g of guarded) {
      expect(g.id).not.toBe(c.id);
      expect(Math.max(Math.abs(g.x - c.x), Math.abs(g.floorY - c.floorY))).toBeGreaterThan(3);
    }
  });

  it('大広間の中は置かない(当選候補を含む広間を渡すと別の場所が選ばれる)', () => {
    const runs = manyRuns();
    const [c] = chooseSupplyCaches(SEED, runs, [], []);
    expect(c).toBeDefined();
    const hall: SpawnRect = { x0: c.x - 5, x1: c.x + 5, y0: c.floorY - 10, y1: c.floorY + 1 };
    const result = chooseSupplyCaches(SEED, runs, [], [hall]);
    for (const g of result) {
      expect(g.id).not.toBe(c.id);
    }
  });

  it('開封済みは選定後に差し引かれ、別候補が繰り上がらない', () => {
    const runs = manyRuns();
    const [c] = chooseSupplyCaches(SEED, runs, [], []);
    expect(c).toBeDefined();
    // 当選候補を開封済みにすると、次点が繰り上がらず空になる(第2弾 §4 の裁定)
    expect(chooseSupplyCaches(SEED, runs, [], [], new Set([c.id]))).toEqual([]);
  });

  it('短すぎるラン(長さ 4)は適格でない', () => {
    // 長さ 4 のランだけでは選ばれない
    const short = [run(10, 100, 4), run(40, 100, 4), run(80, 100, 4)];
    expect(chooseSupplyCaches(SEED, short, [], [])).toEqual([]);
  });
});

describe('supplyFor(キャッシュの中身)', () => {
  it('決定的: 同じ入力は常に同じ結果', () => {
    for (const b of BIOME_IDS) {
      expect(supplyFor(SEED, 's:100,200', b)).toBe(supplyFor(SEED, 's:100,200', b));
    }
  });

  it('地区表どおりの分布になる(固定 seed・4000 サンプル、±3.5 ポイント)', () => {
    for (const b of BIOME_IDS) {
      const t = supplyTableFor(b);
      const counts = { ration: 0, heal: 0, charge: 0 };
      const n = 4000;
      for (let i = 0; i < n; i++) counts[supplyFor(SEED, `s:${i * 7 + 3},${1000 + i}`, b)]++;
      expect(counts.ration / n).toBeGreaterThan(t.ration - 0.035);
      expect(counts.ration / n).toBeLessThan(t.ration + 0.035);
      expect(counts.heal / n).toBeGreaterThan(t.heal - 0.035);
      expect(counts.heal / n).toBeLessThan(t.heal + 0.035);
      expect(counts.charge / n).toBeGreaterThan(t.charge - 0.035);
      expect(counts.charge / n).toBeLessThan(t.charge + 0.035);
    }
  });

  it('地区表は全地区ぶん合計 1 になる', () => {
    for (const b of BIOME_IDS) {
      const t = supplyTableFor(b);
      expect(t.ration + t.heal + t.charge).toBeCloseTo(1);
    }
  });
});

describe('restStockSecondFor(休憩点備蓄の 2 個目)', () => {
  it('地区で固定: 居住・廃棄は回復、電力・精錬・水域は砲弾、生体は糧食', () => {
    expect(restStockSecondFor(SEED, 'r:0,0', 'habitation')).toBe('heal');
    expect(restStockSecondFor(SEED, 'r:0,0', 'disposal')).toBe('heal');
    expect(restStockSecondFor(SEED, 'r:0,0', 'power')).toBe('charge');
    expect(restStockSecondFor(SEED, 'r:0,0', 'foundry')).toBe('charge');
    expect(restStockSecondFor(SEED, 'r:0,0', 'waterVoid')).toBe('charge');
    expect(restStockSecondFor(SEED, 'r:0,0', 'biomech')).toBe('ration');
  });

  it('寒鋼基層はハッシュで回復／砲弾の両方が出る(決定的)', () => {
    const results = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = `r:${i},${i % 5}`;
      const r = restStockSecondFor(SEED, id, 'coldSteel');
      expect(r).toBe(restStockSecondFor(SEED, id, 'coldSteel'));
      results.add(r);
    }
    expect(results).toEqual(new Set(['heal', 'charge']));
  });
});
