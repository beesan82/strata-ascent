import {
  ANTECHAMBER_DEPTH, ANTECHAMBER_FADE, ANTECHAMBER_HALF_WIDTH, PASSAGE_SLOT,
  interfaceBottom, interfaceTop, nearestPassage, passageX,
} from '../world/interface';
import { biomeCellAt } from '../world/biomeCells';
import { biomeForCell } from './biome';
import { holeCenterX } from './hardPlate';

/**
 * 光柱と導光(設計書 §6.2)・ライティング補正(§6.3)の幾何と強度。純粋関数のみ。
 * 描画は BeaconLights(同ファイル下部)と Background が行う。
 *
 * 座標の約束: Y は下向き正。cell c の板は cell c の上端 [interfaceTop(c), interfaceBottom(c)) にあり、
 * その下 48 タイルが前室(cell c の中)。板の上の層は cell c − 1 で、光はそこから来る。
 */

/** 光柱の半幅(タイル)。幅 24 */
export const BEACON_HALF_WIDTH = 12;
/** 光溜まりの芯の半径(タイル) */
export const POOL_CORE_RADIUS = 20;
/** 光溜まりの裾の半径(タイル)。大穴中心から孔の梯子(−48)までで、梯子は裾の縁に立つ */
export const POOL_FRINGE_RADIUS = 48;
/** 脈動の周期(秒)と振幅 */
export const PULSE_PERIOD = 7;
export const PULSE_AMPLITUDE = 0.15;
/**
 * 背景の滲み: 追従率、強度が最小になる水平距離、最小強度。横の形は glowStrength の折れ線そのもの
 * (設計書の「幅 300」の楕円は 1 画面内の勾配が小さすぎて方角が読めなかった。Background.glow 参照)。
 */
export const GLOW_FACTOR = 0.9;
export const GLOW_FALLOFF = 256;
export const GLOW_MIN = 0.15;
/** 界面の帯の追従率 */
export const BAND_FACTOR = 0.6;
/** §6.3: 光溜まりの中の ambientLevel 補正と、その外の補正 */
export const AMBIENT_IN_POOL = 0.15;
export const AMBIENT_OUT_POOL = -0.1;

