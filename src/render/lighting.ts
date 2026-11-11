import { curtainAlpha, type ConeParams } from './depthLight';
import { circleRays, coneRays, CIRCLE_RAYS, CONE_RAYS, type SolidAt } from './lightRays';

/** 補助光(円)の半径(タイル) */
const AMBIENT_TILES = 9;
/** ライトコーンの半径(タイル、揺らぎと懐中電灯の倍率を掛ける前) */
const CONE_TILES = 22;
/** ライトコーンの半角(ラジアン) */
const CONE_HALF = 0.34;

/**
 * ライトの壁遮蔽の入力(設計 2026-11-10-enemy-visuals-light-occlusion §1)。
 * 渡すと補助光とコーンの消去形状が、レイを壁で止めた多角形になる
 */
export interface LightOcclusion {
  /** タイル座標が光を遮る固体か */
  solidAt: SolidAt;
  /** プレイヤー中心のワールド座標(タイル)。画面座標 px,py と同じ点 */
  wx: number;
  wy: number;
}

/**
 * バイオーム環境光+プレイヤー補助光。
 * 2.17(設計 2026-11-11-darkness-rework)で「暗いのが既定、光は例外」へ戻した。暗幕は濃いが
 * 上限(depthLight.CURTAIN_MAX)で止め、地形のシルエットは読める。
 */
export class Lighting {
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;
  private outW = 0;
  private outH = 0;
  /** レイの端点の作業配列(毎フレームの割り当てを避ける) */
  private circleBuf = new Float64Array(CIRCLE_RAYS * 2);
  private coneBuf = new Float64Array(CONE_RAYS * 2);

  resize(w: number, h: number): void {
    this.outW = w;
    this.outH = h;
    this.canvas.width = Math.ceil(w / 2);
    this.canvas.height = Math.ceil(h / 2);
  }

  /**
   * ambientColor/ambientLevel: バイオーム環境光(levelが高いほど明るい=減光が薄い)。
   * px,py: プレイヤー画面座標、angle: 補助光の向き、ppt: 1タイルpx、timeSec: 揺らぎ。
   * 1) 画面全体を「(1-ambientLevel)に比例するバイオーム色の暗幕」で覆う(上限 CURTAIN_MAX でシルエットは残る)
   * 2) プレイヤー周囲と前方の暗幕を destination-out で消して局所的に明るく
   * 3) overlay があれば暗幕の「上」に加算する光(光柱など)を半解像度のこのキャンバスへ描かせる。
   *    暗幕と一緒に 1 回で主バッファへ乗るので、全画面の lighter パスを 1 つ節約できる
   *    (主バッファの拡大は最近傍なので縁は硬いまま)。overlay は (ctx, scale=0.5) を受け取る。
   * cone: 補助光のコーンの係数(depthLight.coneParams。懐中電灯モードで半径と中心の明るさが上がる)。
   * occlusion: 壁遮蔽の入力。渡すと円とコーンの消去形状をレイで壁に遮った多角形にする
   *   (グラデーションは従来どおり中心からの放射で、多角形の内側だけを塗る)。無ければ従来の円と扇。
   */
  render(
    mainCtx: CanvasRenderingContext2D,
    px: number, py: number, angle: number, ppt: number, timeSec: number,
    ambientColor: string, ambientLevel: number,
    cone: ConeParams,
    overlay?: (ctx: CanvasRenderingContext2D, scale: number) => void,
    occlusion?: LightOcclusion,
  ): void {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const ctx = this.ctx;
    const hx = px / 2, hy = py / 2, hp = ppt / 2;

    // 1) 環境減光: (1-level) を上限 0.86 に抑える → 光の外は暗く、それでも地形のシルエットは読める
    const dark = curtainAlpha(ambientLevel);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = withAlpha(darken(ambientColor, 0.4), dark);
    ctx.fillRect(0, 0, w, h);

    // 2) プレイヤー補助光: 暗幕を局所的に消す
    ctx.globalCompositeOperation = 'destination-out';
    const flicker = 1 + 0.02 * Math.sin(timeSec * 6.3) + 0.012 * Math.sin(timeSec * 17.1);

    const ambientR = AMBIENT_TILES * hp;
    const amb = ctx.createRadialGradient(hx, hy, 0, hx, hy, ambientR);
    amb.addColorStop(0, 'rgba(0,0,0,0.85)');
    amb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = amb;
    ctx.beginPath();
    if (occlusion) {
      // 全周のレイの端点を結んだ多角形(壁の向こう・壁の中は消さない)
      const pts = circleRays(occlusion.wx, occlusion.wy, AMBIENT_TILES, CIRCLE_RAYS, occlusion.solidAt, this.circleBuf);
      this.tracePoints(pts, CIRCLE_RAYS, occlusion, hx, hy, hp);
      ctx.closePath();
    } else {
      ctx.arc(hx, hy, ambientR, 0, Math.PI * 2);
    }
    ctx.fill();

    const coneTiles = CONE_TILES * flicker * cone.radiusMult;
    const coneR = coneTiles * hp;
    const coneGrad = ctx.createRadialGradient(hx, hy, 0, hx, hy, coneR);
    coneGrad.addColorStop(0, `rgba(0,0,0,${cone.centerAlpha})`);
    coneGrad.addColorStop(0.7, `rgba(0,0,0,${cone.midAlpha})`);
    coneGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath(); ctx.moveTo(hx, hy);
    if (occlusion) {
      // 扇の範囲だけのレイ。中心から端点列をたどって中心へ戻る
      const pts = coneRays(occlusion.wx, occlusion.wy, coneTiles, angle, CONE_HALF, CONE_RAYS, occlusion.solidAt, this.coneBuf);
      this.tracePoints(pts, CONE_RAYS, occlusion, hx, hy, hp, true);
    } else {
      ctx.arc(hx, hy, coneR, angle - CONE_HALF, angle + CONE_HALF);
    }
    ctx.closePath(); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    // 3) 暗幕の上の加算光。premultiplied なこのキャンバスへ lighter で足すと、主バッファへの合成で
    //    scene×(1−暗幕−光α)+暗幕色+光 になる(光の α ぶんだけ下地が僅かに減るが、加算が勝つ)。
    overlay?.(ctx, 0.5);
    mainCtx.drawImage(this.canvas, 0, 0, this.outW, this.outH);
  }

  /**
   * レイの端点列(ワールドのタイル座標)を半解像度の画面座標へ写してパスに足す。
   * 端点はプレイヤー中心 (wx, wy) からの差分に 1 タイルの px(hp)を掛け、画面の中心 (hx, hy) へ置く。
   * cont=true は直前の moveTo(中心)から続けて lineTo する(扇)。false は最初の点で moveTo する(円)
   */
  private tracePoints(
    pts: Float64Array, n: number, occ: LightOcclusion, hx: number, hy: number, hp: number, cont = false,
  ): void {
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const x = hx + (pts[i * 2] - occ.wx) * hp;
      const y = hy + (pts[i * 2 + 1] - occ.wy) * hp;
      if (i === 0 && !cont) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
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
