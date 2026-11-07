import { describe, expect, it } from 'vitest';
import { dropFor, dropProfileFor, type DropKind } from './drop';
import { BIOME_IDS, type BiomeId } from './biomeCells';

const SEED = 20260711;

/** 固定 seed で多数のスポーン ID を振り、ドロップ種別の割合を数える */
function distribution(
  kind: 'w' | 'f',
  biomeId: BiomeId,
  n = 4000,
): Record<'charge' | 'heal' | 'none', number> {
  const counts = { charge: 0, heal: 0, none: 0 };
  for (let i = 0; i < n; i++) {
    const r: DropKind | null = dropFor(SEED, `${kind}:${i * 3 + 11},${500 + i}`, 0, biomeId);
    if (r === 'charge') counts.charge++;
    else if (r === 'heal') counts.heal++;
    else counts.none++;
  }
  return {
    charge: counts.charge / n,
    heal: counts.heal / n,
    none: counts.none / n,
  };
}

describe('dropProfileFor(地区倍率表)', () => {
  it('設計書 §3 の倍率表どおりである(全 7 地区)', () => {
    expect(dropProfileFor('coldSteel')).toEqual({ charge: 1.0, heal: 1.0 });
    expect(dropProfileFor('habitation')).toEqual({ charge: 1.0, heal: 1.5 });
    expect(dropProfileFor('disposal')).toEqual({ charge: 1.0, heal: 1.0 });
    expect(dropProfileFor('waterVoid')).toEqual({ charge: 1.3, heal: 1.0 });
    expect(dropProfileFor('power')).toEqual({ charge: 1.0, heal: 1.0 });
    expect(dropProfileFor('foundry')).toEqual({ charge: 2.0, heal: 1.0 });
    expect(dropProfileFor('biomech')).toEqual({ charge: 1.2, heal: 1.2 });
  });

  it('全地区ぶん定義されている', () => {
    for (const id of BIOME_IDS) {
      const p = dropProfileFor(id);
      expect(p.charge).toBeGreaterThan(0);
      expect(p.heal).toBeGreaterThan(0);
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

  it('Walker・倍率 1.0 の地区では砲弾≈25% / 回復≈15%', () => {
    const d = distribution('w', 'coldSteel');
    expect(d.charge).toBeGreaterThan(0.215);
    expect(d.charge).toBeLessThan(0.285);
    expect(d.heal).toBeGreaterThan(0.12);
    expect(d.heal).toBeLessThan(0.18);
  });

  it('飛行敵・倍率 1.0 の地区では砲弾≈30% / 回復≈15%', () => {
    const d = distribution('f', 'coldSteel');
    expect(d.charge).toBeGreaterThan(0.265);
    expect(d.charge).toBeLessThan(0.335);
    expect(d.heal).toBeGreaterThan(0.12);
    expect(d.heal).toBeLessThan(0.18);
  });

  it('精錬区では Walker の砲弾が ×2.0 ≈50% になる', () => {
    const d = distribution('w', 'foundry');
    expect(d.charge).toBeGreaterThan(0.46);
    expect(d.charge).toBeLessThan(0.54);
    expect(d.heal).toBeGreaterThan(0.12);
    expect(d.heal).toBeLessThan(0.18);
  });

  it('居住区画では Walker の回復が ×1.5 ≈22.5% になる', () => {
    const d = distribution('w', 'habitation');
    expect(d.charge).toBeGreaterThan(0.215);
    expect(d.charge).toBeLessThan(0.285);
    expect(d.heal).toBeGreaterThan(0.195);
    expect(d.heal).toBeLessThan(0.255);
  });

  it('大空洞水域では砲弾が ×1.3 になる(Walker≈32.5% / 飛行敵≈39%)', () => {
    const w = distribution('w', 'waterVoid');
    expect(w.charge).toBeGreaterThan(0.29);
    expect(w.charge).toBeLessThan(0.36);
    const f = distribution('f', 'waterVoid');
    expect(f.charge).toBeGreaterThan(0.355);
    expect(f.charge).toBeLessThan(0.425);
  });

  it('生体異物区では両方 ×1.2 になる(Walker 砲弾≈30% / 回復≈18%)', () => {
    const d = distribution('w', 'biomech');
    expect(d.charge).toBeGreaterThan(0.265);
    expect(d.charge).toBeLessThan(0.335);
    expect(d.heal).toBeGreaterThan(0.15);
    expect(d.heal).toBeLessThan(0.21);
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

  it('ボス ID など対象外の接頭辞は常に null(ボスの確定ドロップは段階 3)', () => {
    for (let k = 0; k < 50; k++) {
      expect(dropFor(SEED, 'b:12', k, 'coldSteel')).toBeNull();
      expect(dropFor(SEED, 'x:1,2', k, 'coldSteel')).toBeNull();
    }
  });

  it('結果は最大 1 個: charge と heal が同時に出ることはない(戻り値が単一であることの確認)', () => {
    for (let i = 0; i < 200; i++) {
      const r = dropFor(SEED, `w:${i},${i * 2}`, i, 'foundry');
      expect(r === 'charge' || r === 'heal' || r === null).toBe(true);
    }
  });
});
