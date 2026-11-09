import type { ConeParams } from './depthLight';

/**
 * バイオーム環境光+プレイヤー補助光。
 * 旧「闇を敷いて光で切り抜く」方式を廃止し、全体が見える明るい画面にする。
 */
export class Lighting {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private outW = 0;
  private outH = 0;

  resize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    this.canvas.width = Math.ceil(w / 2);
    this.canvas.height = Math.ceil(h / 2);
  }

  /**
   * ambientColor/ambientLevel: バイオーム環境光(levelが高いほど明るい=減光が薄い)。
   * px,py: プレイヤー画面座標、angle: 補助光の向き、ppt: 1タイルpx、timeSec: 揺らぎ。
   * 1) 画面全体を「(1-ambientLevel)に比例する薄いバイオーム色の暗幕」で覆う(全体は必ず見える)
   * 2) プレイヤー周囲と前方の暗幕を destination-out で消して局所的に明るく
   * 3) overlay があれば暗幕の「上」に加算する光(光柱など)を半解像度のこのキャンバスへ描かせる。
   *    暗幕と一緒に 1 回で主バッファへ乗るので、全画面の lighter パスを 1 つ節約できる
   *    (主バッファの拡大は最近傍なので縁は硬いまま)。overlay は (ctx, scale=0.5) を受け取る。
   * cone: 補助光のコーンの係数(depthLight.coneParams。懐中電灯モードで半径と中心の明るさが上がる)。
   */
  render(
    mainCtx: CanvasRenderingContext2D,
    px: number, py: number, angle: number, ppt: number, timeSec: number,
    ambientColor: string, ambientLevel: number,
    cone: ConeParams,
    overlay?: (ctx: CanvasRenderingContext2D, scale: number) => void,
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const hx = px / 2, hy = py / 2, hp = ppt / 2;

    // 1) 環境減光: (1-level) を上限0.62に抑える → 最も暗いバイオームでも世界は見える
    const dark = Math.min(0.62, (1 - ambientLevel) * 0.72);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = withAlpha(darken(ambientColor, 0.4), dark);
    ctx.fillRect(0, 0, w, h);

    // 2) プレイヤー補助光: 暗幕を局所的に消す
    ctx.globalCompositeOperation = 'destination-out';
    const flicker = 1 + 0.02 * Math.sin(timeSec * 6.3) + 0.012 * Math.sin(timeSec * 17.1);

    const ambientR = 9 * hp;
    const amb = ctx.createRadialGradient(hx, hy, 0, hx, hy, ambientR);
    amb.addColorStop(0, 'rgba(0,0,0,0.85)');
    amb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = amb;
    ctx.beginPath(); ctx.arc(hx, hy, ambientR, 0, Math.PI * 2); ctx.fill();

    const coneR = 22 * hp * flicker * cone.radiusMult;
    const half = 0.34;
    const coneGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, coneR);
    coneGrad.addColorStop(0, `rgba(0,0,0,${cone.centerAlpha})`);
    coneGrad.addColorStop(0.7, `rgba(0,0,0,${cone.midAlpha})`);
    coneGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, coneR, angle - half, angle + half); ctx.closePath(); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    // 3) 暗幕の上の加算光。premultiplied なこのキャンバスへ lighter で足すと、主バッファへの合成で
    //    scene×(1−暗幕−光α)+暗幕色+光 になる(光の α ぶんだけ下地が僅かに減るが、加算が勝つ)。
    overlay?.(ctx, 0.5);
    mainCtx.drawImage(this.canvas, 0, 0, this.outW, this.outH);
  }
}

function darken(hex: string, f: number): string {
  const p = parseInt(hex.slice(1), 16);
  const r = Math.round(((p >> 16) & 255) * f);
  const g = Math.round(((p >> 8) & 255) * f);
  const b = Math.round((p & 255) * f);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
function withAlpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}
