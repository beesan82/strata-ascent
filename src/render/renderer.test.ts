import { afterEach, describe, expect, it, vi } from 'vitest';
import { Renderer } from './renderer';

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

describe('Renderer pixel pipeline', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders 34 horizontal tiles at 12 internal pixels per tile', () => {
    vi.stubGlobal('document', {
      createElement: () => new FakeCanvas(),
    });
    const screen = new FakeCanvas();
    const renderer = new Renderer(screen as unknown as HTMLCanvasElement, 20260711);

    renderer.resize(1280, 720);

    const pipeline = (
      renderer as unknown as {
        pipeline: { bufW: number; bufH: number; scale: number };
      }
    ).pipeline;
    expect(pipeline).toMatchObject({
      bufW: 427,
      bufH: 240,
      scale: 3,
    });
  });
});
