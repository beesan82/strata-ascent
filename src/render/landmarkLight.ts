import { biomeCellAt, biomeIdForCell } from '../world/biomeCells';
import { GRAND_VISTA_REACH, GRAND_VISTA_ROWS, grandLampAt, grandShaftsNear } from '../world/grandShaft';
import { PASSAGE_SLOT } from '../world/interface';
import { isTowerFamily, landmarkAt, rampTopY, type Landmark } from '../world/landmark';
import { hash2 } from '../world/noise';
import { REST_HEIGHT, restPointAt } from '../world/restpoint';
import { beaconPulse } from './beacon';
import { biomeForCell, mixHex } from './biome';
import { GRAND_REST_COLOR, grandLampColor, grandVistaColor } from './grandShaftColors';
import { HALO_RAYS, LAMP_HALO_RAYS, type ColumnDir, type SolidAt } from './lightRays';
import { castColumns, fillLitRect, fillPointLit, fillWorldRect, rectOnScreen, type LightView } from './occludedFill';

/**
 * 大構造の固有の光(設計書 §6.2、ゾーン化 段階 2 で地区変種の光へ拡張)と休憩点の暖色(§6.3)。
 * 色は地区の accent を使う: 冷却塔=青い光柱、変圧塔=放電の明滅、煙突塔=常時点灯の熱光、
 * 椎骨柱=脈打つ淡紫。崩落は裂け目からの光条。大桁橋・吹き抜けホールは無光(構造そのものが顔)。
 * 幾何は純粋関数 landmarkLightsInView が平坦な矩形(ワールド座標)として返し、LandmarkLights が
 * Lighting の半解像度 overlay へ lighter で塗るだけ。新しい描画パスは足さず、色数も矩形 1 枚 1 色。
 * 枚数は標準ズームで塔系 2〜3・崩落 3・休憩点 1 程度。眺望(0.35)で休憩点が複数入ると、段階5 の灯
 * (ambient.ts、1 灯 2 枚)を合わせて 10〜20 枚になるが、1 枚は 1〜3 タイル(0.35 では 1 px 前後)で
 * lighter の画素数は小さい(段階2 の性能ルールの範囲内)。
 */

/** 変圧塔の放電: 判定の頻度(回/秒)と点灯率。hash で不規則に明滅する */
export const DISCHARGE_RATE = 9;
export const DISCHARGE_DUTY = 0.3;
/** 冷却塔の光柱の高さ(頂部から上へ)とアルファ */
export const COOLING_BEAM_HEIGHT = 48;
const COOLING_BEAM_ALPHA = 0.08;
/** 塔系の頂部の灯のアルファと暈のアルファ */
const TOWER_LAMP_ALPHA = 0.7;
const TOWER_HALO_ALPHA = 0.12;
/**
 * 裂け目の光条の基準アルファ(3 本: 1, 0.75, 0.5 倍)。光柱の芯(0.1 × 1.4 に縁 0.75 が重なる)と同程度。
 * 0.08 では暗幕と量子化の後に帯が見えなかった(スクリーンショットで確認)。帯は重ねないので 1 枚 1 色のまま
 */
export const RIFT_ALPHA = 0.22;
/** 光条の中心位置(裂け目の幅に対する割合)と幅(割合) */
const RIFT_RAY_POS = [0.15, 0.35, 0.55] as const;
const RIFT_RAY_WIDTH = 0.1;
/** 光条の上端: 板の上面からこれだけ上(上の層から差し込む) */
const RIFT_RAY_TOP = 6;
/** 休憩点の暖色とそのアルファ(箱の内側に 1 枚)。0.1 では箱全体が橙の塊になり灯の暈が読めなかった */
export const REST_WARM_COLOR = '#d8903a';
export const REST_WARM_ALPHA = 0.05;

/**
 * 休憩点の灯の色(ゾーン化 段階 3、設計 §4.2)。暖色を基準に、その地区の accent へ
 * 半分寄せる。箱の暖色矩形と、焼き込み側の灯の暈(chunkbake)が同じ色を共有する。
 */
export function restLampColor(seed: number, cell: number): string {
  return mixHex(REST_WARM_COLOR, biomeForCell(seed, cell).accent, 0.5);
}

/**
 * 光の矩形の壁遮蔽(設計 2026-11-11-light-occlusion-ambient §1)。
 * column: 縦の平行光。dir の向きへ列ごとにレイを飛ばし、地形で止める。from は光の入口の Y
 *   (未指定は矩形の上端(down)・下端(up))。入口から矩形までの間の地形でも止まる。
 * point: 点光源 (x, y) の暈。全周 rays 本のレイで壁に遮った多角形の内側だけを塗る。
 */
