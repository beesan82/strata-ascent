/**
 * 闇レイヤー。オフスクリーンCanvasを闇で塗り、光源部分をdestination-outで
 * 切り抜いてからメイン画面に重ねる。
 */
export class Lighting {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private outW = 0;
  private outH = 0;

  resize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    // 内部マスクは半解像度(拡大時のにじみでソフトエッジ、処理負荷も半減)
    this.canvas.width = Math.ceil(w / 2);
    this.canvas.height = Math.ceil(h / 2);
  }

  /**
   * px/py: プレイヤーの画面座標(ピクセル)、angle: ライト方向(ラジアン)、
   * ppt: 1タイルあたりのピクセル数(光の半径をタイル数で指定するため)、
   * timeSec: 経過秒(ライトの揺らぎ用)
   */
  render(
    mainCtx: CanvasRenderingContext2D,
    px: number,
    py: number,
    angle: number,
    ppt: number,
    timeSec: number,
  ): void {
    const { width: w, height: h } = this.canvas;
    const ctx = this.ctx;

    // 半解像度の内部座標系
    const hx = px / 2;
    const hy = py / 2;
    const hp = ppt / 2;
    // 微かな揺らぎ(携行ライトの息遣い)
    const flicker = 1 + 0.025 * Math.sin(timeSec * 6.3) + 0.015 * Math.sin(timeSec * 17.1);

    // ほぼ完全な闇を敷く
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.965)';
    ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'destination-out';

    // プレイヤー周囲の環境光(半径6タイル)
    const ambientR = 6 * hp * flicker;
    const ambient = ctx.createRadialGradient(hx, hy, 0, hx, hy, ambientR);
    ambient.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
    ambient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = ambient;
    ctx.beginPath();
    ctx.arc(hx, hy, ambientR, 0, Math.PI * 2);
    ctx.fill();

    // ライトの円錐(半径22タイル、半角0.32rad)
    const coneR = 22 * hp * flicker;
    const halfAngle = 0.32;
    const cone = ctx.createRadialGradient(hx, hy, 0, hx, hy, coneR);
    cone.addColorStop(0, 'rgba(0, 0, 0, 0.95)');
    cone.addColorStop(0.7, 'rgba(0, 0, 0, 0.5)');
    cone.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, coneR, angle - halfAngle, angle + halfAngle);
    ctx.closePath();
    ctx.fill();

    // 半解像度マスクを全体へ拡大してブリット
    mainCtx.drawImage(this.canvas, 0, 0, this.outW, this.outH);
  }
}
