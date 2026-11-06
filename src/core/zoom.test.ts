import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import {
  sampleOpenness,
  targetZoomForOpenness,
  MIN_ZOOM,
  MAX_ZOOM,
  OPENNESS_LO,
  OPENNESS_HI,
  quantizeZoom,
  ZOOM_STEPS,
  VIEW_ZOOM,
  nextZoomStep,
  advanceZoom,
  ZOOM_STEP_MARGIN,
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

describe('quantizeZoom', () => {
  it('許可段(ZOOM_STEPS)のいずれかを返す', () => {
    for (let z = 0.4; z <= 1.05; z += 0.03) {
      expect(ZOOM_STEPS).toContain(quantizeZoom(z));
    }
  });
  it('段そのものはその段を返す', () => {
    for (const s of ZOOM_STEPS) expect(quantizeZoom(s)).toBe(s);
  });
  it('最近傍段へスナップ', () => {
    expect(quantizeZoom(0.9)).toBe(1);
    expect(quantizeZoom(0.8)).toBe(0.75);
    expect(quantizeZoom(0.55)).toBe(0.5);
  });
  it('範囲外はクランプ(最小/最大段)', () => {
    expect(quantizeZoom(0.1)).toBe(Math.min(...ZOOM_STEPS));
    expect(quantizeZoom(2)).toBe(Math.max(...ZOOM_STEPS));
  });
  it('単調非減少', () => {
    let prev = quantizeZoom(0.4);
    for (let z = 0.4; z <= 1.05; z += 0.02) {
      const q = quantizeZoom(z);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
    }
  });
  it('段は [VIEW_ZOOM, MIN_ZOOM, ..., MAX_ZOOM]。0.35 は眺望専用', () => {
    expect(ZOOM_STEPS).toEqual([VIEW_ZOOM, 0.5, 0.75, 1]);
    expect(ZOOM_STEPS[1]).toBe(MIN_ZOOM);
    expect(ZOOM_STEPS[ZOOM_STEPS.length - 1]).toBe(MAX_ZOOM);
  });
  it('開放度由来の目標ズームは量子化しても 0.35 にならない', () => {
    for (let o = 0; o <= 1; o += 0.01) expect(quantizeZoom(targetZoomForOpenness(o))).toBeGreaterThanOrEqual(MIN_ZOOM);
  });
  it('段の中点は決定論的に低い段へ寄る(タイブレーク)', () => {
    expect(quantizeZoom(0.875)).toBe(0.75); // 0.75と1の等距離
    expect(quantizeZoom(0.625)).toBe(0.5); // 0.5と0.75の等距離
    expect(quantizeZoom(0.425)).toBe(VIEW_ZOOM); // 0.35と0.5の等距離
  });
});

describe('nextZoomStep(段キーパー、ヒステリシス付き段選択)', () => {
  // 0.75 と 1 の中点は 0.875。下りは中点−マージン、上りは中点+マージンが切替境界。
  const downThreshold = 0.875 - ZOOM_STEP_MARGIN;
  const upThreshold = 0.875 + ZOOM_STEP_MARGIN;

  it('段そのものを渡せばその段を維持する', () => {
    for (const s of ZOOM_STEPS) expect(nextZoomStep(s, s)).toBe(s);
  });

  it('中点+マージンを越えるまでは隣の段へ移らない(下り)', () => {
    expect(nextZoomStep(1, downThreshold + 0.001)).toBe(1);
    expect(nextZoomStep(1, downThreshold)).toBe(1); // 境界ちょうどは移らない(決定論)
    expect(nextZoomStep(1, downThreshold - 0.001)).toBe(0.75);
  });

  it('中点+マージンを越えるまでは隣の段へ移らない(上り)', () => {
    expect(nextZoomStep(0.75, upThreshold - 0.001)).toBe(0.75);
    expect(nextZoomStep(0.75, upThreshold)).toBe(0.75); // 境界ちょうどは移らない(決定論)
    expect(nextZoomStep(0.75, upThreshold + 0.001)).toBe(1);
  });

  it('中点±マージンの内側で小刻みに往復しても段がチャタリングしない', () => {
    // 0.875 を中心に ±0.02(マージン 0.03 の内側)を往復させる
    const wiggle = [0.855, 0.895, 0.86, 0.89, 0.865, 0.885];
    let fromTop = 1;
    let fromBottom = 0.75;
    for (let round = 0; round < 10; round++) {
      for (const z of wiggle) {
        fromTop = nextZoomStep(fromTop, z);
        fromBottom = nextZoomStep(fromBottom, z);
        expect(fromTop).toBe(1);
        expect(fromBottom).toBe(0.75);
      }
    }
  });

  it('大きく動けば複数段でも一気に追従する', () => {
    expect(nextZoomStep(1, 0.5)).toBe(0.5);
    expect(nextZoomStep(0.5, 1)).toBe(1);
    expect(nextZoomStep(0.35, 0.99)).toBe(1);
    // 0.4 は 0.35 と 0.5 の中点(0.425)−マージン(0.395)より上なので 0.5 で止まる
    expect(nextZoomStep(1, 0.4)).toBe(0.5);
    expect(nextZoomStep(1, 0.39)).toBe(VIEW_ZOOM);
  });

  it('結果は常に許可段のいずれか', () => {
    for (const cur of ZOOM_STEPS) {
      for (let z = 0.3; z <= 1.05; z += 0.01) {
        expect(ZOOM_STEPS).toContain(nextZoomStep(cur, z));
      }
    }
  });
});

describe('advanceZoom(描画ズームの滑らかな遷移)', () => {
  const DT = 1 / 60;

  it('目標段へ単調に近づき行き過ぎない', () => {
    let z = 1;
    let prev = z;
    for (let i = 0; i < 600; i++) {
      z = advanceZoom(z, 0.5, DT);
      expect(z).toBeLessThanOrEqual(prev);
      expect(z).toBeGreaterThanOrEqual(0.5);
      prev = z;
    }
    expect(z).toBe(0.5); // 最後は段へ正確にスナップして静止する
  });

  it('0.25 の段差は 1 秒以内に段へ落ち着く', () => {
    let z = 1;
    let frames = 0;
    while (z !== 0.75 && frames < 600) {
      z = advanceZoom(z, 0.75, DT);
      frames++;
    }
    expect(z).toBe(0.75);
    expect(frames).toBeLessThan(60);
  });

  it('眺望段(0.35)への出入りも同じ経路で滑らかに着く', () => {
    let z = 1;
    for (let i = 0; i < 600 && z !== VIEW_ZOOM; i++) z = advanceZoom(z, VIEW_ZOOM, DT);
    expect(z).toBe(VIEW_ZOOM);
    for (let i = 0; i < 600 && z !== 1; i++) z = advanceZoom(z, 1, DT);
    expect(z).toBe(1);
  });

  it('dt=0 では動かない', () => {
    expect(advanceZoom(0.8, 0.5, 0)).toBe(0.8);
  });

  it('すでに段にいれば段に留まる', () => {
    expect(advanceZoom(0.75, 0.75, DT)).toBe(0.75);
  });
});

it('HARD は閉塞として数える', () => {
  const all = (t: number) => sampleOpenness(() => t as Tile, 0, 0, 2, 1);
  expect(all(TILE.HARD)).toBe(0);
  expect(all(TILE.AIR)).toBe(1);
});
