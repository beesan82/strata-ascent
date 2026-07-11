/**
 * 闇レイヤー。オフスクリーンCanvasを闇で塗り、光源部分をdestination-outで
 * 切り抜いてからメイン画面に重ねる。
 */
export class Lighting {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
  }

  /**
   * px/py: プレイヤーの画面座標(ピクセル)、angle: ライト方向(ラジアン)、
   * ppt: 1タイルあたりのピクセル数(光の半径をタイル数で指定するため)
   */
  render(mainCtx: CanvasRenderingContext2D, px: number, py: number, angle: number, ppt: number): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;

    // ほぼ完全な闇を敷く
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.965)';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'destination-out';

    // プレイヤー周囲の環境光(半径6タイル)
    const ambientR = 6 * ppt;
    const ambient = ctx.createRadialGradient(px, py, 0, px, py, ambientR);
    ambient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ambient;
    ctx.beginPath();
    ctx.arc(px, py, ambientR, 0, Math.PI * 2);
    ctx.fill();

    // ライトの円錐(半径22タイル、半角0.32rad)
    const coneR = 22 * ppt;
    const halfAngle = 0.32;
    const cone = ctx.createRadialGradient(px, py, 0, px, py, coneR);
    cone.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    cone.addColorStop(0.7, 'rgba(0, 0, 0, 0.5)');
    cone.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, coneR, angle - halfAngle, angle + halfAngle);
    ctx.closePath();
    ctx.fill();

    mainCtx.drawImage(this.canvas, 0, 0);
  }
}
