import { describe, expect, it } from 'vitest';
import { dropFor, dropProfileFor, dropRatesFor, DROP_TOTAL_CAP, type DropKind } from './drop';
import { BIOME_IDS, type BiomeId } from './biomeCells';

const SEED = 20260711;

/** 固定 seed で多数のスポーン ID を振り、ドロップ種別の割合を数える */
function distribution(
  kind: 'w' | 'f' | 't',
  biomeId: BiomeId,
  n = 4000,
): Record<'charge' | 'heal' | 'ration' | 'material' | 'none', number> {
  const counts = { charge: 0, heal: 0, ration: 0, material: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const r: DropKind | null = dropFor(SEED, `${kind}:${i * 3 + 11},${500 + i}`, 0, biomeId);
    if (r === 'charge') counts.charge++;
    else if (r === 'heal') counts.heal++;
    else if (r === 'ration') counts.ration++;
    else if (r === 'material') counts.material++;
    else counts.none++;
  }
  return {
    charge: counts.charge / n,
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
  it('砲弾・回復は第2弾 §3、糧食はサバイバル設計 §5 の倍率表どおり、素材は全地区 ×1.0(段階 A)', () => {
    expect(dropProfileFor('coldSteel')).toEqual({ charge: 1.0, heal: 1.0, ration: 1.0, material: 1.0 });
    expect(dropProfileFor('habitation')).toEqual({ charge: 1.0, heal: 1.5, ration: 1.6, material: 1.0 });
    expect(dropProfileFor('disposal')).toEqual({ charge: 1.0, heal: 1.0, ration: 0.7, material: 1.0 });
    expect(dropProfileFor('waterVoid')).toEqual({ charge: 1.3, heal: 1.0, ration: 0.8, material: 1.0 });
    expect(dropProfileFor('power')).toEqual({ charge: 1.0, heal: 1.0, ration: 0.9, material: 1.0 });
    expect(dropProfileFor('foundry')).toEqual({ charge: 2.0, heal: 1.0, ration: 0.8, material: 1.0 });
    expect(dropProfileFor('biomech')).toEqual({ charge: 1.2, heal: 1.2, ration: 1.3, material: 1.0 });
  });

  it('全地区ぶん定義されている', () => {
    for (const id of BIOME_IDS) {
      const p = dropProfileFor(id);
      expect(p.charge).toBeGreaterThan(0);
      expect(p.heal).toBeGreaterThan(0);
      expect(p.ration).toBeGreaterThan(0);
      expect(p.material).toBeGreaterThan(0);
    }
  });
});

