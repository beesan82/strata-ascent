import { describe, expect, it } from 'vitest';
import { dirtyBounds } from './dirtyBounds';

describe('dirtyBounds', () => {
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
