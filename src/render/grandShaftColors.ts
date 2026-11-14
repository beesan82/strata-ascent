import type { BiomeId } from '../world/biomeCells';
import { mixHex, VISUAL_BIOME } from './biome';
import { STEEL } from './steel';

/**
 * 大昇降機(設計 2026-11-12-mega-structures)の色。焼き込みの装飾(decor.ts)と灯の矩形(landmarkLight.ts)が共有する。
 * 鋼は STEEL の隣り合う 2 色の混合で、既存の PALETTE / SCENERY_COLORS / 地区色とは重ならない値にする
 * (既存テストの「色で装飾・光を見分ける」検査に紛れ込まないように)。
 */
export const GRAND_SHAFT_COLORS = {
  /** 案内レール(支柱) */
  rail: mixHex(STEEL.rib, STEEL.flange, 0.35),
  /** 案内レールの受け光 */
  railLit: mixHex(STEEL.flange, STEEL.railTop, 0.35),
  /** 背面の筋交い */
  brace: mixHex(STEEL.shadow, STEEL.rib, 0.35),
  /** 釣り合いのケーブル */
  cable: mixHex(STEEL.hanger, STEEL.stringer, 0.55),
  /** 灯の筐体 */
  housing: mixHex(STEEL.black, STEEL.shadow, 0.4),
  /** 眺望区間の手すり・庇の縁 */
  sill: mixHex(STEEL.railTop, STEEL.post, 0.6),
  /** 停止階の乗り場の縁(注意帯) */
  stationEdge: mixHex('#caa64a', STEEL.base, 0.45),
  /** 壁の錆筋(地区の rust で濃さが変わる) */
  rust: mixHex('#5a3a24', STEEL.base, 0.2),
  /** 壁のステンシル(rect の alpha で薄く載せる) */
  stencil: mixHex(STEEL.bayEdge, STEEL.railTop, 0.45),
  /** 壁の縦配管(地区の pipes で密度が変わる) */
  pipe: mixHex(STEEL.rib, STEEL.hanger, 0.6),
} as const;

/** 灯の基準色(淡い白熱)。地区の accent へ寄せて、通過する地区の境目で灯の色が切り替わる */
const GRAND_LAMP_BASE = '#f2dfae';
/** 眺望区間の光の基準色(遠景の冷たい明るさ) */
const GRAND_VISTA_BASE = '#b8cde0';
/** 途中駅の休憩所の暖色(休憩点の暖色に近いが同じ値にはしない) */
export const GRAND_REST_COLOR = mixHex('#d8903a', '#f2dfae', 0.3);

/** 地区 id の灯の色 */
export function grandLampColor(id: BiomeId): string {
  return mixHex(GRAND_LAMP_BASE, VISUAL_BIOME[id].accent, 0.55);
}

/** 地区 id の壁の内側の面の色(地区の境目で質感が切り替わる帯) */
export function grandWallTint(id: BiomeId): string {
  return mixHex(STEEL.bayEdge, VISUAL_BIOME[id].accent, 0.45);
}

/** 地区 id の眺望区間の光の色 */
export function grandVistaColor(id: BiomeId): string {
  return mixHex(GRAND_VISTA_BASE, VISUAL_BIOME[id].accent, 0.3);
}