describe('dropRatesFor(重み方式の実効確率)', () => {
  it('倍率 1.0 の地区では基礎確率そのもの(Walker 22/12/16/8、合計 58%)', () => {
    const r = dropRatesFor('w', 'coldSteel');
    expect(r.charge).toBeCloseTo(0.22);
    expect(r.heal).toBeCloseTo(0.12);
    expect(r.ration).toBeCloseTo(0.16);
    expect(r.material).toBeCloseTo(0.08);
    const f = dropRatesFor('f', 'coldSteel');
    expect(f.charge).toBeCloseTo(0.27);
    expect(f.heal).toBeCloseTo(0.12);
    expect(f.ration).toBeCloseTo(0.11);
    expect(f.material).toBeCloseTo(0.08);
    const t = dropRatesFor('t', 'coldSteel');
    expect(t.charge).toBeCloseTo(0.25);
    expect(t.heal).toBeCloseTo(0.1);
    expect(t.ration).toBeCloseTo(0.1);
    expect(t.material).toBeCloseTo(0.08);
  });

  it('素材は敵種によらず基礎 8% で、地区倍率は全地区 1.0(段階 A は共通素材 1 種)', () => {
    // 砲弾の基礎確率(敵種別)。圧縮があっても「素材 : 砲弾」の比は重みの比のまま
    const baseCharge = { w: 0.22, f: 0.27, t: 0.25 } as const;
    for (const biome of BIOME_IDS) {
      for (const kind of ['w', 'f', 't'] as const) {
        const r = dropRatesFor(kind, biome);
        const total = r.charge + r.heal + r.ration + r.material;
        if (total < DROP_TOTAL_CAP - 1e-9) {
          expect(r.material).toBeCloseTo(0.08, 10);
        } else {
          expect(total).toBeCloseTo(DROP_TOTAL_CAP);
          expect(r.material / r.charge).toBeCloseTo(0.08 / (baseCharge[kind] * dropProfileFor(biome).charge), 6);
        }
        // 最も圧縮の強い精錬区の飛行敵(合計 0.828)でも 6% 近くは残る
        expect(r.material).toBeGreaterThan(0.055);
        expect(r.material).toBeLessThanOrEqual(0.08 + 1e-9);
      }
    }
  });

  it('重みの合計が 62% を超える地区では全体が 62% へ圧縮される(精錬区 Walker)', () => {
    const r = dropRatesFor('w', 'foundry');
    expect(r.charge + r.heal + r.ration + r.material).toBeCloseTo(DROP_TOTAL_CAP);
    // 圧縮後も比率は重みの比を保つ(0.44 : 0.12 : 0.128 : 0.08、合計 0.768)
    expect(r.charge).toBeCloseTo(0.44 * (0.62 / 0.768), 6);
    expect(r.ration).toBeCloseTo(0.128 * (0.62 / 0.768), 6);
    expect(r.material).toBeCloseTo(0.08 * (0.62 / 0.768), 6);
  });

  it('合計が上限以下の地区では圧縮されない(大空洞水域 Walker は 61.4%)', () => {
    const r = dropRatesFor('w', 'waterVoid');
    expect(r.charge + r.heal + r.ration + r.material).toBeCloseTo(0.614);
    expect(r.charge).toBeCloseTo(0.286);
    expect(r.material).toBeCloseTo(0.08);
  });

  it('素材を混ぜても圧縮の無い地区では消耗品 3 種の実効確率が変わらない(段階 A の裁定)', () => {
    for (const biome of ['coldSteel', 'disposal', 'waterVoid', 'power'] as const) {
      const r = dropRatesFor('w', biome);
      const p = dropProfileFor(biome);
      expect(r.charge).toBeCloseTo(0.22 * p.charge, 6);
      expect(r.heal).toBeCloseTo(0.12 * p.heal, 6);
      expect(r.ration).toBeCloseTo(0.16 * p.ration, 6);
    }
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

  it('Walker・倍率 1.0 の地区では砲弾≈22% / 回復≈12% / 糧食≈16% / 素材≈8%', () => {
    const d = distribution('w', 'coldSteel');
    near(d.charge, 0.22);
    near(d.heal, 0.12);
    near(d.ration, 0.16);
    near(d.material, 0.08);
    near(d.charge + d.heal + d.ration + d.material, 0.58);
  });

  it('飛行敵・倍率 1.0 の地区では砲弾≈27% / 回復≈12% / 糧食≈11% / 素材≈8%', () => {
    const d = distribution('f', 'coldSteel');
    near(d.charge, 0.27);
    near(d.heal, 0.12);
    near(d.ration, 0.11);
    near(d.material, 0.08);
  });

  it('固定砲台・倍率 1.0 の地区では砲弾≈25% / 回復≈10% / 糧食≈10% / 素材≈8%(v2.0 Task 6)', () => {
    const d = distribution('t', 'coldSteel');
    near(d.charge, 0.25);
    near(d.heal, 0.1);
    near(d.ration, 0.1);
    near(d.material, 0.08);
    near(d.charge + d.heal + d.ration + d.material, 0.53);
  });

  it('固定砲台にも地区倍率が効く(精錬区は砲弾 ×2.0 で圧縮され砲弾が最も多い)', () => {
    const r = dropRatesFor('t', 'foundry');
    // 重み 0.50 / 0.10 / 0.08 / 0.08、合計 0.76 > 0.62 で全体が圧縮される
    expect(r.charge + r.heal + r.ration + r.material).toBeCloseTo(DROP_TOTAL_CAP);
    expect(r.charge).toBeCloseTo(0.5 * (0.62 / 0.76), 6);
    expect(r.charge).toBeGreaterThan(r.heal);
    expect(r.charge).toBeGreaterThan(r.ration);
    expect(r.charge).toBeGreaterThan(r.material);
    const d = distribution('t', 'foundry');
    near(d.charge, 0.5 * (0.62 / 0.76));
  });

  it('精錬区では重み圧縮のうえで砲弾が最も多い(Walker 圧縮後≈35.5%)', () => {
    const d = distribution('w', 'foundry');
    near(d.charge, 0.44 * (0.62 / 0.768));
    near(d.heal, 0.12 * (0.62 / 0.768));
    near(d.ration, 0.128 * (0.62 / 0.768));
    near(d.material, 0.08 * (0.62 / 0.768));
    near(d.charge + d.heal + d.ration + d.material, 0.62);
  });

  it('居住区画では糧食が最も多くなる(Walker 圧縮後 糧食≈21.6% / 回復≈15.2%)', () => {
    const d = distribution('w', 'habitation');
    near(d.charge, 0.22 * (0.62 / 0.736));
    near(d.heal, 0.18 * (0.62 / 0.736));
    near(d.ration, 0.256 * (0.62 / 0.736));
    near(d.material, 0.08 * (0.62 / 0.736));
    expect(d.ration).toBeGreaterThan(d.charge);
    expect(d.ration).toBeGreaterThan(d.heal);
  });

  it('大空洞水域では砲弾が ×1.3、糧食は ×0.8(Walker≈28.6% / 12.8%、圧縮なし)', () => {
    const d = distribution('w', 'waterVoid');
    near(d.charge, 0.286);
    near(d.heal, 0.12);
    near(d.ration, 0.128);
    near(d.material, 0.08);
  });

  it('廃棄沈殿層では糧食が ×0.7 に下がる(Walker≈11.2%)', () => {
    const d = distribution('w', 'disposal');
    near(d.ration, 0.112);
    near(d.charge, 0.22);
  });

  it('生体異物区では糧食が ×1.3 に上がる(Walker: 素材を足して 69.6% になり圧縮、糧食≈18.5%)', () => {
    const d = distribution('w', 'biomech');
    near(d.charge, 0.264 * (0.62 / 0.696));
    near(d.heal, 0.144 * (0.62 / 0.696));
    near(d.ration, 0.208 * (0.62 / 0.696));
    near(d.material, 0.08 * (0.62 / 0.696));
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

  it('結果は最大 1 個: 戻り値は 4 種か null のいずれか単一', () => {
    for (let i = 0; i < 200; i++) {
      const r = dropFor(SEED, `w:${i},${i * 2}`, i, 'foundry');
      expect(r === 'charge' || r === 'heal' || r === 'ration' || r === 'material' || r === null).toBe(true);
    }
  });
});
