import { FLYER_W, WALKER_H } from '../entities/enemy';
import { TURRET_H } from '../entities/turret';
import type { FlyerPose, TurretPose, WalkerPose } from './enemyPose';

/**
 * 通常敵(歩行敵・飛行ドローン・固定砲台)の描画(設計 2026-11-10-enemy-visuals-light-occlusion §2)。
 * renderer の fx 相乗りの中で呼ぶ(新しい描画パスは足さない)。平坦な矩形とパレット実在色だけで描き、
 * ポーズは enemyPose の純粋関数が決める。座標の引数 (sx, sy) は実体中心の内部バッファ座標、
 * 形の寸法はタイル単位で書いて ppt を掛け、整数 px に丸めて置く。
 * 2.19(設計 2026-11-12-action-overhaul §3)の大型化後も形の寸法は旧体格(0.9 四方)のまま書き、
 * renderer が ppt に体格比の倍率(*_DRAW_SCALE)を掛けて渡す。部位破壊は broken で描き分ける(§2)。
 */

/** 形の寸法を書いた基準の体格(タイル) */
const SPRITE_BASE = 0.9;
/** 歩行敵: 高さで合わせる(足が床、胴は幅 1.8 の箱の内側に収まる) */
export const WALKER_DRAW_SCALE = WALKER_H / SPRITE_BASE;
/** 飛行ドローン: 幅で合わせる(ローターの端が箱の左右に届く) */
export const FLYER_DRAW_SCALE = FLYER_W / SPRITE_BASE;
/** 固定砲台: 高さで合わせる(台座の下端が床) */
export const TURRET_DRAW_SCALE = TURRET_H / SPRITE_BASE;

/**
 * 中心 (sx, sy) からのタイル単位の矩形 [x0,x1]×[y0,y1] を塗る。dir=-1 なら x を左右反転する。
 * 端を個別に丸めるので隣り合う矩形の間に隙間や重なりができない。幅・高さは最低 1 px
 */
function rect(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, ppt: number,
  x0: number, y0: number, x1: number, y1: number, dir: 1 | -1 = 1,
): void {
  const a = sx + Math.min(x0 * dir, x1 * dir) * ppt;
  const b = sx + Math.max(x0 * dir, x1 * dir) * ppt;
  const l = Math.round(a);
  const t = Math.round(sy + y0 * ppt);
  ctx.fillRect(l, t, Math.max(1, Math.round(b) - l), Math.max(1, Math.round(sy + y1 * ppt) - t));
}

/** 線分 (x0,y0)→(x1,y1)(px)を一辺 th px の正方形を 1 px 刻みで並べて描く(回転なしの平坦色) */
function segment(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, th: number): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  const o = th / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ctx.fillRect(Math.round(x0 + (x1 - x0) * t - o), Math.round(y0 + (y1 - y0) * t - o), th, th);
  }
}

/**
 * 歩行敵: 錆の胴(上蓋・パネルライン・暗い腹帯)+ 背のセンサー + 進行方向側の暗いバイザーと
 * 発光する金の目(淡色の芯)+ 関節付きの 2 本脚(奥は暗く、手前は茶)。
 * 基準体格(0.9 四方)の寸法で書き、上半分強を胴、下 1/3 を脚にする。
 * legsBroken(脚破壊)は奥の脚を焦げた暗色で引きずり、その付け根に金の火花を明滅させる
 */
