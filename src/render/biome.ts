import type { TilePalette } from './tileset/generate';
import type { System } from '../world/hierarchy';
import {
  BIOME_BLEND_HALF_WIDTH,
  BIOME_CELL_BASE,
  BIOME_CELL_JITTER,
  BIOME_IDS,
  biomeBoundary,
  biomeCellAt,
  biomeIdForCell,
  type BiomeId,
} from '../world/biomeCells';
import { mixHex, steelPalette, STEEL } from './steel';
export { mixHex };
export {
  BIOME_BLEND_HALF_WIDTH,
  BIOME_CELL_BASE,
  BIOME_CELL_JITTER,
  biomeBoundary,
  biomeCellAt,
};

/** パララックス背景1層の定義 */
export interface BgLayer {
  factor: number;   // カメラ追従率(小さいほど遠い)
  color: string;
  density: number;  // 構造の出現確率
  kind: 'tower' | 'deck' | 'haze';
}

/** Complete visual-biome definition used by coordinate cells and legacy system lookups. */
export interface Biome {
  name: string;
  ambientColor: string;
  ambientLevel: number;   // 0..1
  palette: TilePalette;
  accent: string;
  bgLayers: BgLayer[];
}

/** 背景レイヤーの基準色(STEELランプのみから導出)。奥(添字小)ほど暗い。bgLayersは最大3層前提。 */
const BG_BASES = [mixHex(STEEL.black, STEEL.far, 0.5), STEEL.far, mixHex(STEEL.far, STEEL.base, 0.5)];

/** 背景レイヤー色: 奥(添字小)ほど暗い鋼ランプ+微量ティント */
const bgColor = (tint: string, i: number, amount: number): string =>
  mixHex(BG_BASES[Math.min(i, 2)], tint, amount);

const bg = (
  tint: string,
  defs: ReadonlyArray<readonly [number, number, BgLayer['kind']]>,
  amount = 0.05,
): BgLayer[] =>
  defs.map(([factor, density, kind], i) => ({ factor, density, kind, color: bgColor(tint, i, amount) }));

export const VISUAL_BIOME: Record<BiomeId, Biome> = {
  coldSteel: {
    name: '最下層', ambientColor: '#101b26', ambientLevel: 0.28,
    palette: steelPalette('#5b7e9b', 0.2), accent: '#7898ae',
    bgLayers: bg('#5b7e9b', [[0.2, 0.36, 'tower'], [0.45, 0.28, 'deck']], 0.22),
  },
  habitation: {
    name: '居住区跡', ambientColor: '#0c302a', ambientLevel: 0.56,
    palette: steelPalette('#3f9b83', 0.23), accent: '#75c6a8',
    bgLayers: bg('#2eae79', [[0.18, 0.78, 'tower'], [0.35, 0.68, 'deck'], [0.5, 0.38, 'haze']], 0.22),
  },
  disposal: {
    name: '廃棄物層', ambientColor: '#341c0d', ambientLevel: 0.36,
    palette: steelPalette('#a26028', 0.22), accent: '#d38a42',
    bgLayers: bg('#b16628', [[0.24, 0.33, 'tower'], [0.5, 0.72, 'deck']], 0.22),
  },
  waterVoid: {
    name: '大空洞帯', ambientColor: '#0a1d4e', ambientLevel: 0.7, // 最も開けた系統だけ僅かに環境色を残す
    palette: steelPalette('#297cc4', 0.25), accent: '#55c8e8',
    bgLayers: bg('#2484da', [[0.12, 0.25, 'tower'], [0.3, 0.22, 'deck'], [0.55, 0.78, 'haze']], 0.22),
  },
  power: {
    name: '上層', ambientColor: '#2b1648', ambientLevel: 0.62,
    palette: steelPalette('#8157c8', 0.23), accent: '#bc7cff',
    bgLayers: bg('#8d52d8', [[0.16, 0.62, 'tower'], [0.36, 0.56, 'deck']], 0.22),
  },
};

