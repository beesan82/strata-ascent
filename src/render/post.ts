/** フィルムグレイン+ビネット。グレインは世界と無関係な演出なので決定論不要 */
export class Post {
  private grains: HTMLCanvasElement[] = [];
  private vignette: HTMLCanvasElement | null = null;
  private frame = 0;

  constructor() {
    for (let i = 0; i < 3; i++) this.grains.push(makeGrain(256));
  }

  resize(w: number, h: number): void {
    const v = document.createElement('canvas');
    v.width = w;
    v.height = h;
    const ctx = v.getContext('2d')!;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.28)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    this.vignette = v;
  }

  /** ambientLevel(0..1): 明るいバイオームほどビネットを弱め、グレインは常に控えめ */
  render(ctx: CanvasRenderingContext2D, w: number, h: number, ambientLevel: number): void {
    this.frame++;
    const grain = this.grains[this.frame % this.grains.length];
    // グレインは明るい画面で目立つので従来の半分に抑える。
    ctx.globalAlpha = 0.025;
    for (let y = 0; y < h; y += grain.height) {
      for (let x = 0; x < w; x += grain.width) {
        ctx.drawImage(grain, x, y);
      }
    }
    // ビネットは暗いバイオームほど強く、明るいほど弱める(2.17 で地区の環境光が下がったので全体にやや強く出る)。
    ctx.globalAlpha = Math.max(0, Math.min(1, 1 - ambientLevel));
    if (this.vignette) ctx.drawImage(this.vignette, 0, 0);
    ctx.globalAlpha = 1;
  }
}

function makeGrain(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() > 0.5 ? 255 : 0;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 26;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
