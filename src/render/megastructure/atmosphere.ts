import { mixHex } from '../biome';

/** 最遠のかすみ強度(0..1)。近づくほど0へ。 */
const HAZE_MAX = 0.6;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * 深度(0=最遠..1=最近) → かすみ係数(0..HAZE_MAX)。
 * 遠いほど大きい(構造を灰へ持ち上げ低コントラスト化)。線形・クランプ。
 */
export function hazeFactor(depth: number): number {
  return clamp01(1 - clamp01(depth)) * HAZE_MAX;
}

/**
 * かすみの色。バイオームの環境色を脱彩度気味の青灰へ寄せた霞色を返す。
 * 遠景構造はこの色に向かって混ぜられ、黒へ沈むのでなく灰へ溶ける。
 */
export function hazeColor(ambientColor: string): string {
  // 環境色を中間の青灰へ寄せる(彩度を落として空気遠近を表現)
  return mixHex(ambientColor, '#3a4653', 0.5);
}
