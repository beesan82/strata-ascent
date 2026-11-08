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
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  radialGradients = 0;
  translates: number[][] = [];
  fillRects: number[][] = [];

  save(): void {}
  restore(): void {}
  rotate(): void {}

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

  it('starts charge and beam at one supplied visual muzzle, with flat bands only', () => {
    const context = new EffectRecordingContext();
    const muzzle = { x: 41, y: 29 };

    drawGravitonEffects(
      context as unknown as CanvasRenderingContext2D,
      muzzle,
      {
        chargeRatio: 0.6,
        beam: { angle: -Math.PI / 4, alpha: 0.8 },
      },
      320,
      180,
      12,
    );

    // 溜めもビームも銃口を原点に描く(translate の最初は必ず銃口)
    expect(context.translates[0]).toEqual([muzzle.x, muzzle.y]);
    expect(context.translates).toContainEqual([muzzle.x, muzzle.y]);
    expect(context.fillRects.length).toBeGreaterThan(0);
    // 段階 3: 放射グラデーションと加算合成は使わない
    expect(context.radialGradients).toBe(0);
    expect(context.globalCompositeOperation).toBe('source-over');
  });
});
