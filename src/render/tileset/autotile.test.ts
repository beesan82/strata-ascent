import { describe, expect, it } from 'vitest';
import { blobId, BLOB_COUNT } from './autotile';

function id(n: boolean, e: boolean, s: boolean, w: boolean, ne: boolean, se: boolean, sw: boolean, nw: boolean) {
  return blobId({ n, e, s, w, ne, se, sw, nw });
}
const T = true;
const F = false;

describe('blobId', () => {
  it('決定論的: 同じ近傍なら同じID', () => {
    expect(id(T, F, T, F, F, F, F, F)).toBe(id(T, F, T, F, F, F, F, F));
  });

  it('孤立タイル(周囲すべて空気)は単一のID', () => {
    const isolated = id(F, F, F, F, F, F, F, F);
    expect(isolated).toBeGreaterThanOrEqual(0);
    expect(isolated).toBeLessThan(BLOB_COUNT);
  });

  it('全方向SOLIDは「内部」ID、孤立とは別物', () => {
    const inner = id(T, T, T, T, T, T, T, T);
    const isolated = id(F, F, F, F, F, F, F, F);
    expect(inner).not.toBe(isolated);
  });

  it('角ビットは両隣の辺が繋がっている時のみ意味を持つ(標準47ブロブ規則)', () => {
    const cornerAir = id(T, T, F, F, F, F, F, F);
    const cornerSolid = id(T, T, F, F, T, F, F, F);
    expect(cornerAir).not.toBe(cornerSolid);
    const a = id(T, F, F, F, T, F, F, F);
    const b = id(T, F, F, F, F, F, F, F);
    expect(a).toBe(b);
  });

  it('全IDは 0..BLOB_COUNT-1 に収まり、BLOB_COUNTは47', () => {
    expect(BLOB_COUNT).toBe(47);
    for (let m = 0; m < 256; m++) {
      const nb = {
        n: !!(m & 1), e: !!(m & 2), s: !!(m & 4), w: !!(m & 8),
        ne: !!(m & 16), se: !!(m & 32), sw: !!(m & 64), nw: !!(m & 128),
      };
      const v = blobId(nb);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(BLOB_COUNT);
    }
  });
});
