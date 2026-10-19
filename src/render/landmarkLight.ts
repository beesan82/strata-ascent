import { biomeCellAt } from '../world/biomeCells';
import { PASSAGE_SLOT } from '../world/interface';
import { landmarkAt, rampTopY, TOWER_TOP_HALF_WIDTH, type Landmark } from '../world/landmark';
import { REST_HEIGHT, restPointAt } from '../world/restpoint';
import { beaconPulse } from './beacon';
import { biomeForCell } from './biome';

/**
 * 大構造の固有の光(設計書 §6.2: 塔は頂部の点滅、崩落は裂け目からの光条)と休憩点の暖色(§6.3)。
 * 幾何は純粋関数 landmarkLightsInView が平坦な矩形(ワールド座標)として返し、LandmarkLights が
 * Lighting の半解像度 overlay へ lighter で塗るだけ。新しい描画パスは足さず、色数も矩形 1 枚 1 色で、
 * 1 画面に最大でも 6 枚程度(塔 2・崩落 3・休憩点 1)に収める(段階2 の性能ルール)。
 */

/** 塔の頂部の点滅: 周期(秒)と点灯割合 */
export const TOWER_BLINK_PERIOD = 1.6;
export const TOWER_BLINK_DUTY = 0.15;
/** 点滅の色(赤橙。層の accent とは別の「人工の灯」として遠くから読める) */
export const TOWER_BLINK_COLOR = '#ff5a3c';
/** 点滅の灯のアルファと暈のアルファ */
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

/** ワールド座標(タイル)の平坦な矩形 [x0,x1)×[y0,y1) */
export interface LightRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  alpha: number;
  color: string;
}

/** 塔の頂部の点滅。k で位相をずらす(隣の塔と同期しない) */
export function towerBlink(timeSec: number, k: number): boolean {
  const phase = (timeSec + k * 0.37) / TOWER_BLINK_PERIOD;
  return phase - Math.floor(phase) < TOWER_BLINK_DUTY;
}

function towerLights(lm: Landmark, timeSec: number, out: LightRect[]): void {
  if (!towerBlink(timeSec, lm.k)) return;
  // 灯(2×1 タイル)と暈(6×3)。頂部の開口(top−8..top)のすぐ上に浮かぶ
  const y = lm.top - 8;
  out.push({ x0: lm.x - 1, y0: y - 1, x1: lm.x + 1, y1: y, alpha: TOWER_LAMP_ALPHA, color: TOWER_BLINK_COLOR });
  out.push({ x0: lm.x - 3, y0: y - 3, x1: lm.x + 3, y1: y, alpha: TOWER_HALO_ALPHA, color: TOWER_BLINK_COLOR });
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
    out.push({ x0, y0: lm.top - RIFT_RAY_TOP, x1, y1: rampTopY(lm, Math.floor((x0 + x1) / 2)), alpha: RIFT_ALPHA * (1 - 0.25 * i) * pulse, color });
  });
}

/**
 * 視野(camX ± spanX/2, camY ± spanY/2)に掛かる大構造の光と休憩点の暖色。
 * 塔は点灯中だけ 2 枚、崩落は 3 本、休憩点は箱の内側 1 枚。
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
        if (lm.kind === 'tower') {
          // 塔の頂部の灯は頂部の開口の上 4 タイルまで
          if (lm.top - 12 <= y1 && lm.top - 8 >= y0 && lm.x + TOWER_TOP_HALF_WIDTH >= x0 && lm.x - TOWER_TOP_HALF_WIDTH <= x1) towerLights(lm, timeSec, out);
        } else if (lm.top - RIFT_RAY_TOP <= y1 && lm.baseY >= y0 && lm.gapRight >= x0 && lm.gapLeft <= x1) {
          collapseLights(seed, lm, timeSec, out);
        }
      }
      const rp = restPointAt(seed, cell, k);
      if (rp.right >= x0 && rp.left <= x1 && rp.floorY >= y0 && rp.floorY - REST_HEIGHT - 1 <= y1) {
        out.push({ x0: rp.left + 1, y0: rp.floorY - REST_HEIGHT, x1: rp.right, y1: rp.floorY, alpha: REST_WARM_ALPHA, color: REST_WARM_COLOR });
      }
    }
  }
  return out;
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
  ): void {
    const rects = landmarkLightsInView(this.seed, cam.x, cam.y, w / ppt, h / ppt, timeSec);
    if (rects.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const r of rects) {
      const sx0 = (r.x0 - cam.x) * ppt + w / 2;
      const sy0 = (r.y0 - cam.y) * ppt + h / 2;
      const sx1 = (r.x1 - cam.x) * ppt + w / 2;
      const sy1 = (r.y1 - cam.y) * ppt + h / 2;
      // 画面内の部分だけ塗る(lighter の画素数を最小に)
      const xa = Math.max(0, sx0), xb = Math.min(w, sx1);
      const ya = Math.max(0, sy0), yb = Math.min(h, sy1);
      if (xb <= xa || yb <= ya) continue;
      ctx.globalAlpha = r.alpha;
      ctx.fillStyle = r.color;
      ctx.fillRect(xa, ya, xb - xa, yb - ya);
    }
    ctx.restore();
  }
}
