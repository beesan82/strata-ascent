import { describe, expect, it } from 'vitest';
import { TILE } from '../world/tiles';
import {
  sampleOpenness,
  targetZoomForOpenness,
  MIN_ZOOM,
  MAX_ZOOM,
  OPENNESS_LO,
  OPENNESS_HI,
} from './zoom';

describe('sampleOpenness', () => {
  it('全AIRなら開放度1', () => {
    const openness = sampleOpenness(() => TILE.AIR, 0, 0, 5, 1);
    expect(openness).toBe(1);
  });

  it('全SOLIDなら開放度0', () => {
    const openness = sampleOpenness(() => TILE.SOLID, 0, 0, 5, 1);
    expect(openness).toBe(0);
  });

  it('LADDERは開放とみなす', () => {
    const openness = sampleOpenness(() => TILE.LADDER, 0, 0, 5, 1);
    expect(openness).toBe(1);
  });

  it('市松模様なら約0.5', () => {
    const tileAt = (x: number, y: number) => ((x + y) % 2 === 0 ? TILE.SOLID : TILE.AIR);
    const openness = sampleOpenness(tileAt, 0, 0, 10, 1);
    expect(openness).toBeGreaterThan(0.4);
    expect(openness).toBeLessThan(0.6);
  });

  // 回帰: 縦縞(周期2)を step=2 で測りながら水平に移動しても開放度が振動しない。
  // 旧実装は floor(cx)-r 起点でサンプル列の偶奇が1タイルごとに反転し、
  // 開放度が 0↔1 で往復→ズームがぐわんぐわん揺れた(移動時のカメラ酔いの主因)。
  it('縦縞をstep=2で横移動しても開放度が偶奇で振動しない', () => {
    const stripes = (x: number) => (x % 2 === 0 ? TILE.SOLID : TILE.AIR);
    const tileAt = (x: number) => stripes(x);
    let prev = sampleOpenness(tileAt, 0, 0, 10, 2);
    let maxJump = 0;
    for (let cx = 1; cx <= 20; cx++) {
      const cur = sampleOpenness(tileAt, cx, 0, 10, 2);
      maxJump = Math.max(maxJump, Math.abs(cur - prev));
      prev = cur;
    }
    // 固定格子アンカーなら1タイル移動あたりの変化は端の1列出入り分に限られる。
    // 旧実装ではここが ~1.0(0↔1の全反転)になっていた。
    expect(maxJump).toBeLessThan(0.2);
  });
});

describe('targetZoomForOpenness', () => {
  it('閉塞(LO以下)は標準ズーム', () => {
    expect(targetZoomForOpenness(OPENNESS_LO)).toBeCloseTo(MAX_ZOOM, 5);
    expect(targetZoomForOpenness(0)).toBeCloseTo(MAX_ZOOM, 5);
  });

  it('十分開放(HI以上)は最大ズームアウト', () => {
    expect(targetZoomForOpenness(OPENNESS_HI)).toBeCloseTo(MIN_ZOOM, 5);
    expect(targetZoomForOpenness(1)).toBeCloseTo(MIN_ZOOM, 5);
  });

  it('開放度が上がるほどズームは単調に小さくなる', () => {
    const a = targetZoomForOpenness(0.6);
    const b = targetZoomForOpenness(0.75);
    const c = targetZoomForOpenness(0.85);
    expect(a).toBeGreaterThanOrEqual(b);
    expect(b).toBeGreaterThanOrEqual(c);
  });

  it('範囲外入力でも[MIN_ZOOM, MAX_ZOOM]にクランプ', () => {
    expect(targetZoomForOpenness(-5)).toBe(MAX_ZOOM);
    expect(targetZoomForOpenness(5)).toBe(MIN_ZOOM);
  });
});
