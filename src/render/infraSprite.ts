import { walkerPose, WALKER_HIP_TO_GROUND } from './enemyPose';

/**
 * インフラの描画(設計 2026-11-10-infrastructure): トラムのレール、昇降機の足場、トラムの車両、建設者、端末。
 * renderer の fx 相乗りの中で呼ぶ(新しい描画パスは足さない)。平坦な矩形とパレット実在色だけで描き、
 * lighter は使わない。座標はワールド(タイル)で受け、内部バッファ座標へ変換して整数 px に丸めて置く。
 * Math.random は使わない(点滅は時刻だけで決める)。
 */

export interface InfraFx {
  /** トラムのレール。[x0, x1) を床の行 y の上面に沿って細い帯で描く */
  rails: readonly { x0: number; x1: number; y: number }[];
  /** 昇降機の足場。x・w は上面の横の広がり、y は上面、cableY はシャフトの天井(綱の上端)、moving は動作中 */
  lifts: readonly { x: number; y: number; w: number; cableY: number; moving: boolean }[];
  /** トラムの車両。x は左端、y は屋根の上面(車体は床まで) */
  trams: readonly { x: number; y: number; w: number; h: number }[];
  /** 建設者。x・y は体の中心、dir は進行方向 */
  builders: readonly { x: number; y: number; w: number; h: number; dir: 1 | -1 }[];
  /** 端末。x は柱の中心、floorY は床の行、read は読んだ後(画面を暗くする) */
  terminals: readonly { x: number; floorY: number; read: boolean }[];
}

/** ワールド → 内部バッファの変換(renderer の renderCam と同じ式) */
export interface ScreenMap {
  camX: number;
  camY: number;
  w: number;
  h: number;
  ppt: number;
}

function sxOf(m: ScreenMap, wx: number): number {
  return (wx - m.camX) * m.ppt + m.w / 2;
}

function syOf(m: ScreenMap, wy: number): number {
  return (wy - m.camY) * m.ppt + m.h / 2;
}

/** ワールドの矩形 [x0, x1) × [y0, y1) を塗る(端を個別に丸める。最低 1 px) */
function wrect(ctx: CanvasRenderingContext2D, m: ScreenMap, x0: number, y0: number, x1: number, y1: number): void {
  const l = Math.round(sxOf(m, x0));
  const t = Math.round(syOf(m, y0));
  ctx.fillRect(l, t, Math.max(1, Math.round(sxOf(m, x1)) - l), Math.max(1, Math.round(syOf(m, y1)) - t));
}

/** 線分 (x0,y0)→(x1,y1)(px)を一辺 th px の正方形を 1 px 刻みで並べて描く(enemySprite と同じ) */
function segment(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, th: number): void {
  const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  const o = th / 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ctx.fillRect(Math.round(x0 + (x1 - x0) * t - o), Math.round(y0 + (y1 - y0) * t - o), th, th);
  }
}

/** 画面の外(余白 pad px)なら true */
function offscreen(m: ScreenMap, x0: number, y0: number, x1: number, y1: number, pad = 4): boolean {
  return sxOf(m, x1) < -pad || sxOf(m, x0) > m.w + pad || syOf(m, y1) < -pad || syOf(m, y0) > m.h + pad;
}

/** 建設者の脚の縮尺: 歩行敵の脚(腰から床 0.33)を建設者の腰から床(1.1)へ伸ばす */
const BUILDER_LEG_SCALE = 1.1 / WALKER_HIP_TO_GROUND;

