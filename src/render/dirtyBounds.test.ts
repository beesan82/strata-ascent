import { describe, expect, it } from 'vitest';
import { craterCells, dirtyBoundsAround, expandRect, rebakeTargets } from './dirtyBounds';

/** 隣チャンクに破壊がない場合 */
const dirtyBounds = (mask: Uint8Array, size: number, dilate: number) =>
  dirtyBoundsAround((cx, cy) => (cx === 0 && cy === 0 ? mask : undefined), 0, 0, size, dilate);

describe('dirtyBoundsAround(自チャンクのみ)', () => {
  it('空のマスクなら null', () => {
    expect(dirtyBounds(new Uint8Array(16), 4, 1)).toBeNull();
  });

  it('対象セルの外接矩形を dilate だけ広げる', () => {
    const size = 16;
    const mask = new Uint8Array(size * size);
    mask[3 * size + 4] = 1; // (4,3)
    mask[7 * size + 9] = 1; // (9,7)
    expect(dirtyBounds(mask, size, 2)).toEqual({ x: 2, y: 1, w: 10, h: 9 });
  });

  it('範囲外へは広げない', () => {
    const size = 8;
    const mask = new Uint8Array(size * size);
    mask[0] = 1;
    mask[size * size - 1] = 1;
    expect(dirtyBounds(mask, size, 2)).toEqual({ x: 0, y: 0, w: 8, h: 8 });
  });
});

describe('dirtyBoundsAround', () => {
  const size = 8;
  const masks = new Map<string, Uint8Array>();
  const set = (cx: number, cy: number, x: number, y: number) => {
    const k = `${cx},${cy}`;
    if (!masks.has(k)) masks.set(k, new Uint8Array(size * size));
    masks.get(k)![y * size + x] = 1;
  };
  const maskAt = (cx: number, cy: number) => masks.get(`${cx},${cy}`);

  it('隣チャンクの境界際の破壊もこのチャンク側の範囲に含める', () => {
    masks.clear();
    set(1, 0, 0, 3); // 右隣の左端(このチャンクのローカル x=8)
    expect(dirtyBoundsAround(maskAt, 0, 0, size, 2)).toEqual({ x: 6, y: 1, w: 2, h: 5 });
  });

  it('境界から dilate より遠い隣の破壊は無視し、何もなければ null', () => {
    masks.clear();
    set(1, 0, 2, 3); // ローカル x=10: 境界から3セル
    expect(dirtyBoundsAround(maskAt, 0, 0, size, 2)).toBeNull();
  });

  it('自チャンクと斜め隣の破壊を合わせた外接矩形', () => {
    masks.clear();
    set(0, 0, 4, 4);
    set(-1, -1, 7, 7); // ローカル (-1,-1)
    expect(dirtyBoundsAround(maskAt, 0, 0, size, 1)).toEqual({ x: 0, y: 0, w: 6, h: 6 });
  });
});

describe('rebakeTargets', () => {
  const size = 8;
  it('破壊チャンク自身と、境界から dilate 以内に破壊がある側の隣を返す', () => {
    const m = new Uint8Array(size * size);
    m[3 * size + 7] = 1; // 右端
    m[0 * size + 4] = 1; // 上端
    const masks = new Map([['0,0', m]]);
    const got = rebakeTargets(['0,0'], (cx, cy) => masks.get(`${cx},${cy}`), size, 2);
    expect([...got].sort()).toEqual(['0,-1', '0,0', '1,0']); // 角に近い破壊がないので斜め隣は対象外
  });

  it('中央だけの破壊なら自分だけ', () => {
    const m = new Uint8Array(size * size);
    m[4 * size + 4] = 1;
    const got = rebakeTargets(['2,3'], () => m, size, 2);
    expect([...got]).toEqual(['2,3']);
  });
});

describe('expandRect', () => {
  it('margin だけ広げて size 内に切り詰める', () => {
    expect(expandRect({ x: 3, y: 0, w: 2, h: 8 }, 1, 8)).toEqual({ x: 2, y: 0, w: 4, h: 8 });
  });
});

describe('craterCells', () => {
  it('破壊済みかつ元地形が空気でないセルを、行ごとの連続区間の矩形で返す', () => {
    const size = 4;
    const mask = new Uint8Array(size * size);
    const pristine = new Uint8Array(size * size); // 0=AIR
    // 行1: x=0..2 を破壊。元地形は x=0,1 がSOLID(1)、x=2 は元から空気
    mask[1 * size + 0] = mask[1 * size + 1] = mask[1 * size + 2] = 1;
    pristine[1 * size + 0] = pristine[1 * size + 1] = 1;
    // 行3: x=3 を破壊(元SOLID)
    mask[3 * size + 3] = 1;
    pristine[3 * size + 3] = 1;
    expect(craterCells(mask, pristine, size)).toEqual([
      { x: 0, y: 1, w: 2, h: 1 },
      { x: 3, y: 3, w: 1, h: 1 },
    ]);
  });

  it('破壊がなければ空', () => {
    expect(craterCells(new Uint8Array(16), new Uint8Array(16).fill(1), 4)).toEqual([]);
  });
});
