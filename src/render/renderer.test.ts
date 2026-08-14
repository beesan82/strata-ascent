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
  globalAlpha = 1;
  globalCompositeOperation: GlobalCompositeOperation = 'source-over';
  lineCap: CanvasLineCap = 'butt';
  lineWidth = 1;
  radialGradients: number[][] = [];
  moveOrigins: number[][] = [];
  arcs: number[][] = [];

  save(): void {}
  restore(): void {}
  beginPath(): void {}
  lineTo(): void {}
  stroke(): void {}
  fill(): void {}

  moveTo(x: number, y: number): void {
    this.moveOrigins.push([x, y]);
  }

  arc(x: number, y: number, radius: number): void {
    this.arcs.push([x, y, radius]);
  }

  createRadialGradient(...args: number[]): CanvasGradient {
    this.radialGradients.push(args);
    return { addColorStop: () => {} } as unknown as CanvasGradient;
  }
}

describe('Renderer pixel pipeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 34 horizontal tiles at 12 internal pixels per tile', () => {
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

  it('starts charge, beam, and muzzle flash at one supplied visual muzzle', () => {
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
    );

    expect(context.moveOrigins).toEqual([
      [muzzle.x, muzzle.y],
      [muzzle.x, muzzle.y],
      [muzzle.x, muzzle.y],
    ]);
    expect(context.arcs).toHaveLength(2);
    for (const [x, y] of context.arcs) {
      expect({ x, y }).toEqual(muzzle);
    }
    expect(context.radialGradients).toHaveLength(2);
    for (const [x0, y0, , x1, y1] of context.radialGradients) {
      expect({ x: x0, y: y0 }).toEqual(muzzle);
      expect({ x: x1, y: y1 }).toEqual(muzzle);
    }
  });
});
