import { describe, expect, it } from 'vitest';
import { traceAt, FLOOR_TYPES, WALL_TYPES } from './traces';
import { restPointAt } from '../world/restpoint';

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
