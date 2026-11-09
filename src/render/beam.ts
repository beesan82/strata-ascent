/**
 * 重粒子砲の演出描画(状態を持たない純粋なヘルパ)。
 * すべて画面座標で描く。呼び出し側で save/restore は完結させる。
 * ビーム本体は段階 3(設計 §5.1)のとおりパレット実在色の階段状の帯(矩形)だけで構成する。
 * 溜めは段階1 エフェクト設計 §2 で「リアル寄せ」に作り替えた: 収束パーティクル・放射グラデーションの
 * 球コア・電弧・完了リング(in-buffer)と、present 後のグロー(表示解像度、lighter 1 枚)。
 * 形はすべて beamShape の純粋関数が決める。
 */
import {
  beamBands, chargeArcs, chargeCore, chargeGlow, chargeParticles, chargeRing, muzzleFlash,
} from './beamShape';

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
 * 溜めの表現(内部バッファ側)。銃口 (px,py) を原点に、
 *   1. 収束パーティクル(小矩形。外から銃口へ吸い込まれる。個数・速さは ratio 比例)
 *   2. 球コア(放射グラデーション 白→溜め段の色→透明。四角は廃止)
 *   3. 電弧(ratio >= 0.6。稲妻型の折れ線を数本、時間量子化ハッシュで形が変わる)
 *   4. 完了リング(ratio が 1 に達してから fullT 秒、小さく広がりながら速く消える 2 重ストローク)
 * の順に重ねる。加算合成は使わない(グローは present 後の drawChargeGlow)。
 * ratio(0..1)は溜め比率、fullT は満タンからの経過秒、timeSec は演出の時刻。
 */
export function drawCharge(
  ctx: CanvasRenderingContext2D,
  px: number, py: number, ratio: number, fullT: number, timeSec: number,
): void {
  const t = Math.max(0, Math.min(1, ratio));
  ctx.save();
  ctx.translate(px, py);

  // 1. 収束パーティクル: 整数 px に置く小矩形(平坦色・パレット実在色)
  for (const p of chargeParticles(t, timeSec)) {
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.dx - p.size / 2), Math.round(p.dy - p.size / 2), p.size, p.size);
  }

  // 2. 球コア: 放射グラデーション 1 枚(半径ぶんの正方形を塗る。端は透明)
  const core = chargeCore(t);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, core.radius);
  for (const s of core.stops) grad.addColorStop(s.offset, s.color);
  ctx.globalAlpha = core.alpha;
  ctx.fillStyle = grad;
  ctx.fillRect(-core.radius, -core.radius, core.radius * 2, core.radius * 2);

  // 3. 電弧: 1 px の稲妻型折れ線(半径方向へ進みつつ垂直に鋭く振れる)。色は白〜鋼
  const arcs = chargeArcs(t, timeSec);
  if (arcs.length > 0) {
    ctx.lineWidth = 1;
    for (const arc of arcs) {
      ctx.globalAlpha = arc.alpha;
      ctx.strokeStyle = arc.color;
      ctx.beginPath();
      ctx.moveTo(arc.points[0].x, arc.points[0].y);
      for (let i = 1; i < arc.points.length; i++) ctx.lineTo(arc.points[i].x, arc.points[i].y);
      ctx.stroke();
    }
  }

  // 4. 完了リング: 満タン直後だけ広がる小さな衝撃波。
  //    細い 1 本線だと「泡」に見えるので、太い低 alpha の帯(溜め段の金)の上に細い高 alpha の芯(白)を
  //    重ねた 2 重ストロークにして柔らかい衝撃波にする。alpha は chargeRing 側で (1-p)^2 の速い減衰
  const ring = chargeRing(t, fullT);
  if (ring) {
    ctx.strokeStyle = '#caa64a';
    ctx.globalAlpha = ring.alpha * 0.35;
    ctx.lineWidth = ring.width + 3;
    ctx.beginPath();
    ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#c7d0ce';
    ctx.globalAlpha = ring.alpha;
    ctx.lineWidth = ring.width;
    ctx.beginPath();
    ctx.arc(0, 0, ring.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * present 後のグロー(設計 §2-5)。表示解像度の画面コンテキストへ、銃口の表示座標 (sx,sy) を中心に
 * 放射グラデーションの光暈を 'lighter' で 1 枚だけ重ねる。量子化バッファでは出せない滑らかな
 * 光暈を、量子化の外側で足す。scale は内部バッファ→画面の整数倍率(半径の換算用)。
 */
export function drawChargeGlow(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, scale: number, ratio: number, fullT: number,
): void {
  const glow = chargeGlow(ratio, fullT);
  if (!glow) return;
  const r = glow.radius * scale;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = glow.alpha;
  const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
  grad.addColorStop(0, 'rgba(255,240,205,1)');
  grad.addColorStop(0.3, 'rgba(202,166,74,0.55)');
  grad.addColorStop(1, 'rgba(202,166,74,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  ctx.restore();
}
