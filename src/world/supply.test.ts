import { describe, expect, it } from 'vitest';
import {
  ARMORY_CONTENTS,
  ARMORY_MUL,
  ARMORY_THRESHOLD,
  chooseArmories,
  chooseSupplyCaches,
  REST_STOCK_SHELL_RATE,
  restStockSecondFor,
  SUPPLY_MATERIAL_RATE,
  supplyFor,
  supplyTableFor,
} from './supply';
import type { FloorRun, ProtectedPoint, SpawnRect } from './spawn';
import type { DropKind } from '../entities/drop';
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
      const counts: Record<DropKind, number> = { ration: 0, heal: 0, charge: 0, material: 0, pulsecell: 0 };
      const n = 4000;
      for (let i = 0; i < n; i++) counts[supplyFor(SEED, `s:${i * 7 + 3},${1000 + i}`, b)]++;
      expect(counts.ration / n).toBeGreaterThan(t.ration - 0.035);
      expect(counts.ration / n).toBeLessThan(t.ration + 0.035);
      expect(counts.heal / n).toBeGreaterThan(t.heal - 0.035);
      expect(counts.heal / n).toBeLessThan(t.heal + 0.035);
      expect(counts.charge / n).toBeGreaterThan(t.charge - 0.035);
      expect(counts.charge / n).toBeLessThan(t.charge + 0.035);
      expect(counts.material / n).toBeGreaterThan(t.material - 0.035);
      expect(counts.material / n).toBeLessThan(t.material + 0.035);
    }
  });

  it('地区表は全地区ぶん合計 1 になる', () => {
    for (const b of BIOME_IDS) {
      const t = supplyTableFor(b);
      expect(t.ration + t.heal + t.charge + t.material).toBeCloseTo(1);
    }
  });

  it('素材(段階 A)は全地区 20% で、消耗品 3 種は残り 80% を従来の地区別比率で分け合う', () => {
    expect(SUPPLY_MATERIAL_RATE).toBe(0.2);
    for (const b of BIOME_IDS) {
      const t = supplyTableFor(b);
      expect(t.material).toBe(SUPPLY_MATERIAL_RATE);
      expect(t.ration + t.heal + t.charge).toBeCloseTo(1 - SUPPLY_MATERIAL_RATE);
    }
    // 寒鋼基層の消耗品比率 0.5 : 0.25 : 0.25 はそのまま(×0.8)
    const cold = supplyTableFor('coldSteel');
    expect(cold.ration).toBeCloseTo(0.4);
    expect(cold.heal).toBeCloseTo(0.2);
    expect(cold.charge).toBeCloseTo(0.2);
    // 居住区画は糧食 0.55 → 0.44、回復 0.35 → 0.28、砲弾 0.1 → 0.08
    const hab = supplyTableFor('habitation');
    expect(hab.ration).toBeCloseTo(0.44);
    expect(hab.heal).toBeCloseTo(0.28);
    expect(hab.charge).toBeCloseTo(0.08);
  });

  it('素材は全地区のキャッシュから出る(決定的)', () => {
    for (const b of BIOME_IDS) {
      let found = false;
      for (let i = 0; i < 200 && !found; i++) {
        found = supplyFor(SEED, `s:${i * 7 + 3},${1000 + i}`, b) === 'material';
      }
      expect(found).toBe(true);
    }
  });
});

describe('restStockSecondFor(休憩点備蓄の 2 個目 = 弾薬)', () => {
  it('全地区で砲弾かパルス弾セルのどちらかになり、決定的(弾薬設計 §3)', () => {
    for (const b of BIOME_IDS) {
      const results = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const id = `r:${i},${i % 5}`;
        const r = restStockSecondFor(SEED, id, b);
        expect(r === 'charge' || r === 'pulsecell').toBe(true);
        expect(r).toBe(restStockSecondFor(SEED, id, b));
        results.add(r);
      }
      // どの地区でも両方が出る(どちらか一方に固定されない)
      expect(results).toEqual(new Set(['charge', 'pulsecell']));
    }
  });

  it('砲弾率は地区表どおり(電力・精錬・水域は砲弾寄り、居住・生体はセル寄り。2000 サンプル ±4 ポイント)', () => {
    expect(REST_STOCK_SHELL_RATE.power).toBe(0.6);
    expect(REST_STOCK_SHELL_RATE.foundry).toBe(0.6);
    expect(REST_STOCK_SHELL_RATE.waterVoid).toBe(0.6);
    expect(REST_STOCK_SHELL_RATE.habitation).toBe(0.3);
    expect(REST_STOCK_SHELL_RATE.biomech).toBe(0.3);
    for (const b of BIOME_IDS) {
      let shells = 0;
      const n = 2000;
      for (let i = 0; i < n; i++) if (restStockSecondFor(SEED, `r:${i * 3},${i % 7}`, b) === 'charge') shells++;
      expect(shells / n).toBeGreaterThan(REST_STOCK_SHELL_RATE[b] - 0.04);
      expect(shells / n).toBeLessThan(REST_STOCK_SHELL_RATE[b] + 0.04);
    }
  });
});

