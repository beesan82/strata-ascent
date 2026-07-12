import { mixHex } from './biome';

/**
 * コートの人影(霧亥風シルエット)を描く。
 * px/py: 体の中心の画面座標(px)、ppt: 1タイルのpx数、
 * facing: 1=右向き, -1=左向き、walkPhase: 歩行位相、aimAngle: ライト方向(ラジアン)、
 * ambientColor: バイオーム環境色(人影の色付け・リムライトに使う)
 */
export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  ppt: number,
  facing: 1 | -1,
  walkPhase: number,
  aimAngle: number,
  ambientColor: string,
): void {
  const s = ppt;
  const h = 1.75 * s;
  const bob = Math.sin(walkPhase) * 0.05 * s;

  // 基調のグレーを環境色へ寄せて、バイオームごとに人影を淡く色付けする。
  const headCol = mixHex('#b9bec5', ambientColor, 0.3);
  const coatCol = mixHex('#aab0b8', ambientColor, 0.3);
  const shadeCol = mixHex('#8f969e', ambientColor, 0.3);
  // 明かり側の輪郭を白く光らせるリムライト色。
  const rimCol = mixHex('#ffffff', ambientColor, 0.4);
  // 明かりの水平成分(反転前ローカルx)。正なら右側輪郭が光を受ける。
  const localLightX = Math.cos(aimAngle) * facing;

  ctx.save();
  ctx.translate(px, py + bob);
  ctx.scale(facing, 1);

  const headCx = 0.03 * s;
  const headCy = -h / 2 + 0.16 * s;
  const headR = 0.14 * s;

  // 頭(小さめ・やや前傾)
  ctx.fillStyle = headCol;
  ctx.beginPath();
  ctx.arc(headCx, headCy, headR, 0, Math.PI * 2);
  ctx.fill();

  // コート(肩から裾へ広がり、裾に切れ込み)
  ctx.fillStyle = coatCol;
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
  ctx.strokeStyle = shadeCol;
  ctx.lineWidth = Math.max(1, 0.04 * s);
  ctx.beginPath();
  ctx.moveTo(-0.16 * s, -h / 2 + 0.36 * s);
  ctx.lineTo(0.18 * s, -h / 2 + 0.36 * s);
  ctx.stroke();

  // リムライト: 明かり側(localLightX の符号)の頭・コート輪郭を明るくなぞる。
  ctx.strokeStyle = rimCol;
  ctx.lineWidth = Math.max(1, 0.05 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (localLightX >= 0) {
    ctx.arc(headCx, headCy, headR, -Math.PI * 0.5, Math.PI * 0.5);
    ctx.moveTo(0.22 * s, -h / 2 + 0.32 * s);
    ctx.lineTo(0.3 * s, h / 2);
  } else {
    ctx.arc(headCx, headCy, headR, Math.PI * 0.5, Math.PI * 1.5);
    ctx.moveTo(-0.2 * s, -h / 2 + 0.32 * s);
    ctx.lineTo(-0.28 * s, h / 2);
  }
  ctx.stroke();

  ctx.restore();

  // 腕(ライト方向。反転の影響を受けないようtranslateの外で描く)
  // save/restoreでstrokeStyle等の状態を隔離し、メインctxに残さない
  ctx.save();
  const ax = px;
  const ay = py - 0.35 * s + bob;
  ctx.strokeStyle = shadeCol;
  ctx.lineWidth = Math.max(1.5, 0.1 * s);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax + Math.cos(aimAngle) * 0.45 * s, ay + Math.sin(aimAngle) * 0.45 * s);
  ctx.stroke();
  ctx.restore();
}
