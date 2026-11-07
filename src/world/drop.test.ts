import { describe, expect, it } from 'vitest';
import { dropFor, dropProfileFor, dropRatesFor, DROP_TOTAL_CAP, type DropKind } from './drop';
import { BIOME_IDS, type BiomeId } from './biomeCells';

const SEED = 20260711;

/** 固定 seed で多数のスポーン ID を振り、ドロップ種別の割合を数える */
function distribution(
  kind: 'w' | 'f',
  biomeId: BiomeId,
  n = 4000,
): Record<'charge' | 'heal' | 'ration' | 'none', number> {
  const counts = { charge: 0, heal: 0, ration: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const r: DropKind | null = dropFor(SEED, `${kind}:${i * 3 + 11},${500 + i}`, 0, biomeId);
    if (r === 'charge') counts.charge++;
    else if (r === 'heal') counts.heal++;
    else if (r === 'ration') counts.ration++;
    else counts.none++;
  }
  return {
    charge: counts.charge / n,
    heal: counts.heal / n,
    ration: counts.ration / n,
    none: counts.none / n,
  };
}

/** 設計の許容幅(固定 seed・4000 サンプルで理論値 ±3.5 ポイント以内) */
function near(actual: number, expected: number): void {
  expect(actual).toBeGreaterThan(expected - 0.035);
  expect(actual).toBeLessThan(expected + 0.035);
}

describe('dropProfileFor(地区倍率表)', () => {
  it('砲弾・回復は第2弾 §3、糧食はサバイバル設計 §5 の倍率表どおりである(全 7 地区)', () => {
    expect(dropProfileFor('coldSteel')).toEqual({ charge: 1.0, heal: 1.0, ration: 1.0 });
    expect(dropProfileFor('habitation')).toEqual({ charge: 1.0, heal: 1.5, ration: 1.6 });
    expect(dropProfileFor('disposal')).toEqual({ charge: 1.0, heal: 1.0, ration: 0.7 });
    expect(dropProfileFor('waterVoid')).toEqual({ charge: 1.3, heal: 1.0, ration: 0.8 });
    expect(dropProfileFor('power')).toEqual({ charge: 1.0, heal: 1.0, ration: 0.9 });
    expect(dropProfileFor('foundry')).toEqual({ charge: 2.0, heal: 1.0, ration: 0.8 });
    expect(dropProfileFor('biomech')).toEqual({ charge: 1.2, heal: 1.2, ration: 1.3 });
  });

  it('全地区ぶん定義されている', () => {
    for (const id of BIOME_IDS) {
      const p = dropProfileFor(id);
      expect(p.charge).toBeGreaterThan(0);
      expect(p.heal).toBeGreaterThan(0);
      expect(p.ration).toBeGreaterThan(0);
    }
  });
});

describe('dropRatesFor(重み方式の実効確率)', () => {
  it('倍率 1.0 の地区では基礎確率そのもの(Walker 22/12/16、合計 50%)', () => {
    const r = dropRatesFor('w', 'coldSteel');
    expect(r.charge).toBeCloseTo(0.22);
    expect(r.heal).toBeCloseTo(0.12);
    expect(r.ration).toBeCloseTo(0.16);
    const f = dropRatesFor('f', 'coldSteel');
    expect(f.charge).toBeCloseTo(0.27);
    expect(f.heal).toBeCloseTo(0.12);
    expect(f.ration).toBeCloseTo(0.11);
  });

  it('重みの合計が 62% を超える地区では全体が 62% へ圧縮される(精錬区 Walker)', () => {
    const r = dropRatesFor('w', 'foundry');
    expect(r.charge + r.heal + r.ration).toBeCloseTo(DROP_TOTAL_CAP);
    // 圧縮後も比率は重みの比を保つ(0.44 : 0.12 : 0.128)
    expect(r.charge).toBeCloseTo(0.44 * (0.62 / 0.688), 6);
    expect(r.ration).toBeCloseTo(0.128 * (0.62 / 0.688), 6);
  });

  it('合計が上限以下の地区では圧縮されない(生体異物区 Walker は 61.6%)', () => {
    const r = dropRatesFor('w', 'biomech');
    expect(r.charge + r.heal + r.ration).toBeCloseTo(0.616);
    expect(r.charge).toBeCloseTo(0.264);
  });
});

