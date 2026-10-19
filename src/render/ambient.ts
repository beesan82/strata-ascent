import { biomeCellAt } from '../world/biomeCells';
import { BAND_FACTOR } from './beacon';
import { interfaceBottom, mod, PASSAGE_SLOT } from '../world/interface';
import { hash2 } from '../world/noise';
import { REST_HEIGHT, restPointAt } from '../world/restpoint';
import type { LightRect } from './landmarkLight';

/**
 * 動く世界(設計書 §6.6): 休憩点の灯の明滅・遠景の建設者・水系の落下粒。純粋関数が幾何を
 * ワールド座標の平坦な矩形(LightRect)として返し、描画は既存の Lighting の overlay(半解像度)と
 * Background の帯に相乗りする(新しい描画パスは足さない。1 枚 1 色、グラデ・楕円は使わない)。
 */

/** 灯の明滅の周期(秒)の範囲 */
export const LAMP_PERIOD_MIN = 2;
export const LAMP_PERIOD_MAX = 5;
/** 周期ごとにこの確率で、周期の先頭 LAMP_BLACKOUT_FRAC の間だけ消える */
export const LAMP_BLACKOUT_RATE = 0.12;
const LAMP_BLACKOUT_FRAC = 0.08;
/** 灯の色(暖色)、灯 1×1 タイルと暈 3×2 タイルのアルファ。段階4 の焼き込みの lamp 痕跡の上に加算する */
export const LAMP_COLOR = '#ffb866';
export const LAMP_ALPHA = 0.45;
export const LAMP_HALO_ALPHA = 0.08;

export interface Lamp {
  period: number;
  /** 周期の割合(0..1) */
  phase: number;
}

/** 休憩点(cell, k)の i 番目の灯の個別位相 */
export function lampParams(seed: number, cell: number, k: number, i: number): Lamp {
  const period = LAMP_PERIOD_MIN + hash2(seed + 9301, cell * 8 + i, k) * (LAMP_PERIOD_MAX - LAMP_PERIOD_MIN);
  const phase = hash2(seed + 9302, cell * 8 + i, k);
  return { period, phase };
}

/**
 * 灯の明るさ 0..1。正弦の揺らぎ(0.6〜1.0)に、周期ごと確率 LAMP_BLACKOUT_RATE で先頭 8% だけ消える
 * 一瞬の消灯を重ねる。id は灯の識別(消灯の抽選に使う)。
 */
export function lampGlow(timeSec: number, lamp: Lamp, seed: number, id: number): number {
  const p = timeSec / lamp.period + lamp.phase;
  const n = Math.floor(p);
  const u = p - n;
  if (u < LAMP_BLACKOUT_FRAC && hash2(seed + 9303, id, n) < LAMP_BLACKOUT_RATE) return 0;
  return 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(2 * Math.PI * u));
}

/** 視野(camX ± spanX/2, camY ± spanY/2)に掛かる休憩点の灯(点灯中だけ灯+暈の 2 枚) */
export function lampLightsInView(seed: number, camX: number, camY: number, spanX: number, spanY: number, timeSec: number): LightRect[] {
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
      const rp = restPointAt(seed, cell, k);
      if (rp.right < x0 || rp.left > x1 || rp.floorY < y0 || rp.floorY - REST_HEIGHT > y1) continue;
      for (let i = 0; i < rp.lamps.length; i++) {
        const glow = lampGlow(timeSec, lampParams(seed, cell, k, i), seed, cell * 1000 + k * 8 + i);
        if (glow <= 0) continue;
        const lx = rp.lamps[i];
        out.push({ x0: lx, y0: rp.floorY - 1, x1: lx + 1, y1: rp.floorY, alpha: LAMP_ALPHA * glow, color: LAMP_COLOR });
        out.push({ x0: lx - 1, y0: rp.floorY - 2, x1: lx + 2, y1: rp.floorY, alpha: LAMP_HALO_ALPHA * glow, color: LAMP_COLOR });
      }
    }
  }
  return out;
}

/** 建設者の速度(タイル/秒)とスロットごとの最大数 */
export const BUILDER_SPEED = 0.3;
export const BUILDER_MAX = 2;

export interface Builder {
  cell: number;
  k: number;
  /** ワールド X(タイル) */
  x: number;
  /** 板の下面 Y(裏面に沿って動く) */
  y: number;
  dir: 1 | -1;
}

/**
 * 孔スロット k の建設者(0〜2 体)。位置 = スロット内の初期位置 + 速度 × simTime をスロット幅で折り返す
 * (端に達したら反対側から出る)。決定論で、状態を持たない。
 */
export function buildersInSlot(seed: number, cell: number, k: number, simTime: number): Builder[] {
  const n = Math.floor(hash2(seed + 9401, cell, k) * (BUILDER_MAX + 1));
  const y = interfaceBottom(seed, cell);
  const out: Builder[] = [];
  for (let i = 0; i < n; i++) {
    const x0 = hash2(seed + 9402, cell * 4 + i, k) * PASSAGE_SLOT;
    const dir: 1 | -1 = hash2(seed + 9403, cell * 4 + i, k) < 0.5 ? -1 : 1;
    out.push({ cell, k, x: k * PASSAGE_SLOT + mod(x0 + dir * BUILDER_SPEED * simTime, PASSAGE_SLOT), y, dir });
  }
  return out;
}

/**
 * 視野に掛かる建設者。描画は板の帯と同じ追従率 BAND_FACTOR(0.6)なので、ワールドの視野は
 * 1/0.6 倍に広げて切る。板の下面が縦の範囲に入る層だけ。
 */
export function buildersInView(seed: number, camX: number, camY: number, spanX: number, spanY: number, simTime: number): Builder[] {
  const hx = spanX / 2 / BAND_FACTOR;
  const hy = spanY / 2 / BAND_FACTOR;
  const x0 = camX - hx;
  const x1 = camX + hx;
  const y0 = camY - hy;
  const y1 = camY + hy;
  const out: Builder[] = [];
  const c0 = biomeCellAt(seed, y0) - 1;
  const c1 = biomeCellAt(seed, y1) + 1;
  const k0 = Math.floor(x0 / PASSAGE_SLOT);
  const k1 = Math.floor(x1 / PASSAGE_SLOT);
  for (let cell = c0; cell <= c1; cell++) {
    const y = interfaceBottom(seed, cell);
    if (y < y0 || y > y1) continue;
    for (let k = k0; k <= k1; k++) {
      for (const b of buildersInSlot(seed, cell, k, simTime)) if (b.x >= x0 && b.x <= x1) out.push(b);
    }
  }
  return out;
}
