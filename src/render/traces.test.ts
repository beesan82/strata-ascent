import { describe, expect, it } from 'vitest';
import {
  traceAt, traceTableFor, restLampCellAt, restTallyCellAt, REST_TALLY_STROKES, FLOOR_TYPES, WALL_TYPES,
} from './traces';
import { restPointAt } from '../world/restpoint';
import { biomeBoundary, biomeIdForCell, BIOME_IDS } from '../world/biomeCells';

const SEED = 20260711;

describe('traceAt', () => {
  it('決定論: 同じ引数は同じ結果', () => {
    for (let i = 0; i < 50; i++) {
      const a = traceAt(SEED, i * 7, i * 3, 'floor');
      const b = traceAt(SEED, i * 7, i * 3, 'floor');
      expect(a).toEqual(b);
    }
  });

  it('床痕跡は稀(適格タイルの5%未満)', () => {
    let hit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (traceAt(SEED, i, 0, 'floor')) hit++;
    expect(hit / N).toBeGreaterThan(0);      // 皆無ではない
    expect(hit / N).toBeLessThan(0.05);      // だが稀
  });

  it('壁痕跡も稀(適格タイルの6%未満)', () => {
    let hit = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (traceAt(SEED, i, 1, 'wall')) hit++;
    expect(hit / N).toBeGreaterThan(0);
    expect(hit / N).toBeLessThan(0.06);
  });

  it('kind=floor は床種別のみ、kind=wall は壁種別のみを返す', () => {
    for (let i = 0; i < 4000; i++) {
      const f = traceAt(SEED, i, 0, 'floor');
      if (f) expect(FLOOR_TYPES).toContain(f.type);
      const w = traceAt(SEED, i, 5, 'wall');
      if (w) expect(WALL_TYPES).toContain(w.type);
    }
  });

  it('id は変種用に安定した整数', () => {
    for (let i = 0; i < 4000; i++) {
      const r = traceAt(SEED, i, 0, 'floor');
      if (r) {
        expect(Number.isInteger(r.id)).toBe(true);
        expect(r.id).toBeGreaterThanOrEqual(0);
        break;
      }
    }
  });
});

describe('地区ごとの痕跡の切替(ゾーン化 段階 3、設計 §4.2)', () => {
  const weightOf = (id: (typeof BIOME_IDS)[number], kind: 'floor' | 'wall', v: string) =>
    traceTableFor(id, kind).find((e) => e.v === v)!.w;

  it('重み表: 基準(寒鋼)から地区ごとに寄る', () => {
    // 居住区画は刻印多め、電力区は警告多め、廃棄沈殿層は薬莢多め、生体異物区は遺体多め
    expect(weightOf('habitation', 'wall', 'tally')).toBeGreaterThan(weightOf('coldSteel', 'wall', 'tally'));
    expect(weightOf('habitation', 'floor', 'pack')).toBeGreaterThan(weightOf('coldSteel', 'floor', 'pack'));
    expect(weightOf('power', 'wall', 'warning')).toBeGreaterThan(weightOf('coldSteel', 'wall', 'warning'));
    expect(weightOf('disposal', 'floor', 'shells')).toBeGreaterThan(weightOf('coldSteel', 'floor', 'shells'));
    expect(weightOf('biomech', 'floor', 'corpse')).toBeGreaterThan(weightOf('coldSteel', 'floor', 'corpse'));
    expect(weightOf('foundry', 'floor', 'shells')).toBeGreaterThan(weightOf('coldSteel', 'floor', 'shells'));
    // 寒鋼基層は基準表そのもの
    expect(traceTableFor('coldSteel', 'floor').map((e) => e.w)).toEqual([1, 2, 3, 3]);
    expect(traceTableFor('coldSteel', 'wall').map((e) => e.w)).toEqual([2, 1]);
  });

  it('出現分布にも地区差が出る: 居住区画の壁は刻印の割合が高い', () => {
    // 地区セルの中央の行で壁痕跡を標本し、tally の割合を比べる
    const tallyShare = (id: (typeof BIOME_IDS)[number]): number => {
      let cell = 0;
      while (biomeIdForCell(SEED, cell) !== id) cell--;
      const y = Math.round((biomeBoundary(SEED, cell) + biomeBoundary(SEED, cell + 1)) / 2);
      let hit = 0;
      let tally = 0;
      for (let x = -8000; x < 8000; x++) {
        const tr = traceAt(SEED, x, y, 'wall');
        if (tr) {
          hit++;
          if (tr.type === 'tally') tally++;
        }
      }
      expect(hit).toBeGreaterThan(100);
      return tally / hit;
    };
    expect(tallyShare('habitation')).toBeGreaterThan(tallyShare('coldSteel') + 0.05);
  });

  it('休憩点の灯・刻印の位置から地区参照用の cell が引ける', () => {
    for (const cell of [0, -1, 2, -5]) {
      const rp = restPointAt(SEED, cell, 0);
      for (const lx of rp.lamps) expect(restLampCellAt(SEED, lx, rp.floorY - 1)).toBe(cell);
      expect(restLampCellAt(SEED, rp.packX, rp.floorY - 1)).toBeNull();
      expect(restTallyCellAt(SEED, rp.left, rp.tallyY)).toBe(cell);
      expect(restTallyCellAt(SEED, rp.left + 1, rp.tallyY)).toBeNull();
    }
  });

  it('刻印の刻線数は地区ごとに定義され、居住区画が最も多い部類', () => {
    for (const id of BIOME_IDS) {
      expect(REST_TALLY_STROKES[id]).toBeGreaterThanOrEqual(3);
      expect(REST_TALLY_STROKES[id]).toBeLessThanOrEqual(8);
    }
    expect(REST_TALLY_STROKES.habitation).toBeGreaterThan(REST_TALLY_STROKES.coldSteel);
    expect(new Set(Object.values(REST_TALLY_STROKES)).size).toBeGreaterThanOrEqual(4);
  });
});

describe('休憩点の痕跡(段階4)', () => {
  it('休憩点の床の 1 段上に灯 3〜5 と荷袋、左の壁に刻印', () => {
    for (const cell of [0, -1, 2]) {
      const rp = restPointAt(SEED, cell, 0);
      for (const lx of rp.lamps) expect(traceAt(SEED, lx, rp.floorY - 1, 'floor')?.type).toBe('lamp');
      expect(traceAt(SEED, rp.packX, rp.floorY - 1, 'floor')?.type).toBe('pack');
      expect(traceAt(SEED, rp.left, rp.tallyY, 'wall')?.type).toBe('tally');
    }
  });
  it('休憩点の周囲 24 タイルは床痕跡が 5 倍(約 9%)、その外は従来(2% 弱)', () => {
    const rp = restPointAt(SEED, 0, 0);
    let near = 0, far = 0;
    const N = 4000;
    for (let i = 0; i < N; i++) if (traceAt(SEED, rp.left - 20 + (i % 40), rp.floorY + 2 + (Math.floor(i / 40) % 20), 'floor')) near++;
    for (let i = 0; i < N; i++) if (traceAt(SEED, rp.right + 30 + (i % 200), rp.floorY + 30 + Math.floor(i / 200), 'floor')) far++;
    expect(near / N).toBeGreaterThan(0.05);
    expect(near / N).toBeLessThan(0.15);
    expect(far / N).toBeLessThan(0.05);
  });
});
