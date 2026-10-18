import { describe, expect, it } from 'vitest';
import { biomeBoundary } from './biomeCells';
import {
  interfaceBottom, interfaceThickness, interfaceTop, isGreatInterface, mod,
  nearestPassage, passageX, PASSAGE_SLOT,
} from './interface';

const seeds = [1, 42, 20260711];

describe('interface geometry', () => {
  it('mod は負数でも非負', () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(-6, 4)).toBe(2);
  });
  it('大界面は mod(cell,4)===2 だけ。cell 0 は通常', () => {
    expect(isGreatInterface(0)).toBe(false);
    expect(isGreatInterface(2)).toBe(true);
    expect(isGreatInterface(-2)).toBe(true);
    expect(interfaceThickness(0)).toBe(32);
    expect(interfaceThickness(2)).toBe(96);
  });
  it('上面は景観セル境界、下面は上面+厚み', () => {
    for (const seed of seeds) for (let cell = -5; cell <= 5; cell++) {
      expect(interfaceTop(seed, cell)).toBe(biomeBoundary(seed, cell));
      expect(interfaceBottom(seed, cell) - interfaceTop(seed, cell)).toBe(interfaceThickness(cell));
    }
  });
  it('孔の間隔は 256〜512、最寄りまで 256 以内', () => {
    for (const seed of seeds) for (let cell = -5; cell <= 5; cell++) {
      for (let k = -20; k < 20; k++) {
        const d = passageX(seed, cell, k + 1) - passageX(seed, cell, k);
        expect(d).toBeGreaterThanOrEqual(256);
        expect(d).toBeLessThanOrEqual(512);
        const px = passageX(seed, cell, k);
        expect(Math.abs(px - (k * PASSAGE_SLOT + PASSAGE_SLOT / 2))).toBeLessThanOrEqual(64);
      }
      for (let x = -3000; x <= 3000; x += 37) {
        const n = nearestPassage(seed, cell, x);
        expect(Math.abs(n.x - x)).toBeLessThanOrEqual(256);
        expect(passageX(seed, cell, n.k)).toBe(n.x);
      }
    }
  });
  it('決定論: 同入力同出力、シード差で変わる', () => {
    expect(passageX(42, 1, 3)).toBe(passageX(42, 1, 3));
    expect([passageX(1, 1, 3), passageX(2, 1, 3), passageX(3, 1, 3)].some((v) => v !== passageX(1, 1, 3))).toBe(true);
  });
});