export function drawWalker(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, ppt: number,
  dir: 1 | -1, pose: WalkerPose, flash: boolean, legsBroken = false,
): void {
  const b = pose.bob;
  const legTh = Math.max(1, Math.round(0.1 * ppt));
  const hipY = 0.12 + b;
  // 脚(胴の後ろ)。奥の脚 → 手前の脚の順
  const legColors = [legsBroken ? '#16202b' : '#3d2618', '#5a3a24'];
  const hipXs = [-0.2, 0.2];
  for (let i = 0; i < 2; i++) {
    const leg = pose.legs[i];
    const hx = sx + hipXs[i] * dir * ppt;
    const hy = sy + hipY * ppt;
    const kx = hx + leg.knee.x * ppt;
    const ky = hy + leg.knee.y * ppt;
    const fx = hx + leg.foot.x * ppt;
    const fy = sy + (0.12 + leg.foot.y) * ppt; // 足は床基準(胴の上下動を足に乗せない)
    ctx.fillStyle = legColors[i];
    segment(ctx, hx, hy, kx, ky, legTh);
    segment(ctx, kx, ky, fx, fy, legTh);
    // 足の裏(進行方向へ少し長い平らな足)
    ctx.fillStyle = '#3d2618';
    const fw = Math.max(legTh, Math.round(0.14 * ppt));
    const fl = Math.round(fx - (dir > 0 ? 0.04 * ppt : fw - 0.04 * ppt));
    ctx.fillRect(fl, Math.round(fy - legTh / 2), fw, legTh);
  }
  const body = flash ? '#c7d0ce' : '#9a6d32';
  ctx.fillStyle = body;
  // 胴と上蓋(上蓋は後ろ寄り。前面はバイザーのために低くする)
  rect(ctx, sx, sy, ppt, -0.42, -0.34 + b, 0.42, 0.14 + b, dir);
  rect(ctx, sx, sy, ppt, -0.3, -0.42 + b, 0.24, -0.34 + b, dir);
  // 背のセンサー(細い柱 + 金の先端)
  ctx.fillStyle = '#3d2618';
  rect(ctx, sx, sy, ppt, -0.26, -0.56 + b, -0.2, -0.42 + b, dir);
  ctx.fillStyle = flash ? '#9a6d32' : '#caa64a';
  rect(ctx, sx, sy, ppt, -0.27, -0.6 + b, -0.19, -0.54 + b, dir);
  // 暗い腹帯とパネルライン(縦 1 本 + 後部の横 1 本)。alpha はボスの継ぎ目と同じ 0.9
  ctx.fillStyle = '#3d2618';
  rect(ctx, sx, sy, ppt, -0.42, 0.06 + b, 0.42, 0.14 + b, dir);
  ctx.globalAlpha = 0.9;
  rect(ctx, sx, sy, ppt, -0.14, -0.34 + b, -0.09, 0.06 + b, dir);
  rect(ctx, sx, sy, ppt, -0.42, -0.1 + b, -0.14, -0.05 + b, dir);
  ctx.globalAlpha = 1;
  // バイザー(進行方向側の暗い帯)と発光する目(金 + 淡色の芯)。フラッシュ中は色を反転して残す
  ctx.fillStyle = '#3d2618';
  rect(ctx, sx, sy, ppt, 0.02, -0.3 + b, 0.42, -0.12 + b, dir);
  ctx.fillStyle = flash ? '#9a6d32' : '#caa64a';
  rect(ctx, sx, sy, ppt, 0.18, -0.27 + b, 0.4, -0.16 + b, dir);
  if (!flash) {
    ctx.fillStyle = '#c7d0ce';
    rect(ctx, sx, sy, ppt, 0.32, -0.25 + b, 0.4, -0.18 + b, dir);
  }
  // 脚破壊: 壊れた奥の脚の付け根(腹帯の下)に火花。歩行位相で明滅する(時刻を使わず決定的)
  if (legsBroken && !flash && pose.phase < 0.35) {
    ctx.fillStyle = '#caa64a';
    rect(ctx, sx, sy, ppt, -0.26, 0.12 + b, -0.14, 0.2 + b, dir);
  }
}

