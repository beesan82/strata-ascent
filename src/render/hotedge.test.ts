import { describe, expect, it } from 'vitest';
import { hotEdges, type HotEdgeGrids } from './hotedge';
import { TILE } from '../world/tiles';

const SIZE = 4;
const N = SIZE + 2;

/** 6×6 グリッド(中心 4×4 がチャンク、周囲 1 セルが隣接チャンク分)を組み立てる */
function grids(fill: (g: HotEdgeGrids, at: (x: number, y: number) => number) => void): HotEdgeGrids {
  const g: HotEdgeGrids = {
    current: new Uint8Array(N * N),
    pristine: new Uint8Array(N * N),
    destroyed: new Uint8Array(N * N),
  };
  const at = (x: number, y: number) => (y + 1) * N + (x + 1);
  fill(g, at);
  return g;
}

/** 全面 SOLID の地形(現在・元とも) */
function allSolid(g: HotEdgeGrids) {
  g.current.fill(TILE.SOLID);
  g.pristine.fill(TILE.SOLID);
}

/** (x,y) を掘削済みにする: 現在は AIR、破壊マスク 1、元は SOLID */
function dig(g: HotEdgeGrids, at: (x: number, y: number) => number, x: number, y: number) {
  g.current[at(x, y)] = TILE.AIR;
  g.destroyed[at(x, y)] = 1;
}

const key = (e: { x: number; y: number; side: string }) => `${e.x},${e.y},${e.side}`;

describe('hotEdges', () => {
  it('クレーターに面した固体タイルの面だけが残る', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      dig(gg, at, 1, 1);
    });
    const edges = hotEdges(g, SIZE).map(key).sort();
    expect(edges).toEqual(['0,1,e', '1,0,s', '1,2,n', '2,1,w'].sort());
  });

  it('破壊がなければ縁はない', () => {
    const g = grids((gg) => allSolid(gg));
    expect(hotEdges(g, SIZE)).toEqual([]);
  });

  it('元が空気のセルは破壊マスクが立っていてもクレーター扱いしない', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      gg.pristine[at(1, 1)] = TILE.AIR;
      gg.current[at(1, 1)] = TILE.AIR;
      gg.destroyed[at(1, 1)] = 1;
    });
    expect(hotEdges(g, SIZE)).toEqual([]);
  });

  it('チャンク境界の外(隣接チャンク)のクレーターにも面する', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      dig(gg, at, -1, 2); // 左隣チャンクのセル
    });
    expect(hotEdges(g, SIZE).map(key)).toEqual(['0,2,w']);
  });

  it('斜めのクレーターには面しない', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      dig(gg, at, 1, 1);
    });
    const edges = hotEdges(g, SIZE);
    expect(edges.some((e) => e.x === 0 && e.y === 0)).toBe(false);
    expect(edges.some((e) => e.x === 2 && e.y === 2)).toBe(false);
  });

  it('HARD も固体として縁を持つ', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      gg.current[at(1, 0)] = TILE.HARD;
      gg.pristine[at(1, 0)] = TILE.HARD;
      dig(gg, at, 1, 1);
    });
    expect(hotEdges(g, SIZE).map(key)).toContain('1,0,s');
  });
});