export function drawInfra(ctx: CanvasRenderingContext2D, m: ScreenMap, fx: InfraFx, timeSec: number): void {
  const { ppt } = m;
  // レール: 床の上面に鋼の細い帯 1 本(床の焼き込みの上に乗るだけ。支柱なし)
  if (fx.rails.length > 0) {
    ctx.fillStyle = '#51728d';
    const th = Math.max(1, Math.round(0.08 * ppt));
    for (const r of fx.rails) {
      const l = Math.max(0, Math.round(sxOf(m, r.x0)));
      const rr = Math.min(m.w, Math.round(sxOf(m, r.x1)));
      const top = Math.round(syOf(m, r.y));
      if (rr <= l || top < -th || top > m.h + th) continue;
      ctx.fillRect(l, top - th, rr - l, th);
    }
  }

  // 端末: 細い柱 + 頭の笠 + 小さな画面(未読は緑 + 点滅する淡色のカーソル、既読は暗い緑)
  for (const t of fx.terminals) {
    const x = t.x;
    const fy = t.floorY;
    if (offscreen(m, x - 0.3, fy - 1.6, x + 0.3, fy)) continue;
    ctx.fillStyle = '#192633';
    wrect(ctx, m, x - 0.18, fy - 1.45, x + 0.18, fy);
    ctx.fillStyle = '#2b355e';
    wrect(ctx, m, x - 0.26, fy - 1.6, x + 0.26, fy - 1.45);
    wrect(ctx, m, x - 0.26, fy - 0.12, x + 0.26, fy);
    ctx.fillStyle = t.read ? '#24564d' : '#3c755f';
    wrect(ctx, m, x - 0.12, fy - 1.3, x + 0.12, fy - 0.95);
    if (!t.read && Math.floor(timeSec * 2) % 2 === 0) {
      ctx.fillStyle = '#c7d0ce';
      wrect(ctx, m, x - 0.08, fy - 1.05, x - 0.0, fy - 0.99);
    }
  }

  // 昇降機の足場: 綱(天井から足場の中央へ 1 px)+ 鋼の床板 + 暗い裏 + 中央の表示灯(動作中は金の点滅、停止中は緑)
  for (const l of fx.lifts) {
    if (offscreen(m, l.x, l.cableY, l.x + l.w, l.y + 0.5)) continue;
    const cx = l.x + l.w / 2;
    ctx.fillStyle = '#2b355e';
    const cl = Math.round(sxOf(m, cx));
    const ct = Math.round(syOf(m, l.cableY));
    const cb = Math.round(syOf(m, l.y));
    if (cb > ct) ctx.fillRect(cl, ct, 1, cb - ct);
    ctx.fillStyle = '#51728d';
    wrect(ctx, m, l.x, l.y, l.x + l.w, l.y + 0.28);
    ctx.fillStyle = '#192633';
    wrect(ctx, m, l.x, l.y + 0.28, l.x + l.w, l.y + 0.42);
    ctx.fillStyle = l.moving ? (Math.floor(timeSec * 4) % 2 === 0 ? '#caa64a' : '#9a6d32') : '#3c755f';
    wrect(ctx, m, cx - 0.12, l.y + 0.06, cx + 0.12, l.y + 0.2);
  }

  // トラムの車両: 淡色の屋根の帯(立てる面)+ 紺の車体 + 暗い窓帯に金の灯 3 つ + 暗い台枠と鋼の車輪
  for (const t of fx.trams) {
    const x0 = t.x;
    const x1 = t.x + t.w;
    const y0 = t.y;
    const y1 = t.y + t.h;
    if (offscreen(m, x0, y0, x1, y1)) continue;
    ctx.fillStyle = '#2b355e';
    wrect(ctx, m, x0, y0, x1, y1 - 0.4);
    ctx.fillStyle = '#c7d0ce';
    wrect(ctx, m, x0, y0, x1, y0 + 0.14);
    ctx.fillStyle = '#0d141c';
    wrect(ctx, m, x0 + 0.35, y0 + 0.4, x1 - 0.35, y0 + 0.95);
    ctx.fillStyle = '#caa64a';
    for (const wx of [0.9, 2.6, 4.3]) wrect(ctx, m, x0 + wx, y0 + 0.5, x0 + wx + 0.8, y0 + 0.85);
    ctx.fillStyle = '#16202b';
    wrect(ctx, m, x0 + 0.2, y1 - 0.4, x1 - 0.2, y1 - 0.15);
    ctx.fillStyle = '#51728d';
    wrect(ctx, m, x0 + 0.7, y1 - 0.25, x0 + 1.4, y1);
    wrect(ctx, m, x1 - 1.4, y1 - 0.25, x1 - 0.7, y1);
  }

  // 建設者: 関節脚(歩行敵の脚のポーズを縮尺して流用)+ 無骨な箱型の胴 + 黄の警戒帯 + 背の腕 + 前の作業灯
  for (const b of fx.builders) {
    const hw = b.w / 2;
    const hh = b.h / 2;
    if (offscreen(m, b.x - hw - 0.5, b.y - hh - 0.5, b.x + hw + 0.5, b.y + hh)) continue;
    const dir = b.dir;
    const sx = sxOf(m, b.x);
    const sy = syOf(m, b.y);
    const hipY = 0.15;
    const pose = walkerPose(b.x / BUILDER_LEG_SCALE, dir);
    const legTh = Math.max(1, Math.round(0.18 * ppt));
    const legColors = ['#16202b', '#2b355e'];
    const hipXs = [-0.55, 0.55];
    for (let i = 0; i < 2; i++) {
      const leg = pose.legs[i];
      const hx = sx + hipXs[i] * dir * ppt;
      const hy = sy + hipY * ppt;
      const kx = hx + leg.knee.x * BUILDER_LEG_SCALE * ppt;
      const ky = hy + leg.knee.y * BUILDER_LEG_SCALE * ppt;
      const fx2 = hx + leg.foot.x * BUILDER_LEG_SCALE * ppt;
      const fy = hy + leg.foot.y * BUILDER_LEG_SCALE * ppt;
      ctx.fillStyle = legColors[i];
      segment(ctx, hx, hy, kx, ky, legTh);
      segment(ctx, kx, ky, fx2, fy, legTh);
      ctx.fillStyle = '#16202b';
      const fw = Math.max(legTh, Math.round(0.4 * ppt));
      ctx.fillRect(Math.round(fx2 - fw / 2), Math.round(fy - legTh / 2), fw, legTh);
    }
    const bob = pose.bob * BUILDER_LEG_SCALE;
    const top = b.y - hh + bob;
    // 胴(箱)と暗い腹
    ctx.fillStyle = '#44518b';
    wrect(ctx, m, b.x - hw, top + 0.25, b.x + hw, b.y + 0.05 + bob);
    ctx.fillStyle = '#192633';
    wrect(ctx, m, b.x - hw, b.y - 0.1 + bob, b.x + hw, b.y + 0.2 + bob);
    // 警戒帯
    ctx.fillStyle = '#caa64a';
    wrect(ctx, m, b.x - hw, b.y - 0.32 + bob, b.x + hw, b.y - 0.2 + bob);
    // 背の腕(後ろ寄りの柱と前へ伸びる桁)
    ctx.fillStyle = '#2b355e';
    const back = b.x - dir * (hw - 0.35);
    wrect(ctx, m, Math.min(back, back - dir * 0.18), top - 0.05, Math.max(back, back - dir * 0.18), top + 0.25);
    const fore = b.x + dir * (hw - 0.1);
    wrect(ctx, m, Math.min(back, fore), top - 0.05, Math.max(back, fore), top + 0.08);
    // 前面の作業灯(淡色)と縁の暗い枠
    ctx.fillStyle = '#16202b';
    const lx0 = dir > 0 ? b.x + hw - 0.42 : b.x - hw + 0.12;
    wrect(ctx, m, lx0, top + 0.45, lx0 + 0.3, top + 0.75);
    ctx.fillStyle = '#c7d0ce';
    wrect(ctx, m, lx0 + 0.06, top + 0.51, lx0 + 0.24, top + 0.69);
  }
}