describe('chooseArmories(武器庫の選定、弾薬設計 §2)', () => {
  it('決定的: 同じ入力は常に同じ結果で、同じシードなら同じ場所に出る', () => {
    const runs = manyRuns();
    const a = chooseArmories(SEED, runs, [], [], 'power');
    const b = chooseArmories(SEED, runs, [], [], 'power');
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(1);
  });

  it('ID は a:${run.x},${run.floorY} の形で、位置はランの内側', () => {
    const runs = manyRuns();
    const [c] = chooseArmories(SEED, runs, [], [], 'power');
    if (c) {
      expect(c.id.startsWith('a:')).toBe(true);
      const src = runs.find((r) => `a:${r.x},${r.floorY}` === c.id);
      expect(src).toBeDefined();
      expect(c.x).toBeGreaterThanOrEqual(src!.x);
      expect(c.x).toBeLessThan(src!.x + src!.len);
      expect(c.floorY).toBe(src!.floorY);
    }
  });

  it('ランが無ければ空。短すぎるラン(長さ 4)は適格でない', () => {
    expect(chooseArmories(SEED, [], [], [], 'power')).toEqual([]);
    const short = [run(10, 100, 4), run(40, 100, 4), run(80, 100, 4)];
    expect(chooseArmories(SEED, short, [], [], 'power')).toEqual([]);
  });

  it('密度は地区で変わる: 多数の窓で数えると電力区 > 寒鋼基層 > 水域(倍率表 1.6 / 1.0 / 0.5)', () => {
    expect(ARMORY_THRESHOLD).toBe(0.3);
    expect(ARMORY_MUL.power).toBe(1.6);
    expect(ARMORY_MUL.foundry).toBe(1.6);
    expect(ARMORY_MUL.coldSteel).toBe(1.0);
    expect(ARMORY_MUL.waterVoid).toBe(0.5);
    expect(ARMORY_MUL.biomech).toBe(0.5);
    const count = (biome: 'power' | 'coldSteel' | 'waterVoid'): number => {
      let n = 0;
      for (let w = 0; w < 300; w++) {
        // 窓ごとに 6 本のラン(ハッシュは run.x / floorY で引くので窓ごとに違う結果になる)
        const runs = [];
        for (let i = 0; i < 6; i++) runs.push(run(1000 + w * 97 + i * 13, 300 + w * 5 - i * 7, 8));
        n += chooseArmories(SEED, runs, [], [], biome).length;
      }
      return n;
    };
    const power = count('power');
    const cold = count('coldSteel');
    const water = count('waterVoid');
    expect(power).toBeGreaterThan(cold);
    expect(cold).toBeGreaterThan(water);
    expect(water).toBeGreaterThan(0); // 薄いだけで無くはならない
  });

  it('保護範囲内と大広間の中は置かない(キャッシュと同じ除外)', () => {
    const runs = manyRuns();
    const [c] = chooseArmories(SEED, runs, [], [], 'power');
    expect(c).toBeDefined();
    const guard: ProtectedPoint[] = [{ x: c.x, y: c.floorY, r: 3 }];
    for (const g of chooseArmories(SEED, runs, guard, [], 'power')) {
      expect(g.id).not.toBe(c.id);
    }
    const hall: SpawnRect = { x0: c.x - 5, x1: c.x + 5, y0: c.floorY - 10, y1: c.floorY + 1 };
    for (const g of chooseArmories(SEED, runs, [], [hall], 'power')) {
      expect(g.id).not.toBe(c.id);
    }
  });

  it('開封済みは選定後に差し引かれ、別候補が繰り上がらない', () => {
    const runs = manyRuns();
    const [c] = chooseArmories(SEED, runs, [], [], 'power');
    expect(c).toBeDefined();
    expect(chooseArmories(SEED, runs, [], [], 'power', new Set([c.id]))).toEqual([]);
  });

  it('通常キャッシュとは別の塩で選ぶので、同じ入力でも当選ランは一般に異なる(ID の接頭辞も違う)', () => {
    const runs = manyRuns();
    const [cache] = chooseSupplyCaches(SEED, runs, [], []);
    const [armory] = chooseArmories(SEED, runs, [], [], 'power');
    expect(cache).toBeDefined();
    expect(armory).toBeDefined();
    expect(cache.id.startsWith('s:')).toBe(true);
    expect(armory.id.startsWith('a:')).toBe(true);
  });

  it('開封の中身は砲弾 1 ＋ パルス弾セル 2 の計 3 個', () => {
    expect(ARMORY_CONTENTS).toHaveLength(3);
    expect(ARMORY_CONTENTS.filter((k) => k === 'charge')).toHaveLength(1);
    expect(ARMORY_CONTENTS.filter((k) => k === 'pulsecell')).toHaveLength(2);
  });
});