export type LightOccl =
  | { kind: 'column'; dir: ColumnDir; from?: number }
  | { kind: 'point'; x: number; y: number; rays: number };

/** ワールド座標(タイル)の平坦な矩形 [x0,x1)×[y0,y1) */
export interface LightRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  alpha: number;
  color: string;
  /** 壁遮蔽。未指定は遮蔽しない(灯そのもの=光源の点) */
  occl?: LightOccl;
}

/** 変圧塔の放電の明滅。時刻を DISCHARGE_RATE で量子化し hash で決める(不規則・決定論) */
export function dischargeOn(timeSec: number, k: number): boolean {
  return hash2(9177, Math.floor(timeSec * DISCHARGE_RATE), k) < DISCHARGE_DUTY;
}

/** 塔系の頂部の光。色は地区の accent(設計 §2.3 ③: 変種ごとの光) */
function towerFamilyLights(seed: number, lm: Landmark, timeSec: number, out: LightRect[]): void {
  const color = biomeForCell(seed, lm.cell).accent;
  // 灯(2×1 タイル)と暈(6×3)。頂部の開口(top−8..top)のすぐ上に浮かぶ
  const y = lm.top - 8;
  // 壁遮蔽(2.16 §1): 暈は灯の中心からの全周レイで、光柱は灯の行から上向きの平行光で地形に止める。
  // 灯そのもの(2×1)は光源の点なので遮蔽しない
  const halo: LightOccl = { kind: 'point', x: lm.x, y: y - 0.5, rays: HALO_RAYS };
  if (lm.kind === 'cooling') {
    // 青い光柱が頂部から上へ伸びる + 灯と暈
    out.push({ x0: lm.x - 2, y0: lm.top - COOLING_BEAM_HEIGHT, x1: lm.x + 2, y1: y, alpha: COOLING_BEAM_ALPHA, color, occl: { kind: 'column', dir: 'up' } });
    out.push({ x0: lm.x - 1, y0: y - 1, x1: lm.x + 1, y1: y, alpha: TOWER_LAMP_ALPHA, color });
    out.push({ x0: lm.x - 3, y0: y - 3, x1: lm.x + 3, y1: y, alpha: TOWER_HALO_ALPHA, color, occl: halo });
  } else if (lm.kind === 'transformer') {
    if (!dischargeOn(timeSec, lm.k)) return;
    out.push({ x0: lm.x - 1, y0: y - 1, x1: lm.x + 1, y1: y, alpha: 0.8, color });
    out.push({ x0: lm.x - 4, y0: y - 4, x1: lm.x + 4, y1: y, alpha: 0.16, color, occl: halo });
  } else if (lm.kind === 'chimney') {
    // 熱光は常時点灯
    out.push({ x0: lm.x - 1, y0: y - 1, x1: lm.x + 1, y1: y, alpha: TOWER_LAMP_ALPHA, color });
    out.push({ x0: lm.x - 3, y0: y - 3, x1: lm.x + 3, y1: y, alpha: TOWER_HALO_ALPHA + 0.02, color, occl: halo });
  } else {
    // 椎骨柱: 脈打つ淡紫(beaconPulse に相乗り)
    const pulse = beaconPulse(timeSec);
    out.push({ x0: lm.x - 1, y0: y - 1, x1: lm.x + 1, y1: y, alpha: 0.5 * pulse, color });
    out.push({ x0: lm.x - 3, y0: y - 3, x1: lm.x + 3, y1: y, alpha: 0.08 * pulse, color, occl: halo });
  }
}

function collapseLights(seed: number, lm: Landmark, timeSec: number, out: LightRect[]): void {
  const width = lm.gapRight - lm.gapLeft;
  const color = biomeForCell(seed, lm.cell - 1).accent; // 光は上の層から来る
  const pulse = beaconPulse(timeSec);
  RIFT_RAY_POS.forEach((pos, i) => {
    const cx = lm.gapLeft + Math.round(width * pos);
    const half = Math.round((width * RIFT_RAY_WIDTH) / 2);
    const x0 = cx - half;
    const x1 = cx + half;
    // 光条は上の層から差し込む平行光: 上端から下へ、地形(斜路の手前の瓦礫など)で止める(2.16 §1)
    out.push({ x0, y0: lm.top - RIFT_RAY_TOP, x1, y1: rampTopY(lm, Math.floor((x0 + x1) / 2)), alpha: RIFT_ALPHA * (1 - 0.25 * i) * pulse, color, occl: { kind: 'column', dir: 'down' } });
  });
}

