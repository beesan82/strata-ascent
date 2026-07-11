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

describe('decorateChunk セグメント装飾', () => {
  it('広域には配管・ケーブル・瓦礫・壁面装飾のいずれもが出現する', () => {
    const colors = new Set<string>();
    for (let cx = 0; cx < 6; cx++) {
      for (let cy = -3; cy < 3; cy++) {
        for (const op of decorateChunk(42, cx, cy)) {
          if ('color' in op) colors.add(op.color);
        }
      }
    }
    expect(colors).toContain(PALETTE.pipe);
    expect(colors).toContain(PALETTE.cable);
    expect(colors).toContain(PALETTE.debris);
    expect(colors).toContain(PALETTE.grill);
  });

  it('床配管は床上面のあるセグメントにのみ載る(配管線の下は必ずSOLID)', () => {
    for (let cx = 0; cx < 3; cx++) {
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'line' || op.color !== PALETTE.pipe) continue;
        if (op.x1 === op.x2) continue; // 壁の縦配管は除外(水平配管のみ検査)
        const midX = cx * 64 + Math.floor((op.x1 + op.x2) / 2);
        const y = 1 * 64 + Math.floor(op.y1);
        expect(tileAt(42, midX, y + 1)).toBe(TILE.SOLID);
        expect(tileAt(42, midX, y)).not.toBe(TILE.SOLID);
      }
    }
  });

  it('天井ケーブルのアンカーは天井面にある(始点直上がSOLID)', () => {
    for (let cx = 0; cx < 3; cx++) {
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'poly' || op.color !== PALETTE.cable) continue;
        const x0 = cx * 64 + Math.floor(op.pts[0]);
        const y0 = 1 * 64 + Math.floor(op.pts[1]);
        expect(tileAt(42, x0, y0 - 1)).toBe(TILE.SOLID);
      }
    }
  });

  it('床配管の判定はチャンク境界の両側で一致する(継ぎ目なし)', () => {
    // x=64(チャンク0と1の境界)付近を通る水平配管の世界座標区間を両チャンクから集めて比較
    const collect = (cx: number) => {
      const set = new Set<string>();
      for (const op of decorateChunk(42, cx, 1)) {
        if (op.kind !== 'line' || op.color !== PALETTE.pipe || op.x1 === op.x2) continue;
        const wx1 = cx * 64 + op.x1;
        const wx2 = cx * 64 + op.x2;
        const wy = 64 + op.y1;
        if (wx2 > 48 && wx1 < 80) set.add(`${wx1.toFixed(2)}:${wx2.toFixed(2)}:${wy.toFixed(2)}`);
      }
      return set;
    };
    expect(collect(0)).toEqual(collect(1));
  });
});