export interface Beacon {
  cell: number;
  k: number;
  /** 大穴の中心 X(光柱の軸) */
  x: number;
  /** 板の下面 Y(光柱の上端) */
  top: number;
  /** 前室の床の行 Y(光柱の下端・光溜まりの位置) */
  floor: number;
  /** 上の層(cell−1)のバイオームの accent */
  color: string;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 板 cell の光柱色: 光は上の層(cell−1)から来る */
function beaconColor(seed: number, cell: number): string {
  return biomeForCell(seed, cell - 1).accent;
}

/** x に最寄りの大穴の中心 X(k0 とその両隣から選ぶ) */
export function nearestHoleX(seed: number, cell: number, x: number): number {
  const k0 = Math.floor(x / PASSAGE_SLOT);
  let best = holeCenterX(passageX(seed, cell, k0 - 1));
  for (let k = k0; k <= k0 + 1; k++) {
    const hx = holeCenterX(passageX(seed, cell, k));
    if (Math.abs(hx - x) < Math.abs(best - x)) best = hx;
  }
  return best;
}

/**
 * 視野(camX ± spanX/2, camY ± spanY/2)に掛かる光柱。光柱の矩形は
 * X が大穴中心 ± POOL_FRINGE_RADIUS、Y が板の下面から前室の床の行まで。
 */
export function beaconsInView(seed: number, camX: number, camY: number, spanX: number, spanY: number): Beacon[] {
  const x0 = camX - spanX / 2;
  const x1 = camX + spanX / 2;
  const y0 = camY - spanY / 2;
  const y1 = camY + spanY / 2;
  const out: Beacon[] = [];
  const c0 = biomeCellAt(seed, y0) - 1;
  const c1 = biomeCellAt(seed, y1) + 1;
  const k0 = Math.floor((x0 - PASSAGE_SLOT) / PASSAGE_SLOT);
  const k1 = Math.floor((x1 + PASSAGE_SLOT) / PASSAGE_SLOT);
  for (let cell = c0; cell <= c1; cell++) {
    const top = interfaceBottom(seed, cell);
    const floor = top + ANTECHAMBER_DEPTH;
    if (top > y1 || floor + 1 < y0) continue;
    for (let k = k0; k <= k1; k++) {
      const x = holeCenterX(passageX(seed, cell, k));
      if (x + POOL_FRINGE_RADIUS < x0 || x - POOL_FRINGE_RADIUS > x1) continue;
      out.push({ cell, k, x, top, floor, color: beaconColor(seed, cell) });
    }
  }
  return out;
}

/** 周期 7 秒で ±15% の脈動係数 */
export function beaconPulse(timeSec: number): number {
  return 1 + PULSE_AMPLITUDE * Math.sin((2 * Math.PI * timeSec) / PULSE_PERIOD);
}

/** 滲みの強度: 最寄りの大穴からの水平距離 0 で 1、256 で 0.15(線形)、以遠は 0.15 */
export function glowStrength(dx: number): number {
  return 1 - (1 - GLOW_MIN) * Math.min(1, Math.abs(dx) / GLOW_FALLOFF);
}

export interface BeaconGlow {
  /** 大穴の中心 X */
  x: number;
  /** 板の下面 Y */
  top: number;
  /** 前室の床の行 Y */
  floor: number;
  /** この層の下端(次の板の上面)Y。滲みは層の全高に広げる */
  layerBottom: number;
  strength: number;
  color: string;
}

/** 今いる層(カメラ Y の cell)の板の、最寄りの大穴に向かう滲み。縦坑の中でも同じ板を指す */
export function beaconGlowAt(seed: number, camX: number, camY: number): BeaconGlow {
  const cell = biomeCellAt(seed, camY);
  const x = nearestHoleX(seed, cell, camX);
  const top = interfaceBottom(seed, cell);
  return {
    x,
    top,
    floor: top + ANTECHAMBER_DEPTH,
    layerBottom: interfaceTop(seed, cell + 1),
    strength: glowStrength(camX - x),
    color: beaconColor(seed, cell),
  };
}

export interface InterfaceBand {
  cell: number;
  top: number;
  bottom: number;
}

/** カメラ Y から上下 spanY(1 画面)以内に上面または下面がある板 */
export function interfaceBandsNear(seed: number, camY: number, spanY: number): InterfaceBand[] {
  const out: InterfaceBand[] = [];
  const c0 = biomeCellAt(seed, camY - spanY) - 1;
  const c1 = biomeCellAt(seed, camY + spanY) + 1;
  for (let cell = c0; cell <= c1; cell++) {
    const top = interfaceTop(seed, cell);
    const bottom = interfaceBottom(seed, cell);
    if (Math.abs(top - camY) <= spanY || Math.abs(bottom - camY) <= spanY) out.push({ cell, top, bottom });
  }
  return out;
}

/**
 * §6.3 の ambientLevel 補正。前室(板の下 0..48)の中で、光溜まりの芯(大穴中心 ±20)は +0.15、
 * 裾(±48)の外は −0.1、間は線形補間。前室の外縁 40 タイルで 0 へ戻す。前室の外は 0。
 */
export function ambientDelta(seed: number, x: number, y: number): number {
  const cell = biomeCellAt(seed, y);
  const dy = y - interfaceBottom(seed, cell);
  if (dy < 0 || dy > ANTECHAMBER_DEPTH) return 0;
  const px = nearestPassage(seed, cell, x).x;
  const fade = clamp01((ANTECHAMBER_HALF_WIDTH + ANTECHAMBER_FADE - Math.abs(x - px)) / ANTECHAMBER_FADE);
  if (fade === 0) return 0;
  const d = Math.abs(x - nearestHoleX(seed, cell, x));
  const u = clamp01((d - POOL_CORE_RADIUS) / (POOL_FRINGE_RADIUS - POOL_CORE_RADIUS));
  return fade * (AMBIENT_IN_POOL + (AMBIENT_OUT_POOL - AMBIENT_IN_POOL) * u);
}

/** #rrggbb → rgba() 文字列 */
function withAlpha(hex: string, a: number): string {
  const p = parseInt(hex.slice(1), 16);
  return `rgba(${(p >> 16) & 255},${(p >> 8) & 255},${p & 255},${a})`;
}

/**
 * 光柱の基準アルファ(脈動前)。lighter 合成で暗幕の上に乗せる。柱(柔らかい縁)+芯+光溜まりが
 * 重なる軸上で合計 ≈ 0.3 になり、0.28 では accent が画面全体を飽和させた。
 */
const BEACON_ALPHA = 0.1;
/** 光柱の芯の半幅(タイル)。縁をぼかさない硬い部分 */
const CORE_HALF_WIDTH = 4;
/** 光溜まりの縦横比(床に寝た楕円) */
const POOL_ASPECT = 0.22;

/**
 * 光柱と光溜まりの描画(§6.2)。Lighting の暗幕の後に lighter で描く(§6.3: 暗幕で消えない)。
 * テスト対象外(Canvas)。幾何は beaconsInView、脈動は beaconPulse。
 */
export class BeaconLights {
  constructor(private seed: number) {}

