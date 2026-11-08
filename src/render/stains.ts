import { hash2 } from '../world/noise';
import { plateAt, type PlateInfo } from './tileset/plate';

/**
 * 垂れ汚れ・錆の滲み(見た目大幅改善 段階 1、設計 §3.1)。
 * プレートの上面(継ぎ目)から、そのプレートの内側だけに垂れる染みを決定論で置く。
 * 染みはプレート局所で完結する(プレートを跨がない)ため、チャンク境界や
 * 部分再焼き込みで切れない。付くのは一部のプレートだけ(疎密のため)。純粋・決定論。
 */

const SALT_GATE = 4201;
const SALT_COL = 4202;
const SALT_LEN = 4203;
const SALT_KIND = 4204;
const SALT_CX = 4205;
const SALT_W = 4206;

/** 染みが付くプレートの割合 */
export const STAIN_PLATE_RATE = 0.45;
/** 錆になる割合(残りは暗い垂れ汚れ) */
export const STAIN_RUST_RATE = 0.3;

export interface StainSeg {
  /** 染みの中心(タイル正規化 0..1) */
  cx: number;
  /** 染みの幅(タイル比) */
  w: number;
  /** 0=垂れ汚れ(暗)、1=錆(暖色) */
  kind: 0 | 1;
  /** 下へ行くほど弱まる係数(1 → 約 0.45) */
  fade: number;
}

/**
 * (wx, wy) のタイルに染みの区間があれば返す。plate は呼び出し側が plateAt を
 * 計算済みなら渡せる(省略時は内部で計算する)。
 */
export function stainSegmentAt(seed: number, wx: number, wy: number, plate?: PlateInfo): StainSeg | null {
  const p = plate ?? plateAt(seed, wx, wy);
  if (hash2(seed + SALT_GATE, p.ox, p.oy) >= STAIN_PLATE_RATE) return null;
  const col = Math.min(p.w - 1, Math.floor(hash2(seed + SALT_COL, p.ox, p.oy) * p.w));
  if (p.lx !== col) return null;
  const len = 1 + Math.floor(hash2(seed + SALT_LEN, p.ox, p.oy) * p.h);
  if (p.ly >= len) return null;
  const kind: 0 | 1 = hash2(seed + SALT_KIND, p.ox, p.oy) < STAIN_RUST_RATE ? 1 : 0;
  const cx = 0.5 + (hash2(seed + SALT_CX, p.ox, p.oy) - 0.5) * 0.3;
  const w = 0.34 + hash2(seed + SALT_W, p.ox, p.oy) * 0.3;
  const fade = 1 - (len > 1 ? p.ly / len : 0) * 0.55;
  return { cx, w, kind, fade };
}
