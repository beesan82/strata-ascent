import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawGravitonEffects, Renderer } from './renderer';

class FakeCanvasContext {
  imageSmoothingEnabled = true;
  fillStyle: string | CanvasGradient = '';

  createImageData(width: number, height: number): ImageData {
    return {
      data: new Uint8ClampedArray(width * height * 4),
      width,
      height,
      colorSpace: 'srgb',
    } as ImageData;
  }

  putImageData(): void {}
  fillRect(): void {}

  createRadialGradient(): CanvasGradient {
    return {
      addColorStop: () => {},
    } as unknown as CanvasGradient;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  readonly context = new FakeCanvasContext();

  getContext(): FakeCanvasContext {
    return this.context;
  }
}

class EffectRecordingContext {
  fillStyle: string | CanvasGradient = '';
  strokeStyle: string | CanvasGradient = '';
  lineWidth = 1;
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  radialGradients = 0;
  strokes = 0;
  translates: number[][] = [];
  fillRects: number[][] = [];

  save(): void {}
  restore(): void {}
  rotate(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}

  stroke(): void {
    this.strokes++;
  }

  translate(x: number, y: number): void {
    this.translates.push([x, y]);
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.fillRects.push([x, y, w, h]);
  }

  createRadialGradient(): CanvasGradient {
    this.radialGradients++;
    return { addColorStop: () => {} } as unknown as CanvasGradient;
  }
}

describe('Renderer pixel pipeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 34 horizontal tiles at 15 internal pixels per tile', () => {
    const offscreenCanvases: FakeCanvas[] = [];
    vi.stubGlobal('document', {
      createElement: () => {
        const canvas = new FakeCanvas();
        offscreenCanvases.push(canvas);
        return canvas;
      },
    });
    const screen = new FakeCanvas();
    const renderer = new Renderer(screen as unknown as HTMLCanvasElement, 20260711);

    renderer.resize(1280, 720);

    expect(
      offscreenCanvases.map(({ width, height }) => ({ width, height })),
    ).toContainEqual({ width: 427, height: 240 });
  });

  it('starts charge and beam at one supplied visual muzzle, with one gradient core and no additive blend', () => {
    const context = new EffectRecordingContext();
    const muzzle = { x: 41, y: 29 };

    drawGravitonEffects(
      context as unknown as CanvasRenderingContext2D,
      muzzle,
      {
        chargeRatio: 0.6,
        chargeFullT: 0,
        beam: { angle: -Math.PI / 4, alpha: 0.8 },
      },
      320,
      180,
      12,
      1.5,
    );

    // 溜めもビームも銃口を原点に描く(translate の最初は必ず銃口)
    expect(context.translates[0]).toEqual([muzzle.x, muzzle.y]);
    expect(context.translates).toContainEqual([muzzle.x, muzzle.y]);
    expect(context.fillRects.length).toBeGreaterThan(0);
    // 段階1 エフェクト: 放射グラデーションは球コアの 1 枚だけ。ratio 0.6 では電弧も出る。
    // 加算合成は内部バッファでは使わない(グローは present 後の overlay)
    expect(context.radialGradients).toBe(1);
    expect(context.strokes).toBeGreaterThan(0);
    expect(context.globalCompositeOperation).toBe('source-over');
  });

  it('draws nothing for the charge when the ratio is zero', () => {
    const context = new EffectRecordingContext();
    drawGravitonEffects(
      context as unknown as CanvasRenderingContext2D,
      { x: 10, y: 10 },
      { chargeRatio: 0, beam: null },
      320,
      180,
      12,
      0,
    );
    expect(context.radialGradients).toBe(0);
    expect(context.fillRects).toEqual([]);
  });
});
