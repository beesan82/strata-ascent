import { describe, expect, it } from 'vitest';
import { traceAt, FLOOR_TYPES, WALL_TYPES } from './traces';

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
