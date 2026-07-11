/**
 * コートの人影(霧亥風シルエット)を描く。
 * px/py: 体の中心の画面座標(px)、ppt: 1タイルのpx数、
 * facing: 1=右向き, -1=左向き、walkPhase: 歩行位相、aimAngle: ライト方向(ラジアン)
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ppt: number,
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
): void {
  const s = ppt;
  const h = 1.75 * s;
  const bob = Math.sin(walkPhase) * 0.05 * s;

  ctx.save();
  ctx.translate(px, py + bob);
  ctx.scale(facing, 1);

  // 頭(小さめ・やや前傾)
  ctx.fillStyle = '#b9bec5';
  ctx.beginPath();
  ctx.arc(0.03 * s, -h / 2 + 0.16 * s, 0.14 * s, 0, Math.PI * 2);
  ctx.fill();

  // コート(肩から裾へ広がり、裾に切れ込み)
  ctx.fillStyle = '#aab0b8';
  ctx.beginPath();
  ctx.moveTo(-0.2 * s, -h / 2 + 0.32 * s);
  ctx.lineTo(0.22 * s, -h / 2 + 0.32 * s);
  ctx.lineTo(0.3 * s, h / 2);
  ctx.lineTo(0.08 * s, h / 2);
  ctx.lineTo(0.03 * s, h / 2 - 0.45 * s);
  ctx.lineTo(-0.03 * s, h / 2 - 0.45 * s);
  ctx.lineTo(-0.09 * s, h / 2);
  ctx.lineTo(-0.28 * s, h / 2);
  ctx.closePath();
  ctx.fill();

  // 襟の影
  ctx.strokeStyle = '#8f969e';
  ctx.lineWidth = Math.max(1, 0.04 * s);
  ctx.beginPath();
  ctx.moveTo(-0.16 * s, -h / 2 + 0.36 * s);
  ctx.lineTo(0.18 * s, -h / 2 + 0.36 * s);
  ctx.stroke();

  ctx.restore();

  // 腕(ライト方向。反転の影響を受けないようtranslateの外で描く)
  // save/restoreでstrokeStyle等の状態を隔離し、メインctxに残さない
  ctx.save();
  const ax = px;
  const ay = py - 0.35 * s + bob;
  ctx.strokeStyle = '#8f969e';
  ctx.lineWidth = Math.max(1.5, 0.1 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + Math.cos(aimAngle) * 0.45 * s, ay + Math.sin(aimAngle) * 0.45 * s);
  ctx.stroke();
  ctx.restore();
}