/**
 * 視野(camX ± spanX/2, camY ± spanY/2)に掛かる大構造の光と休憩点の暖色。
 * 塔系は変種ごとの灯 2〜3 枚、崩落は 3 本、休憩点は箱の内側 1 枚。
 */
export function landmarkLightsInView(seed: number, camX: number, camY: number, spanX: number, spanY: number, timeSec: number): LightRect[] {
  const x0 = camX - spanX / 2;
  const x1 = camX + spanX / 2;
  const y0 = camY - spanY / 2;
  const y1 = camY + spanY / 2;
  const out: LightRect[] = [];
  const c0 = biomeCellAt(seed, y0) - 1;
  const c1 = biomeCellAt(seed, y1) + 1;
  const k0 = Math.floor((x0 - PASSAGE_SLOT) / PASSAGE_SLOT);
  const k1 = Math.floor((x1 + PASSAGE_SLOT) / PASSAGE_SLOT);
  for (let cell = c0; cell <= c1; cell++) {
    for (let k = k0; k <= k1; k++) {
      const lm = landmarkAt(seed, cell, k);
      if (lm) {
        if (isTowerFamily(lm.kind)) {
          // 頂部の灯と冷却塔の光柱(頂部から上へ COOLING_BEAM_HEIGHT)が視野に掛かるときだけ
          if (lm.top - COOLING_BEAM_HEIGHT - 8 <= y1 && lm.top >= y0 && lm.x + 8 >= x0 && lm.x - 8 <= x1) towerFamilyLights(seed, lm, timeSec, out);
        } else if (lm.kind === 'collapse' && lm.top - RIFT_RAY_TOP <= y1 && lm.baseY >= y0 && lm.gapRight >= x0 && lm.gapLeft <= x1) {
          collapseLights(seed, lm, timeSec, out);
        }
      }
      const rp = restPointAt(seed, cell, k);
      if (rp.right >= x0 && rp.left <= x1 && rp.floorY >= y0 && rp.floorY - REST_HEIGHT - 1 <= y1) {
        // 箱の内側の暖色。箱の内側に収まる矩形だが、前室の床などが箱へ重なる配置では中に固体が入るので、
        // 天井の下から下向きの平行光で地形に止める(2.16 §1。全周レイだと箱の四隅が弦で欠ける)
        out.push({ x0: rp.left + 1, y0: rp.floorY - REST_HEIGHT, x1: rp.right, y1: rp.floorY, alpha: REST_WARM_ALPHA, color: restLampColor(seed, rp.cell), occl: { kind: 'column', dir: 'down' } });
      }
    }
  }
  return out;
}

/**
 * 大昇降機の眺望区間の光のアルファ(暗さの作り直し 2.17 の「光は例外」: 暗い縦坑の中で明るい例外として際立たせる)。
 * 区間 1 つにつき 1 枚(壁の外の張り出しから反対側の張り出しまで)
 */
export const GRAND_VISTA_ALPHA = 0.14;
/** 大昇降機の灯(壁の内側の面の点)と暈のアルファ */
const GRAND_LAMP_ALPHA = 0.6;
const GRAND_LAMP_HALO_ALPHA = 0.07;
/** 途中駅の休憩所の暖色のアルファ */
const GRAND_REST_ALPHA = 0.08;

/**
 * 視野に掛かる大昇降機の光(設計 2026-11-12-mega-structures): 眺望区間 1 枚、灯 1 つにつき点と暈の 2 枚、
 * 休憩所のある途中駅 1 枚。灯は焼き込みの装飾と同じ行(grandLampAt)で、色は行の地区。
 * どれも縦坑の内側と彫った空間に収まる矩形なので遮蔽は付けない(レイを飛ばさない)。
 * 枚数は標準ズームで灯 2〜3 行 × 2 側 × 2 枚 + 眺望 0〜1 枚。新しい描画パスは足さない(LandmarkLights に相乗り)
 */