/**
 * 飛行ドローン: 鋼の胴 + 暗い上帯 + 左右のローター(半透明の円盤 + 回転する羽根)+ 点滅する航行灯
 * (左は錆、右は緑)+ 下面の暗いドームとセンサーアイ(淡色、追尾中はプレイヤーを向く)+
 * 移動方向と逆に焚くスラスター(錆の外炎 + 金の芯)。
 * rotorBroken(ローター破壊)は円盤・羽根・スラスターを描かず、折れた柱と羽根の残骸だけを残す
 */
export function drawFlyer(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, ppt: number,
  pose: FlyerPose, flash: boolean, rotorBroken = false,
): void {
  if (rotorBroken) {
    // 折れたローターの柱(短い)と、左の柱に引っかかった羽根の切れ端
    ctx.fillStyle = '#16202b';
    rect(ctx, sx, sy, ppt, -0.28, -0.25, -0.23, -0.18);
    rect(ctx, sx, sy, ppt, 0.23, -0.23, 0.28, -0.18);
    rect(ctx, sx, sy, ppt, -0.38, -0.29, -0.22, -0.25);
  }
  // スラスター(胴の後ろ)。胴の縁から噴射の向きへ伸ばす
  if (!rotorBroken && pose.thrust > 0) {
    const th = Math.max(1, Math.round(0.12 * ppt));
    const ox = sx + pose.thrustX * 0.3 * ppt;
    const oy = sy + pose.thrustY * 0.2 * ppt;
    const len = (0.1 + 0.24 * pose.thrust) * ppt;
    ctx.fillStyle = '#9a6d32';
    segment(ctx, ox, oy, ox + pose.thrustX * len, oy + pose.thrustY * len, th);
    ctx.fillStyle = '#caa64a';
    segment(ctx, ox, oy, ox + pose.thrustX * len * 0.5, oy + pose.thrustY * len * 0.5, th);
  }
  if (!rotorBroken) {
    // ローターの柱
    ctx.fillStyle = '#16202b';
    rect(ctx, sx, sy, ppt, -0.28, -0.3, -0.23, -0.18);
    rect(ctx, sx, sy, ppt, 0.23, -0.3, 0.28, -0.18);
    // ローターの円盤(半透明の淡色の薄い帯)と羽根(見かけの長さが回転で伸び縮みする)
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = '#c7d0ce';
    rect(ctx, sx, sy, ppt, -0.46, -0.34, -0.06, -0.29);
    rect(ctx, sx, sy, ppt, 0.06, -0.34, 0.46, -0.29);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#16202b';
    const ba = 0.2 * pose.rotorA;
    const bb = 0.2 * pose.rotorB;
    rect(ctx, sx, sy, ppt, -0.26 - ba, -0.34, -0.26 + ba, -0.3);
    rect(ctx, sx, sy, ppt, 0.26 - bb, -0.34, 0.26 + bb, -0.3);
  }
  // 胴と暗い上帯
  ctx.fillStyle = flash ? '#c7d0ce' : '#51728d';
  rect(ctx, sx, sy, ppt, -0.34, -0.2, 0.34, 0.16);
  ctx.fillStyle = '#16202b';
  rect(ctx, sx, sy, ppt, -0.34, -0.2, 0.34, -0.12);
  // 航行灯(胴の左右の端)。消灯側は暗色
  ctx.fillStyle = pose.navOn ? '#9a6d32' : '#16202b';
  rect(ctx, sx, sy, ppt, -0.4, -0.04, -0.32, 0.04);
  ctx.fillStyle = pose.navOn ? '#3c755f' : '#16202b';
  rect(ctx, sx, sy, ppt, 0.32, -0.04, 0.4, 0.04);
  // 下面のセンサードームとアイ
  ctx.fillStyle = '#16202b';
  rect(ctx, sx, sy, ppt, -0.15, 0.16, 0.15, 0.32);
  const eye = Math.max(1, Math.round(0.1 * ppt));
  const ex = sx + pose.eyeX * 0.08 * ppt;
  const ey = sy + (0.24 + pose.eyeY * 0.04) * ppt;
  ctx.fillStyle = flash ? '#51728d' : '#c7d0ce';
  ctx.fillRect(Math.round(ex - eye / 2), Math.round(ey - eye / 2), eye, eye);
}

