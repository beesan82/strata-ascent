import { describe, expect, it } from 'vitest';
import { Background, backgroundLayerContributions, farSilhouettes, rareLandmarkAt } from './background';
import { BIOMES, type BiomeBlend } from './biome';

class RecordingContext {
  globalAlpha = 1;
  strokeStyle: string | CanvasGradient = '';
  lineWidth = 1;
  readonly assignedFillStyles: string[] = [];
  private currentFillStyle: string | CanvasGradient = '';

  set fillStyle(value: string | CanvasGradient) {
    this.currentFillStyle = value;
    if (typeof value === 'string') this.assignedFillStyles.push(value);
  }

  get fillStyle(): string | CanvasGradient {
    return this.currentFillStyle;
  }

  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  stroke(): void {}
  arc(): void {}
  fillRect(): void {}
  createLinearGradient(): CanvasGradient {
    return { addColorStop: () => {} } as unknown as CanvasGradient;
  }
}

function testBlend(t: number): BiomeBlend {
  const from = BIOMES[0];
  const to = BIOMES[1];
  return {
    from,
    to,
    t,
    ambientColor: '#101820',
    ambientLevel: 0.5,
    palette: from.palette,
    accent: from.accent,
  };
}

describe('Background biome transitions', () => {
  it('cross-fades both complete layer sets while a biome blend is in progress', () => {
    const contributions = backgroundLayerContributions(testBlend(0.25));

    expect(contributions.filter(({ source }) => source === 'from')).toHaveLength(BIOMES[0].bgLayers.length);
    expect(contributions.filter(({ source }) => source === 'to')).toHaveLength(BIOMES[1].bgLayers.length);
    expect(new Set(contributions.map(({ opacity }) => opacity))).toEqual(new Set([0.75, 0.25]));
    expect(contributions.some(({ layer }) => layer.kind === 'haze')).toBe(true);
  });

  it('renders colors from both biomes at an interior blend point', () => {
    const ctx = new RecordingContext();
    new Background(42).render(
      ctx as unknown as CanvasRenderingContext2D,
      0,
      0,
      320,
      180,
      8,
      testBlend(0.5),
    );

    expect(ctx.assignedFillStyles).toContain(BIOMES[0].bgLayers[0].color);
    expect(ctx.assignedFillStyles).toContain(BIOMES[1].bgLayers[0].color);
  });
});

describe('farSilhouettes', () => {
  it('決定論: 同じ範囲・シードなら同じ配置', () => {
    expect(farSilhouettes(42, 0, 100000)).toEqual(farSilhouettes(42, 0, 100000));
  });
  it('広域で複数のシルエットが返る', () => {
    expect(farSilhouettes(42, 0, 200000).length).toBeGreaterThan(2);
  });
  it('各シルエットは種別・位置・大きさを持つ', () => {
    for (const s of farSilhouettes(42, 0, 200000)) {
      expect(['tower', 'dome', 'gantry', 'ring']).toContain(s.kind);
      expect(s.w).toBeGreaterThan(0);
      expect(s.h).toBeGreaterThan(0);
    }
  });
});

describe('rareLandmarkAt', () => {
  it('決定論', () => {
    expect(rareLandmarkAt(42, 5)).toEqual(rareLandmarkAt(42, 5));
  });
  it('稀少: 大半のスロットは null だが一部存在', () => {
    let present = 0;
    const N = 200;
    for (let i = 0; i < N; i++) if (rareLandmarkAt(42, i)) present++;
    expect(present).toBeGreaterThan(0);
    expect(present).toBeLessThan(N * 0.25);
  });
});