export function grandShaftLightsInView(seed: number, camX: number, camY: number, spanX: number, spanY: number): LightRect[] {
  const out: LightRect[] = [];
  const y0 = camY - spanY / 2;
  const y1 = camY + spanY / 2;
  for (const s of grandShaftsNear(seed, camX, camY, spanX / 2, spanY / 2 + 2)) {
    const wallL = s.x0 - 1;
    const wallR = s.x0 + s.width;
    for (const vy of s.vistas) {
      if (vy < y0 || vy - GRAND_VISTA_ROWS > y1) continue;
      const color = grandVistaColor(biomeIdForCell(seed, biomeCellAt(seed, vy)));
      out.push({ x0: wallL - GRAND_VISTA_REACH, y0: vy - GRAND_VISTA_ROWS, x1: wallR + 1 + GRAND_VISTA_REACH, y1: vy, alpha: GRAND_VISTA_ALPHA, color });
    }
    const r0 = Math.max(Math.floor(y0) - 1, s.yTop);
    const r1 = Math.min(Math.ceil(y1) + 1, s.yBottom);
    for (let wy = r0; wy < r1; wy++) {
      if (!grandLampAt(seed, s, wy)) continue;
      const color = grandLampColor(biomeIdForCell(seed, biomeCellAt(seed, wy)));
      // 点は壁の内側の面、暈は内側へ 2 列・上下 1.5 行(壁の向こうへは漏らさない)
      out.push({ x0: wallL + 0.7, y0: wy + 0.25, x1: wallL + 1.2, y1: wy + 0.75, alpha: GRAND_LAMP_ALPHA, color });
      out.push({ x0: wallR - 0.2, y0: wy + 0.25, x1: wallR + 0.3, y1: wy + 0.75, alpha: GRAND_LAMP_ALPHA, color });
      out.push({ x0: wallL + 1, y0: wy - 1, x1: wallL + 3, y1: wy + 2, alpha: GRAND_LAMP_HALO_ALPHA, color });
      out.push({ x0: wallR - 2, y0: wy - 1, x1: wallR, y1: wy + 2, alpha: GRAND_LAMP_HALO_ALPHA, color });
    }
    for (const stn of s.stations) {
      if (stn.amenity !== 'rest' || stn.upper < y0 || stn.upper - 3 > y1) continue;
      out.push({ x0: stn.amenityX - 3, y0: stn.upper - 3, x1: stn.amenityX + 3, y1: stn.upper, alpha: GRAND_REST_ALPHA, color: GRAND_REST_COLOR });
    }
  }
  return out;
}

/** 遮蔽の作業配列(列の到達位置と、点光源のレイの端点)。描画は 1 スレッドで順に呼ばれるので共有する */
let columnBuf = new Float64Array(128);
const pointBuf = new Float64Array(Math.max(HALO_RAYS, LAMP_HALO_RAYS) * 2);

/**
 * ワールド座標の矩形を lighter で塗る(画面内の部分だけ。lighter の画素数を最小に)。
 * LandmarkLights と AmbientLights(ambient.ts)が共有する。テスト対象外(Canvas)
 * solidAt を渡すと矩形の occl に従って壁で遮る(2.16 §1)。画面外の矩形はレイを飛ばす前に捨てる
 */
export function drawLightRects(
  ctx: CanvasRenderingContext2D,
  rects: LightRect[],
  cam: { x: number; y: number },
  w: number,
  h: number,
  ppt: number,
  solidAt?: SolidAt,
): void {
  if (rects.length === 0) return;
  const v: LightView = { camX: cam.x, camY: cam.y, w, h, ppt };
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const r of rects) {
    if (!rectOnScreen(v, r.x0, r.y0, r.x1, r.y1)) continue;
    ctx.globalAlpha = r.alpha;
    ctx.fillStyle = r.color;
    const o = r.occl;
    if (!solidAt || !o) {
      fillWorldRect(ctx, v, r.x0, r.y0, r.x1, r.y1);
    } else if (o.kind === 'column') {
      const down = o.dir === 'down';
      const start = o.from ?? (down ? r.y0 : r.y1);
      const col = castColumns(v, r.x0, r.x1, start, down ? r.y1 : r.y0, solidAt, columnBuf);
      columnBuf = col.reach;
      fillLitRect(ctx, v, col, r.x0, r.y0, r.x1, r.y1);
    } else {
      fillPointLit(ctx, v, r.x0, r.y0, r.x1, r.y1, o.x, o.y, o.rays, solidAt, pointBuf);
    }
  }
  ctx.restore();
}

/** 大構造の光と休憩点の暖色の描画。Lighting の overlay(半解像度)へ lighter で矩形を塗るだけ。テスト対象外(Canvas) */
export class LandmarkLights {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: { x: number; y: number },
    w: number,
    h: number,
    ppt: number,
    timeSec: number,
    solidAt?: SolidAt,
  ): void {
    const rects = landmarkLightsInView(this.seed, cam.x, cam.y, w / ppt, h / ppt, timeSec);
    // 大昇降機の眺望区間・灯・休憩所(遮蔽なしの矩形なので同じ呼び出しに並べる)
    for (const r of grandShaftLightsInView(this.seed, cam.x, cam.y, w / ppt, h / ppt)) rects.push(r);
    drawLightRects(ctx, rects, cam, w, h, ppt, solidAt);
  }
}
