import type { Tone } from './spec';
import { STEEL, mixHex } from '../steel';

/** 最遠のかすみ強度(0..1)。近づくほど0へ。 */
const HAZE_MAX = 0.6;

/**
 * 明度段 → 持ち上げ混合率(遠=暗, 近=明)。
 * 近景タイル基調(fillMid)より必ず暗い範囲でトーン差を作る
 * (atmosphere.test.ts が全系統×全トーン×全かすみで輝度順を検証)。
 */
const TONE_MIX: Record<Tone, number> = { far: 0.07, mid: 0.15, near: 0.25 };

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
 * かすみの色。バイオームの環境色を暗鋼の青灰(STEEL.hanger)へ寄せた霞色を返す。
 * 遠景構造はこの色に向かって混ぜられ、黒へ沈むのでなく暗灰へ溶ける。
 * 寄せ率は「近景タイルより暗い」を保てる範囲に抑える(structureFill のテスト参照)。
 */
export function hazeColor(ambientColor: string): string {
  return mixHex(ambientColor, STEEL.hanger, 0.35);
}

/**
 * 構造の塗り色(純粋)。ambientColor から基準暗色を作り、トーンで持ち上げ、
 * かすみ係数で霞色へ寄せる。realismモックの奥行き原則
 * 「遠=ほぼ黒 → 中=暗灰 → 近(タイル)=中灰」を保つため、
 * どのトーン・かすみでも近景タイル基調(fillMid)より暗い。
 */
export function structureFill(ambientColor: string, tone: Tone, hf: number): string {
  const baseDark = mixHex(STEEL.black, ambientColor, 0.25);
  const lit = mixHex(baseDark, STEEL.hanger, TONE_MIX[tone]);
  return mixHex(lit, hazeColor(ambientColor), clamp01(hf));
}
