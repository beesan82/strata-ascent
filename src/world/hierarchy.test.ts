import { describe, expect, it } from 'vitest';
import {
  REGION_SIZE, SECTOR_SIZE, DISTRICT_SIZE, ROOM_SIZE,
  cellOf, cellHash, weighted,
  regionAt, SYSTEMS,
} from './hierarchy';

describe('サイズ定数', () => {
  it('2の冪で入れ子が整合(各上位は下位の整数倍)', () => {
    expect(REGION_SIZE % SECTOR_SIZE).toBe(0);
    expect(SECTOR_SIZE % DISTRICT_SIZE).toBe(0);
    expect(DISTRICT_SIZE % ROOM_SIZE).toBe(0);
    expect(ROOM_SIZE % 64).toBe(0);
  });
});

describe('cellOf', () => {
  it('負座標でも正しく床方向へ丸める', () => {
    expect(cellOf(0, 100)).toBe(0);
    expect(cellOf(99, 100)).toBe(0);
    expect(cellOf(100, 100)).toBe(1);
    expect(cellOf(-1, 100)).toBe(-1);
    expect(cellOf(-100, 100)).toBe(-1);
    expect(cellOf(-101, 100)).toBe(-2);
  });
});

describe('cellHash', () => {
  it('決定論: 同じ入力なら同じ値、値域[0,1)', () => {
    expect(cellHash(42, 3, -2, 7)).toBe(cellHash(42, 3, -2, 7));
    for (let i = 0; i < 200; i++) {
      const v = cellHash(42, i, -i, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('salt が違えば別系列', () => {
    let diff = 0;
    for (let i = 0; i < 100; i++) if (cellHash(1, i, i, 1) !== cellHash(1, i, i, 2)) diff++;
    expect(diff).toBeGreaterThan(90);
  });
});

describe('weighted', () => {
  it('重み付き抽選が決定論で、全項目が範囲内', () => {
    const table = [{ v: 'a', w: 1 }, { v: 'b', w: 3 }, { v: 'c', w: 1 }];
    for (let r = 0; r < 1; r += 0.01) {
      const picked = weighted(table, r);
      expect(['a', 'b', 'c']).toContain(picked);
    }
    expect(weighted(table, 0)).toBe('a');
    expect(weighted(table, 0.999)).toBe('c');
  });
});

describe('regionAt', () => {
  it('決定論: 同じ座標なら同じ地域', () => {
    expect(regionAt(42, 5000, -3000)).toEqual(regionAt(42, 5000, -3000));
  });
  it('セル内のどの点から引いても同一(チャンク局所/セル一貫性)', () => {
    const base = regionAt(42, 0, 0);
    for (const [x, y] of [[1, 1], [REGION_SIZE - 1, REGION_SIZE - 1], [12345, 250000]] as const) {
      expect(regionAt(42, x, y)).toEqual(base);
    }
    expect(regionAt(42, REGION_SIZE, 0).rx).toBe(1);
  });
  it('system は SYSTEMS のいずれか', () => {
    for (let i = 0; i < 50; i++) {
      const r = regionAt(42, i * REGION_SIZE, -i * REGION_SIZE);
      expect(SYSTEMS).toContain(r.system);
    }
  });
  it('広域で複数の system が出現する(単調でない)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(regionAt(42, i * REGION_SIZE, 0).system);
    expect(seen.size).toBeGreaterThan(1);
  });
});