  render(
    ctx: CanvasRenderingContext2D,
    cam: { x: number; y: number },
    w: number,
    h: number,
    ppt: number,
    timeSec: number,
  ): void {
    const beacons = beaconsInView(this.seed, cam.x, cam.y, w / ppt, h / ppt);
    if (beacons.length === 0) return;
    const a = BEACON_ALPHA * beaconPulse(timeSec);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of beacons) {
      const sx = (b.x - cam.x) * ppt + w / 2;
      const sy0 = (b.top - cam.y) * ppt + h / 2;
      const sy1 = (b.floor - cam.y) * ppt + h / 2;
      // 画面内の縦範囲だけ塗る(グラデ座標は板の下面〜床のまま)
      const yA = Math.max(sy0, 0);
      const yB = Math.min(sy1, h);
      if (yB > yA) {
        // 柱(柔らかい縁): 横方向グラデ、中央 40% は一定
        const half = BEACON_HALF_WIDTH * ppt;
        const soft = ctx.createLinearGradient(sx - half, 0, sx + half, 0);
        soft.addColorStop(0, withAlpha(b.color, 0));
        soft.addColorStop(0.3, withAlpha(b.color, a));
        soft.addColorStop(0.7, withAlpha(b.color, a));
        soft.addColorStop(1, withAlpha(b.color, 0));
        ctx.fillStyle = soft;
        ctx.fillRect(sx - half, yA, half * 2, yB - yA);
        // 柱の芯(硬い縁): 上で強く床へ向かって弱まる
        const core = ctx.createLinearGradient(0, sy0, 0, sy1);
        core.addColorStop(0, withAlpha(b.color, a * 0.9));
        core.addColorStop(1, withAlpha(b.color, a * 0.35));
        ctx.fillStyle = core;
        const ch = CORE_HALF_WIDTH * ppt;
        ctx.fillRect(sx - ch, yA, ch * 2, yB - yA);
      }
      // 光溜まり: 床の行の上端に寝た楕円。芯(20)は明るく、裾(48)は孔の梯子まで届く
      const rx = POOL_FRINGE_RADIUS * ppt;
      const ry = rx * POOL_ASPECT;
      if (sy1 + ry >= 0 && sy1 - ry <= h && sx + rx >= 0 && sx - rx <= w) {
        const pool = ctx.createRadialGradient(sx, sy1, 0, sx, sy1, rx);
        pool.addColorStop(0, withAlpha(b.color, a * 1.3));
        pool.addColorStop(POOL_CORE_RADIUS / POOL_FRINGE_RADIUS, withAlpha(b.color, a * 0.6));
        pool.addColorStop(1, withAlpha(b.color, 0));
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.ellipse(sx, sy1, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
}