describe('dropFor(抽選の純関数)', () => {
  it('決定的: 同じ入力は常に同じ結果', () => {
    for (const biome of BIOME_IDS) {
      for (let k = 0; k < 20; k++) {
        const a = dropFor(SEED, 'w:123,456', k, biome);
        const b = dropFor(SEED, 'w:123,456', k, biome);
        expect(a).toBe(b);
      }
    }
  });

  it('Walker・倍率 1.0 の地区では砲弾≈22% / 回復≈12% / 糧食≈16%', () => {
    const d = distribution('w', 'coldSteel');
    near(d.charge, 0.22);
    near(d.heal, 0.12);
    near(d.ration, 0.16);
    near(d.charge + d.heal + d.ration, 0.5);
  });

  it('飛行敵・倍率 1.0 の地区では砲弾≈27% / 回復≈12% / 糧食≈11%', () => {
    const d = distribution('f', 'coldSteel');
    near(d.charge, 0.27);
    near(d.heal, 0.12);
    near(d.ration, 0.11);
  });

  it('精錬区では重み圧縮のうえで砲弾が最も多い(Walker 圧縮後≈39.7%)', () => {
    const d = distribution('w', 'foundry');
    near(d.charge, 0.44 * (0.62 / 0.688));
    near(d.heal, 0.12 * (0.62 / 0.688));
    near(d.ration, 0.128 * (0.62 / 0.688));
    near(d.charge + d.heal + d.ration, 0.62);
  });

  it('居住区画では糧食が最も多くなる(Walker 圧縮後 糧食≈24.2% / 回復≈17.0%)', () => {
    const d = distribution('w', 'habitation');
    near(d.charge, 0.22 * (0.62 / 0.656));
    near(d.heal, 0.18 * (0.62 / 0.656));
    near(d.ration, 0.256 * (0.62 / 0.656));
    expect(d.ration).toBeGreaterThan(d.charge);
    expect(d.ration).toBeGreaterThan(d.heal);
  });

  it('大空洞水域では砲弾が ×1.3、糧食は ×0.8(Walker≈28.6% / 12.8%)', () => {
    const d = distribution('w', 'waterVoid');
    near(d.charge, 0.286);
    near(d.heal, 0.12);
    near(d.ration, 0.128);
  });

  it('廃棄沈殿層では糧食が ×0.7 に下がる(Walker≈11.2%)', () => {
    const d = distribution('w', 'disposal');
    near(d.ration, 0.112);
    near(d.charge, 0.22);
  });

  it('生体異物区では糧食が ×1.3 に上がる(Walker≈20.8%)', () => {
    const d = distribution('w', 'biomech');
    near(d.charge, 0.264);
    near(d.heal, 0.144);
    near(d.ration, 0.208);
  });

  it('killIndex が変われば結果も変わる(全て同一にはならない)', () => {
    const results = new Set<string>();
    for (let k = 0; k < 100; k++) {
      results.add(String(dropFor(SEED, 'w:77,888', k, 'coldSteel')));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('seed が変われば結果も変わる(全て同一にはならない)', () => {
    const results = new Set<string>();
    for (let s = 0; s < 100; s++) {
      results.add(String(dropFor(s * 7919 + 1, 'f:77,888', 3, 'waterVoid')));
    }
    expect(results.size).toBeGreaterThan(1);
  });

  it('ボス ID など対象外の接頭辞は常に null(ボスの確定ドロップは別経路)', () => {
    for (let k = 0; k < 50; k++) {
      expect(dropFor(SEED, 'b:12', k, 'coldSteel')).toBeNull();
      expect(dropFor(SEED, 'x:1,2', k, 'coldSteel')).toBeNull();
    }
  });

  it('結果は最大 1 個: 戻り値は 3 種か null のいずれか単一', () => {
    for (let i = 0; i < 200; i++) {
      const r = dropFor(SEED, `w:${i},${i * 2}`, i, 'foundry');
      expect(r === 'charge' || r === 'heal' || r === 'ration' || r === null).toBe(true);
    }
  });
});
