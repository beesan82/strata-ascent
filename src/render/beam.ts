/**
 * 重力子砲の演出描画(状態を持たない純粋なヘルパ)。
 * すべて画面座標で描く。呼び出し側で save/restore は完結させる。
 */

/**
 * プレイヤー画面座標 (px,py) から angle 方向へ伸びる極太の白い貫通ビーム。
 * 明るいコア + 柔らかい外縁 + 銃口フラッシュ。alpha(0..1)で減衰。
 */
export function drawBeam(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, angle: number, lengthPx: number, alpha: number,
): void {
  const ex = px + Math.cos(angle) * lengthPx;
  const ey = py + Math.sin(angle) * lengthPx;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
  ctx.lineCap = 'round';

  // 外縁(柔らかい青いにじみ)→ 中間 → 白いコア、と重ねて発光感を出す
  const layers: Array<[number, string]> = [
    [30, 'rgba(90,160,255,0.35)'],
    [16, 'rgba(170,215,255,0.7)'],
    [6, 'rgba(255,255,255,1)'],
  ];
  for (const [width, color] of layers) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(ex, ey);
    ctx.stroke();
  }

  // 銃口フラッシュ
  const r = 40;
  const flash = ctx.createRadialGradient(px, py, 0, px, py, r);
  flash.addColorStop(0, 'rgba(255,255,255,0.95)');
  flash.addColorStop(0.4, 'rgba(160,205,255,0.6)');
  flash.addColorStop(1, 'rgba(90,160,255,0)');
  ctx.fillStyle = flash;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * 溜め中に銃口へ集まる発光。ratio(0..1)で半径・輝度が増す。
 */
export function drawCharge(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, ratio: number,
): void {
  const t = Math.max(0, Math.min(1, ratio));
  const r = 7 + t * 30;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(px, py, 0, px, py, r);
  g.addColorStop(0, `rgba(255,255,255,${0.45 + 0.45 * t})`);
  g.addColorStop(0.5, `rgba(150,200,255,${0.4 * t})`);
  g.addColorStop(1, 'rgba(90,160,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
