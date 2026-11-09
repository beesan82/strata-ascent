import { describe, expect, it } from 'vitest';
import { dropFor, dropProfileFor, dropRatesFor, DROP_TOTAL_CAP, type EnemyDropKind } from './drop';
import { BIOME_IDS, type BiomeId } from './biomeCells';

const SEED = 20260711;

/** 固定 seed で多数のスポーン ID を振り、ドロップ種別の割合を数える */
function distribution(
  kind: 'w' | 'f' | 't',
  biomeId: BiomeId,
  n = 4000,
): Record<'heal' | 'ration' | 'material' | 'none', number> {
  const counts = { heal: 0, ration: 0, material: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const r: EnemyDropKind | null = dropFor(SEED, `${kind}:${i * 3 + 11},${500 + i}`, 0, biomeId);
    if (r === 'heal') counts.heal++;
    else if (r === 'ration') counts.ration++;
    else if (r === 'material') counts.material++;
    else counts.none++;
  }
  return {
    heal: counts.heal / n,
    ration: counts.ration / n,
    material: counts.material / n,
    none: counts.none / n,
  };
}

/** 設計の許容幅(固定 seed・4000 サンプルで理論値 ±3.5 ポイント以内) */
function near(actual: number, expected: number): void {
  expect(actual).toBeGreaterThan(expected - 0.035);
  expect(actual).toBeLessThan(expected + 0.035);
}

describe('dropProfileFor(地区倍率表)', () => {
  it('回復は第2弾 §3、糧食はサバイバル設計 §5 の倍率表どおり、素材は全地区 ×1.0。砲弾の倍率は無い', () => {
    expect(dropProfileFor('coldSteel')).toEqual({ heal: 1.0, ration: 1.0, material: 1.0 });
    expect(dropProfileFor('habitation')).toEqual({ heal: 1.5, ration: 1.6, material: 1.0 });
    expect(dropProfileFor('disposal')).toEqual({ heal: 1.0, ration: 0.7, material: 1.0 });
    expect(dropProfileFor('waterVoid')).toEqual({ heal: 1.0, ration: 0.8, material: 1.0 });
    expect(dropProfileFor('power')).toEqual({ heal: 1.0, ration: 0.9, material: 1.0 });
    expect(dropProfileFor('foundry')).toEqual({ heal: 1.0, ration: 0.8, material: 1.0 });
    expect(dropProfileFor('biomech')).toEqual({ heal: 1.2, ration: 1.3, material: 1.0 });
  });

  it('全地区ぶん定義されている', () => {
    for (const id of BIOME_IDS) {
      const p = dropProfileFor(id);
      expect(p.heal).toBeGreaterThan(0);
      expect(p.ration).toBeGreaterThan(0);
      expect(p.material).toBeGreaterThan(0);
    }
  });
});

