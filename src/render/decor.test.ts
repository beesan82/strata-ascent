import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import { tileAt } from '../world/worldgen';
import { decorateChunk, PALETTE } from './decor';

describe('decorateChunk', () => {
  it('同一シード・同一チャンクなら同一の装飾リスト(決定論)', () => {
    expect(decorateChunk(42, 1, 1)).toEqual(decorateChunk(42, 1, 1));
  });

  it('装飾の種類が一通り出現する(広域統計)', () => {
    const kinds = new Set<string>();
    const colors = new Set<string>();
    for (let cx = 0; cx < 4; cx++) {
      for (let cy = -2; cy < 2; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          kinds.add(op.kind);
          if ('color' in op) colors.add(op.color);
        }
      }
    }
    expect(kinds).toContain('line');
    expect(kinds).toContain('dot');
    expect(kinds).toContain('hatch');
    // エッジハイライトと梯子レールは必ずどこかにある
    expect(colors).toContain(PALETTE.edgeTop);
    expect(colors).toContain(PALETTE.rail);
  });

  it('ハッチングは内部タイル(全方向SOLID)にのみ付く', () => {
    for (const op of decorateChunk(42, 1, 1)) {
      if (op.kind !== 'hatch') continue;
      const wx = 1 * 64 + Math.floor(op.x);
      const wy = 1 * 64 + Math.floor(op.y);
      expect(tileAt(42, wx, wy)).toBe(TILE.SOLID);
      expect(tileAt(42, wx, wy - 1)).toBe(TILE.SOLID);
      expect(tileAt(42, wx, wy + 1)).toBe(TILE.SOLID);
      expect(tileAt(42, wx - 1, wy)).toBe(TILE.SOLID);
      expect(tileAt(42, wx + 1, wy)).toBe(TILE.SOLID);
    }
  });

  it('梯子タイルにはレール2本と踏み桟が付く', () => {
    // チャンク(1,1)内の梯子タイルを1つ探す
    let found = false;
    for (let ly = 0; ly < 64 && !found; ly++) {
      for (let lx = 0; lx < 64 && !found; lx++) {
        if (tileAt(42, 64 + lx, 64 + ly) !== TILE.LADDER) continue;
        found = true;
        const ops = decorateChunk(42, 1, 1).filter(
          (op) =>
            op.kind === 'line' &&
            op.color === PALETTE.rail &&
            Math.floor(op.x1) === lx &&
            Math.floor(op.y1) === ly,
        );
        expect(ops.length).toBe(2); // 縦レール2本
      }
    }
    expect(found).toBe(true);
  });
});
