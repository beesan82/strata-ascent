import { describe, expect, it } from 'vitest';
import { reliefEdges, reliefBands, rimSegments } from './relief';

describe('reliefEdges', () => {
  it('全近傍SOLIDなら露出辺なし', () => {
    expect(reliefEdges(true, true, true, true)).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  it('全近傍AIRなら全辺露出', () => {
    expect(reliefEdges(false, false, false, false)).toEqual({ top: true, right: true, bottom: true, left: true });
  });

  it('上だけAIR(床の上面)なら top のみ露出', () => {
    expect(reliefEdges(false, true, true, true)).toEqual({ top: true, right: false, bottom: false, left: false });
  });
});

describe('reliefBands', () => {
  it('露出辺の数だけ帯を返す', () => {
    expect(reliefBands({ top: true, right: false, bottom: false, left: false }, 0.3)).toHaveLength(1);
    expect(reliefBands({ top: true, right: true, bottom: true, left: true }, 0.3)).toHaveLength(4);
    expect(reliefBands({ top: false, right: false, bottom: false, left: false }, 0.3)).toHaveLength(0);
  });

  it('top帯は上端全幅・厚さdepth、グラデは露出面(y=0)から内側(y=depth)へ', () => {
    const [b] = reliefBands({ top: true, right: false, bottom: false, left: false }, 0.3);
    expect(b).toEqual({ x: 0, y: 0, w: 1, h: 0.3, from: [0, 0], to: [0, 0.3] });
  });

  it('right帯は右端(x=1-depth)から内側へ', () => {
    const [b] = reliefBands({ top: false, right: true, bottom: false, left: false }, 0.25);
    expect(b).toEqual({ x: 0.75, y: 0, w: 0.25, h: 1, from: [1, 0], to: [0.75, 0] });
  });

  it('bottom帯は下端から内側へ', () => {
    const [b] = reliefBands({ top: false, right: false, bottom: true, left: false }, 0.2);
    expect(b).toEqual({ x: 0, y: 0.8, w: 1, h: 0.2, from: [0, 1], to: [0, 0.8] });
  });

  it('left帯は左端から内側(x=depth)へ', () => {
    const [b] = reliefBands({ top: false, right: false, bottom: false, left: true }, 0.3);
    expect(b).toEqual({ x: 0, y: 0, w: 0.3, h: 1, from: [0, 0], to: [0.3, 0] });
  });
});

describe('rimSegments', () => {
  it('露出辺ごとに線分を返し、topのみ top=true', () => {
    const segs = rimSegments({ top: true, right: true, bottom: false, left: false });
    expect(segs).toHaveLength(2);
    const top = segs.find((s) => s.top);
    expect(top).toEqual({ x1: 0, y1: 0, x2: 1, y2: 0, top: true });
    const right = segs.find((s) => !s.top);
    expect(right).toEqual({ x1: 1, y1: 0, x2: 1, y2: 1, top: false });
  });

  it('bottom/left線分の座標', () => {
    const bottom = rimSegments({ top: false, right: false, bottom: true, left: false });
    expect(bottom).toEqual([{ x1: 0, y1: 1, x2: 1, y2: 1, top: false }]);
    const left = rimSegments({ top: false, right: false, bottom: false, left: true });
    expect(left).toEqual([{ x1: 0, y1: 0, x2: 0, y2: 1, top: false }]);
  });

  it('露出辺なしなら空', () => {
    expect(rimSegments({ top: false, right: false, bottom: false, left: false })).toHaveLength(0);
  });
});