/**
 * 固定砲台: 2 段の台座(暗い足 + 暗青の首、鋲)+ 鋼の砲塔(上蓋・継ぎ目)+ 照準方向へ回る砲身
 * (発射直後に後退)+ 上蓋の警告灯(撃つ前に強まり、直前は白く灯って暈が出る)。
 * sensorBroken(センサー破壊)は警告灯の代わりに暗い割れ目と金の火花を描き、暈を出さない
 */
export function drawTurret(
  ctx: CanvasRenderingContext2D, sx: number, sy: number, ppt: number,
  angle: number, pose: TurretPose, flash: boolean, sensorBroken = false,
): void {
  // 台座: 足 + 首 + 鋲
  ctx.fillStyle = '#16202b';
  rect(ctx, sx, sy, ppt, -0.45, 0.32, 0.45, 0.45);
  ctx.fillStyle = '#2b355e';
  rect(ctx, sx, sy, ppt, -0.3, 0.16, 0.3, 0.32);
  ctx.fillStyle = '#51728d';
  rect(ctx, sx, sy, ppt, -0.4, 0.36, -0.34, 0.41);
  rect(ctx, sx, sy, ppt, 0.34, 0.36, 0.4, 0.41);
  // 砲塔と上蓋、継ぎ目
  ctx.fillStyle = flash ? '#c7d0ce' : '#51728d';
  rect(ctx, sx, sy, ppt, -0.36, -0.26, 0.36, 0.18);
  rect(ctx, sx, sy, ppt, -0.22, -0.38, 0.22, -0.26);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#16202b';
  rect(ctx, sx, sy, ppt, -0.36, 0.06, 0.36, 0.1);
  ctx.globalAlpha = 1;
  // 砲身: 旋回軸の基部 + 照準方向の太い線分。発射直後は軸の側へ後退する
  const pivotX = sx;
  const pivotY = sy - 0.06 * ppt;
  const th = Math.max(1, Math.round(0.2 * ppt));
  const len = (0.62 - 0.14 * pose.recoil) * ppt;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  ctx.fillStyle = '#16202b';
  rect(ctx, sx, sy, ppt, -0.13, -0.19, 0.13, 0.07);
  segment(ctx, pivotX, pivotY, pivotX + dx * len, pivotY + dy * len, th);
  // 砲口: 警告が強いほど熱を帯びる(錆 → 金)
  if (pose.warn > 0) {
    ctx.fillStyle = pose.warn >= 0.5 ? '#caa64a' : '#9a6d32';
    const mx = Math.round(pivotX + dx * len - th / 2);
    const my = Math.round(pivotY + dy * len - th / 2);
    ctx.fillRect(mx, my, th, th);
  }
  if (sensorBroken) {
    // 割れたセンサー: 上蓋を斜めに欠いた暗い割れ目 + 残った配線の火花
    ctx.fillStyle = '#16202b';
    rect(ctx, sx, sy, ppt, -0.1, -0.38, 0.12, -0.3);
    rect(ctx, sx, sy, ppt, 0.04, -0.3, 0.2, -0.26);
    if (!flash) {
      ctx.fillStyle = '#caa64a';
      rect(ctx, sx, sy, ppt, -0.04, -0.36, 0.02, -0.32);
    }
    return;
  }
  // 警告灯(上蓋の中央)。直前は暈(錆)を先に敷いてから白く灯す
  if (pose.halo) {
    ctx.fillStyle = '#9a6d32';
    rect(ctx, sx, sy, ppt, -0.14, -0.44, 0.14, -0.26);
  }
  ctx.fillStyle = pose.lightColor;
  rect(ctx, sx, sy, ppt, -0.08, -0.38, 0.08, -0.3);
}
