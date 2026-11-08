import { describe, expect, it } from 'vitest';
import {
  hotEdges, heatStageAt, meltDrips, HEAT_LOOKS, HEAT_SECONDS, HEAT_STAGE_ENDS, type HotEdgeGrids,
} from './hotedge';
import { PIXEL_PALETTE } from './palette';
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

describe('heatStageAt(冷却段階)', () => {
  it('境界どおりに段階が切り替わる', () => {
    expect(heatStageAt(0)).toBe(0);
    expect(heatStageAt(1.49)).toBe(0);
    expect(heatStageAt(1.5)).toBe(1);
    expect(heatStageAt(3.99)).toBe(1);
    expect(heatStageAt(4)).toBe(2);
    expect(heatStageAt(7.99)).toBe(2);
    expect(heatStageAt(8)).toBe(3);
    expect(heatStageAt(100)).toBe(3);
  });

  it('負の経過(時計の巻き戻り)は最も熱い段階として扱う', () => {
    expect(heatStageAt(-1)).toBe(0);
  });

  it('最後の境界が HEAT_SECONDS と一致する', () => {
    expect(HEAT_STAGE_ENDS[2]).toBe(HEAT_SECONDS);
    expect(HEAT_SECONDS).toBe(8);
  });
});

describe('HEAT_LOOKS(段階ごとの見た目)', () => {
  it('全層の色がパレット実在色で、alpha は (0,1] の範囲', () => {
    for (const look of HEAT_LOOKS) {
      for (const layer of look.layers) {
        expect(PIXEL_PALETTE).toContain(layer.color);
        expect(layer.alpha).toBeGreaterThan(0);
        expect(layer.alpha).toBeLessThanOrEqual(1);
      }
      expect(PIXEL_PALETTE).toContain(look.dripColor);
      expect(PIXEL_PALETTE).toContain(look.dripTipColor);
    }
  });

  it('層の深さは外側ほど大きく、冷えるにつれて縁は薄くなる', () => {
    for (const look of HEAT_LOOKS) {
      for (let i = 1; i < look.layers.length; i++) {
        expect(look.layers[i].depth).toBeLessThan(look.layers[i - 1].depth);
      }
    }
    const total = (s: 0 | 1 | 2) => HEAT_LOOKS[s].layers[0].depth;
    expect(total(0)).toBeGreaterThan(total(1));
    expect(total(1)).toBeGreaterThan(total(2));
  });

  it('白熱は白い芯を持ち、末段は暗い錆だけが残る', () => {
    expect(HEAT_LOOKS[0].layers.some((l) => l.color === '#c7d0ce')).toBe(true);
    expect(HEAT_LOOKS[0].layers.some((l) => l.color === '#caa64a')).toBe(true);
    expect(HEAT_LOOKS[2].layers).toEqual([
      { color: '#5a3a24', alpha: 0.5, depth: 0.22 },
    ]);
  });

  it('溶けだれは熱い段階だけに出る', () => {
    expect(HEAT_LOOKS[0].dripMaxLen).toBeGreaterThan(HEAT_LOOKS[1].dripMaxLen);
    expect(HEAT_LOOKS[1].dripMaxLen).toBeGreaterThan(0);
    expect(HEAT_LOOKS[2].dripMaxLen).toBe(0);
  });
});

describe('meltDrips(溶けだれ)', () => {
  /** 横に長い溝を掘った地形: (0..3, 1) を掘削し、上下に縁を作る */
  function trench(): HotEdgeGrids {
    return grids((gg, at) => {
      allSolid(gg);
      for (let x = 0; x < SIZE; x++) dig(gg, at, x, 1);
    });
  }

  it('冷えた段階(2・3)ではだれは出ない', () => {
    const g = trench();
    expect(meltDrips(g, SIZE, 2, 20260711, 0, 0)).toEqual([]);
    expect(meltDrips(g, SIZE, 3, 20260711, 0, 0)).toEqual([]);
  });

  it('破壊がなければだれは出ない', () => {
    const g = grids((gg) => allSolid(gg));
    expect(meltDrips(g, SIZE, 0, 20260711, 0, 0)).toEqual([]);
  });

  it('白熱では溝の縁からだれが出て、全て範囲と上限の中に収まる', () => {
    const g = trench();
    const drips = meltDrips(g, SIZE, 0, 20260711, 0, 0);
    expect(drips.length).toBeGreaterThan(0);
    for (const d of drips) {
      expect(d.len).toBeGreaterThan(0);
      expect(d.len).toBeLessThanOrEqual(HEAT_LOOKS[0].dripMaxLen);
      expect(d.w).toBeGreaterThanOrEqual(0.05);
      expect(d.w).toBeLessThanOrEqual(0.2);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.w).toBeLessThanOrEqual(SIZE);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y + d.len).toBeLessThanOrEqual(SIZE);
    }
  });

  it('決定的: 同じ入力では同じ配置、原点をずらすと配置が変わる', () => {
    const g = trench();
    const a = meltDrips(g, SIZE, 0, 20260711, 0, 0);
    expect(meltDrips(g, SIZE, 0, 20260711, 0, 0)).toEqual(a);
    expect(meltDrips(g, SIZE, 0, 20260711, 16, 32)).not.toEqual(a);
  });

  it('天井面(s)からは下の空気セルへ垂れ、床面(n)からはタイルの面を伝う', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      dig(gg, at, 1, 1); // 縁は (1,0,s) (1,2,n) (0,1,e) (2,1,w)
    });
    const drips = meltDrips(g, SIZE, 0, 20260711, 0, 0);
    for (const d of drips) {
      // どの面から出ても、x は縁のある列 0..3 の中、y は縁のある行 0..3 の中
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x).toBeLessThan(3);
      expect(d.y).toBeGreaterThanOrEqual(0);
      expect(d.y).toBeLessThan(3);
    }
  });

  it('上のチャンクの最下行の天井面からも、このチャンクの最上行へ垂れる', () => {
    const g = grids((gg, at) => {
      allSolid(gg);
      // 最上行を横一列に掘る: 各列で (x,-1) の s 面が源になる
      for (let x = 0; x < SIZE; x++) dig(gg, at, x, 0);
    });
    const drips = meltDrips(g, SIZE, 0, 20260711, 0, 0);
    const fromAbove = drips.filter((d) => d.y === 0);
    expect(fromAbove.length).toBeGreaterThan(0);
  });
});
