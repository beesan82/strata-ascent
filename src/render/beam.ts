/**
 * 重粒子砲の演出描画(状態を持たない純粋なヘルパ)。
 * すべて画面座標で描く。呼び出し側で save/restore は完結させる。
 * 段階 3(設計 §5.1): 放射グラデーションと 'lighter' 加算は廃止し、パレット実在色の
 * 階段状の帯(矩形)だけで構成する。帯の形は beamShape の純粋関数が決める。
 */
import { beamBands, chargeColor, chargeSegment, CHARGE_SEGMENTS, muzzleFlash } from './beamShape';

/**
 * プレイヤー画面座標 (px,py) から angle 方向へ伸びる貫通ビーム。
 * 外帯(錆)→熱帯(金)→中帯(鋼)→芯(白)の帯を重ね、太さと明度が時間で痩せる。
 * alpha(0..1)は残り寿命比。ppt は px/タイル(帯幅の換算用)。
 */
export function drawBeam(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, angle: number, lengthPx: number, alpha: number, ppt: number,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  for (const band of beamBands(alpha)) {
    const w = Math.max(1, band.width * ppt);
    ctx.globalAlpha = band.alpha;
    ctx.fillStyle = band.color;
    ctx.fillRect(0, -w / 2, lengthPx, w);
  }
  // 銃口の閃光: 短い矩形が数フレームで縮む(放射グラデーションの置き換え)
  const flash = muzzleFlash(alpha);
  if (flash) {
    const fw = Math.max(1, flash.width * ppt);
    ctx.globalAlpha = flash.alpha * 0.85;
    ctx.fillStyle = '#caa64a';
    ctx.fillRect(0, -fw / 2, flash.length * ppt, fw);
    const cw = Math.max(1, fw * 0.45);
    ctx.globalAlpha = flash.alpha;
    ctx.fillStyle = '#c7d0ce';
    ctx.fillRect(0, -cw / 2, flash.length * ppt * 0.72, cw);
  }
  ctx.restore();
}

/**
 * 溜めの表現: 銃口へ収束する短い帯 6 本 + 中心の芯。
 * 色は溜めの段階で鋼→錆→金と切り替わり、完了手前で芯が白になる。
 * ratio(0..1)で収束と色段が進む。
 */
export function drawCharge(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, ratio: number,
): void {
  const t = Math.max(0, Math.min(1, ratio));
  ctx.save();
  ctx.translate(px, py);
  ctx.fillStyle = chargeColor(t);
  ctx.globalAlpha = 0.35 + 0.65 * t;
  for (let i = 0; i < CHARGE_SEGMENTS; i++) {
    const seg = chargeSegment(t, i);
    ctx.save();
    ctx.rotate(seg.angle);
    ctx.fillRect(seg.dist, -seg.width / 2, seg.len, seg.width);
    ctx.restore();
  }
  const core = 2 + 4 * t;
  ctx.globalAlpha = 0.5 + 0.5 * t;
  ctx.fillStyle = t >= 0.8 ? '#c7d0ce' : chargeColor(t);
  ctx.fillRect(-core / 2, -core / 2, core, core);
  ctx.restore();
}