describe('dropRatesFor(重み方式の実効確率)', () => {
  it('倍率 1.0 の地区では基礎確率そのもの(Walker 12/16/8、合計 36%)', () => {
    const r = dropRatesFor('w', 'coldSteel');
    expect(r.heal).toBeCloseTo(0.12);
    expect(r.ration).toBeCloseTo(0.16);
    expect(r.material).toBeCloseTo(0.08);
    const f = dropRatesFor('f', 'coldSteel');
    expect(f.heal).toBeCloseTo(0.12);
    expect(f.ration).toBeCloseTo(0.11);
    expect(f.material).toBeCloseTo(0.08);
    const t = dropRatesFor('t', 'coldSteel');
    expect(t.heal).toBeCloseTo(0.1);
    expect(t.ration).toBeCloseTo(0.1);
    expect(t.material).toBeCloseTo(0.08);
  });

  it('砲弾を外した後は全地区・全敵種で合計が上限 62% に届かず、圧縮は起きない(消耗品の重みは現行維持)', () => {
    for (const biome of BIOME_IDS) {
      for (const kind of ['w', 'f', 't'] as const) {
        const r = dropRatesFor(kind, biome);
        const p = dropProfileFor(biome);
        const base = { w: [0.12, 0.16], f: [0.12, 0.11], t: [0.1, 0.1] }[kind];
        expect(r.heal + r.ration + r.material).toBeLessThan(DROP_TOTAL_CAP);
        expect(r.heal).toBeCloseTo(base[0] * p.heal, 10);
        expect(r.ration).toBeCloseTo(base[1] * p.ration, 10);
        expect(r.material).toBeCloseTo(0.08, 10);
      }
    }
  });

  it('最も重い居住区画の Walker でも合計 51.6% で上限以下', () => {
    const r = dropRatesFor('w', 'habitation');
    expect(r.heal + r.ration + r.material).toBeCloseTo(0.516);
    expect(r.heal).toBeCloseTo(0.18);
    expect(r.ration).toBeCloseTo(0.256);
  });

  it('上限を超える重みを渡せば圧縮される仕組み自体は残っている(定数の確認)', () => {
    expect(DROP_TOTAL_CAP).toBe(0.62);
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

  it('砲弾セルは敵から出ない(弾薬設計 §3: 弾薬の主経路は場所)', () => {
    for (const biome of BIOME_IDS) {
      for (const kind of ['w', 'f', 't'] as const) {
        for (let i = 0; i < 300; i++) {
          const r = dropFor(SEED, `${kind}:${i * 5 + 1},${900 + i}`, i, biome);
          expect(r === 'heal' || r === 'ration' || r === 'material' || r === null).toBe(true);
        }
      }
    }
  });

  it('Walker・倍率 1.0 の地区では回復≈12% / 糧食≈16% / 素材≈8%、残り≈64% は何も落ちない', () => {
    const d = distribution('w', 'coldSteel');
    near(d.heal, 0.12);
    near(d.ration, 0.16);
    near(d.material, 0.08);
    near(d.none, 0.64);
  });

  it('飛行敵・倍率 1.0 の地区では回復≈12% / 糧食≈11% / 素材≈8%', () => {
    const d = distribution('f', 'coldSteel');
    near(d.heal, 0.12);
    near(d.ration, 0.11);
    near(d.material, 0.08);
  });

  it('固定砲台・倍率 1.0 の地区では回復≈10% / 糧食≈10% / 素材≈8%(v2.0 Task 6)', () => {
    const d = distribution('t', 'coldSteel');
    near(d.heal, 0.1);
    near(d.ration, 0.1);
    near(d.material, 0.08);
    near(d.heal + d.ration + d.material, 0.28);
  });

  it('居住区画では糧食が最も多くなる(Walker 糧食≈25.6% / 回復≈18%、圧縮なし)', () => {
    const d = distribution('w', 'habitation');
    near(d.heal, 0.18);
    near(d.ration, 0.256);
    near(d.material, 0.08);
    expect(d.ration).toBeGreaterThan(d.heal);
  });

  it('大空洞水域では糧食が ×0.8(Walker≈12.8%)', () => {
    const d = distribution('w', 'waterVoid');
    near(d.heal, 0.12);
    near(d.ration, 0.128);
    near(d.material, 0.08);
  });

  it('廃棄沈殿層では糧食が ×0.7 に下がる(Walker≈11.2%)', () => {
    const d = distribution('w', 'disposal');
    near(d.ration, 0.112);
    near(d.heal, 0.12);
  });

  it('生体異物区では回復 ×1.2・糧食 ×1.3(Walker 回復≈14.4% / 糧食≈20.8%)', () => {
    const d = distribution('w', 'biomech');
    near(d.heal, 0.144);
    near(d.ration, 0.208);
    near(d.material, 0.08);
  });

  it('精錬区は砲弾倍率が無くなり、回復・糧食・素材だけが基礎 × 倍率で出る(Walker 糧食≈12.8%)', () => {
    const d = distribution('w', 'foundry');
    near(d.heal, 0.12);
    near(d.ration, 0.128);
    near(d.material, 0.08);
  });

  it('素材は全敵種・全地区で出る(段階 A: 共通素材 1 種)', () => {
    for (const biome of BIOME_IDS) {
      for (const kind of ['w', 'f', 't'] as const) {
        const d = distribution(kind, biome, 1000);
        expect(d.material).toBeGreaterThan(0.03);
      }
    }
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
      expect(r === 'heal' || r === 'ration' || r === 'material' || r === null).toBe(true);
    }
  });
});
