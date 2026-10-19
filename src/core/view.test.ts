import { describe, expect, it } from 'vitest';
import { VIEW_ZOOM } from './zoom';
import {
  AUTO_FLOW_TILES, autoViewStarted, INITIAL_VIEW, MANUAL_OFFSET_TILES, viewState, type ViewInput, type ViewState,
} from './view';

const base: ViewInput = {
  shift: false, moving: false, grounded: true, still: true, aimX: 0, aimY: 0, overlookCell: null, baseZoom: 1,
};
const step = (s: ViewState, patch: Partial<ViewInput>, dt = 1 / 60): ViewState => viewState(s, { ...base, ...patch }, dt);

describe('手動眺望', () => {
  it('接地・静止で Shift を押すと 0.35、マウス方向へ最大 40 タイル', () => {
    const s = step(INITIAL_VIEW, { shift: true, aimX: 1, aimY: 1 });
    expect(s.mode).toBe('manual');
    expect(s.zoom).toBe(VIEW_ZOOM);
    expect(Math.hypot(s.offsetX, s.offsetY)).toBeCloseTo(MANUAL_OFFSET_TILES, 5);
    const t = step(INITIAL_VIEW, { shift: true, aimX: -0.5, aimY: 0 });
    expect(t.offsetX).toBeCloseTo(-20, 5);
    expect(t.offsetY).toBe(0);
  });
  it('空中・歩行中は入らない', () => {
    expect(step(INITIAL_VIEW, { shift: true, grounded: false, still: false }).mode).toBe('none');
    expect(step(INITIAL_VIEW, { shift: true, still: false }).mode).toBe('none');
  });
  it('移動入力で即解除し、出力は基準へ戻る', () => {
    const s = step(INITIAL_VIEW, { shift: true, aimX: 1 });
    const t = step(s, { shift: true, moving: true, still: false, baseZoom: 0.75 });
    expect(t.mode).toBe('none');
    expect(t.zoom).toBe(0.75);
    expect(t.offsetX).toBe(0);
  });
  it('Shift を離すと解除', () => {
    const s = step(INITIAL_VIEW, { shift: true });
    expect(step(s, {}).mode).toBe('none');
  });
});

describe('自動眺望', () => {
  it('見晴らし台に接地した瞬間に発火し、中心が下へ 30 タイルまで流れ、2.5 秒で戻る', () => {
    let s = step(INITIAL_VIEW, { overlookCell: 0 });
    expect(s.mode).toBe('auto');
    expect(s.zoom).toBe(VIEW_ZOOM);
    expect(s.offsetY).toBeGreaterThan(0);
    for (let i = 0; i < 100; i++) s = step(s, { overlookCell: 0 }); // 約 1.7 秒
    expect(s.offsetY).toBeCloseTo(AUTO_FLOW_TILES, 3);
    expect(s.offsetX).toBe(0);
    for (let i = 0; i < 60; i++) s = step(s, { overlookCell: 0 }); // 計 2.68 秒
    expect(s.mode).toBe('none');
    expect(s.zoom).toBe(1);
    expect(s.offsetY).toBe(0);
  });
  it('同じ板では 2 回目は発火しない。発火済みより上の板でだけ発火', () => {
    let s = step(INITIAL_VIEW, { overlookCell: 0 });
    for (let i = 0; i < 200; i++) s = step(s, { overlookCell: 0 });
    expect(s.mode).toBe('none');
    s = step(s, { overlookCell: null, grounded: false });
    s = step(s, { overlookCell: 0 });
    expect(s.mode).toBe('none');
    s = step(s, { overlookCell: -1 });
    expect(s.mode).toBe('auto');
    for (let i = 0; i < 200; i++) s = step(s, { overlookCell: -1 });
    s = step(s, { overlookCell: 0 });
    expect(s.mode).toBe('none'); // 下へ戻っても再発火しない
  });
  it('新たに押された移動キーで打ち切る', () => {
    let s = step(INITIAL_VIEW, { overlookCell: 0 });
    s = step(s, { overlookCell: 0, moving: true, still: false });
    expect(s.mode).toBe('none');
  });
  it('押しっぱなしの移動キーでは打ち切らない(梯子から D のまま着地)', () => {
    let s = step(INITIAL_VIEW, { moving: true, still: false, grounded: false });
    s = step(s, { moving: true, still: false, overlookCell: 0 });
    expect(s.mode).toBe('auto');
    s = step(s, { moving: true, still: false, overlookCell: 0 });
    expect(s.mode).toBe('auto');
  });
  it('autoViewStarted は発火したフレームだけ true', () => {
    const s = step(INITIAL_VIEW, { overlookCell: 0 });
    expect(autoViewStarted(INITIAL_VIEW, s)).toBe(true);
    expect(autoViewStarted(s, step(s, { overlookCell: 0 }))).toBe(false);
  });
  it('決定論: 同じ入力列で同じ出力', () => {
    const run = () => {
      let s = INITIAL_VIEW;
      for (let i = 0; i < 50; i++) s = step(s, { overlookCell: 0, aimX: 0.3 });
      for (let i = 0; i < 50; i++) s = step(s, { shift: true, aimX: 0.3 });
      return s;
    };
    expect(run()).toEqual(run());
  });
});