/** Ordered compatibility view of visual biomes. */
export const BIOMES: readonly Biome[] = BIOME_IDS.map((id) => VISUAL_BIOME[id]);

/** 精錬炉(foundry): 溶鉱の赤熱を帯びた系統配色 */
const FOUNDRY: Biome = {
  name: '精錬炉', ambientColor: mixHex('#4a2620', '#020408', 0.72), ambientLevel: 0.44,
  palette: steelPalette('#d06a3c'), accent: '#e8834a',
  bgLayers: bg('#d06a3c', [[0.2, 0.5, 'tower'], [0.4, 0.45, 'deck']]),
};

/** Facility system to biome lookup; visual landscape selection uses coordinate cells below. */
export const SYSTEM_BIOME: Record<System, Biome> = {
  water: VISUAL_BIOME.waterVoid,
  habitation: VISUAL_BIOME.habitation,
  disposal: VISUAL_BIOME.disposal,
  power: VISUAL_BIOME.power,
  foundry: FOUNDRY,
};

export function biomeForSystem(system: System): Biome {
  return SYSTEM_BIOME[system];
}

export interface BiomeBlend {
  from: Biome;
  to: Biome;
  t: number;
  ambientLevel: number;
  ambientColor: string;
  palette: TilePalette;
  accent: string;
}

export function biomeForCell(seed: number, cell: number): Biome {
  return VISUAL_BIOME[biomeIdForCell(seed, cell)] ?? VISUAL_BIOME.coldSteel;
}

/** Resolve a selected visual-biome index, falling back to cold steel. */
export function biomeFromIndex(index: number): Biome {
  return BIOMES[index] ?? BIOMES[0];
}

export function biomeAt(seed: number, x: number, y: number): Biome {
  void x;
  return biomeForCell(seed, biomeCellAt(seed, y));
}

/** Mix every continuously blendable visual channel for downstream render consumers. */
const mixPalette = (from: TilePalette, to: TilePalette, t: number): TilePalette => ({
  fillDark: mixHex(from.fillDark, to.fillDark, t),
  fillMid: mixHex(from.fillMid, to.fillMid, t),
  fillLight: mixHex(from.fillLight, to.fillLight, t),
  edge: mixHex(from.edge, to.edge, t),
  line: mixHex(from.line, to.line, t),
});

/** Canonical blend consumed by lighting, tiles, accents, and background renderers. */
export const blendBiomeVisuals = (from: Biome, to: Biome, t: number): BiomeBlend => ({
  from,
  to,
  t,
  ambientLevel: from.ambientLevel + (to.ambientLevel - from.ambientLevel) * t,
  ambientColor: mixHex(from.ambientColor, to.ambientColor, t),
  palette: mixPalette(from.palette, to.palette, t),
  accent: mixHex(from.accent, to.accent, t),
});

export function biomeBlend(seed: number, x: number, y: number): BiomeBlend {
  void x;
  const cell = biomeCellAt(seed, y);
  const lowerBoundary = biomeBoundary(seed, cell);
  const upperBoundary = biomeBoundary(seed, cell + 1);

  if (y < lowerBoundary + BIOME_BLEND_HALF_WIDTH) {
    const t = (y - (lowerBoundary - BIOME_BLEND_HALF_WIDTH)) / (BIOME_BLEND_HALF_WIDTH * 2);
    return blendBiomeVisuals(biomeForCell(seed, cell - 1), biomeForCell(seed, cell), t);
  }

  if (y >= upperBoundary - BIOME_BLEND_HALF_WIDTH) {
    const t = (y - (upperBoundary - BIOME_BLEND_HALF_WIDTH)) / (BIOME_BLEND_HALF_WIDTH * 2);
    return blendBiomeVisuals(biomeForCell(seed, cell), biomeForCell(seed, cell + 1), t);
  }

  const b = biomeForCell(seed, cell);
  return blendBiomeVisuals(b, b, 0);
}
