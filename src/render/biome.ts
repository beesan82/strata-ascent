import type { TilePalette } from './tileset/generate';
import { regionAt, type System } from '../world/hierarchy';
import { mixHex, steelPalette } from './steel';
export { mixHex };

/** パララックス背景1層の定義 */
export interface BgLayer {
  factor: number;   // カメラ追従率(小さいほど遠い)
  color: string;
  density: number;  // 構造の出現確率
  kind: 'tower' | 'deck' | 'haze';
}

/** バイオーム: 系統(地域)ごとの見た目一式 */
export interface Biome {
  name: string;
  ambientColor: string;
  ambientLevel: number;   // 0..1
  palette: TilePalette;
  accent: string;
  bgLayers: BgLayer[];
}

/** 背景レイヤー色: 奥(添字小)ほど暗い鋼ランプ+微量ティント */
const bgColor = (tint: string, i: number): string =>
  mixHex(['#05080d', '#070c12', '#0a1017'][Math.min(i, 2)], tint, 0.05);

const bg = (
  tint: string,
  defs: ReadonlyArray<readonly [number, number, BgLayer['kind']]>,
): BgLayer[] =>
  defs.map(([factor, density, kind], i) => ({ factor, density, kind, color: bgColor(tint, i) }));

export const BIOMES: readonly Biome[] = [
  // BIOMES[0] (最下層) は SYSTEM_BIOME 未使用の予備パレット(温存)。
  {
    name: '最下層', ambientColor: mixHex('#2e3a44', '#020408', 0.72), ambientLevel: 0.34,
    palette: steelPalette('#6f8794'), accent: '#6f8794',
    bgLayers: bg('#6f8794', [[0.2, 0.5, 'tower'], [0.4, 0.4, 'deck']]),
  },
  {
    name: '居住区跡', ambientColor: mixHex('#2c4a4a', '#020408', 0.72), ambientLevel: 0.5,
    palette: steelPalette('#7fc0ac'), accent: '#9fd8c2',
    bgLayers: bg('#7fc0ac', [[0.18, 0.55, 'tower'], [0.35, 0.5, 'deck'], [0.5, 0.3, 'haze']]),
  },
  {
    name: '廃棄物層', ambientColor: mixHex('#4a3826', '#020408', 0.72), ambientLevel: 0.36,
    palette: steelPalette('#b07a45'), accent: '#c98f52',
    bgLayers: bg('#b07a45', [[0.2, 0.5, 'tower'], [0.4, 0.45, 'deck']]),
  },
  {
    name: '大空洞帯', ambientColor: mixHex('#2f3f5c', '#020408', 0.66), ambientLevel: 0.72,
    palette: steelPalette('#8fb4e6'), accent: '#a9c6ee',
    bgLayers: bg('#8fb4e6', [[0.12, 0.7, 'tower'], [0.3, 0.5, 'deck'], [0.55, 0.35, 'haze']]),
  },
  {
    name: '上層', ambientColor: mixHex('#3a3a55', '#020408', 0.72), ambientLevel: 0.6,
    palette: steelPalette('#b6b6e0'), accent: '#c9a0ff',
    bgLayers: bg('#b6b6e0', [[0.16, 0.55, 'tower'], [0.36, 0.45, 'deck']]),
  },
];

/** 精錬炉(foundry): 溶鉱の赤熱を帯びた系統配色 */
const FOUNDRY: Biome = {
  name: '精錬炉', ambientColor: mixHex('#4a2620', '#020408', 0.72), ambientLevel: 0.44,
  palette: steelPalette('#d06a3c'), accent: '#e8834a',
  bgLayers: bg('#d06a3c', [[0.2, 0.5, 'tower'], [0.4, 0.45, 'deck']]),
};

/** 系統 → バイオーム配色。地域(REGION)の系統でワールドを塗り分ける。 */
export const SYSTEM_BIOME: Record<System, Biome> = {
  water: BIOMES[3],
  habitation: BIOMES[1],
  disposal: BIOMES[2],
  power: BIOMES[4],
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
}

/** ワールド座標 → その地域(系統)のバイオーム */
export function biomeAt(seed: number, x: number, y: number): Biome {
  return SYSTEM_BIOME[regionAt(seed, x, y).system];
}

/** 地域ベースでは地域内は単色。from=to=地域配色, t=0。 */
export function biomeBlend(seed: number, x: number, y: number): BiomeBlend {
  const b = biomeAt(seed, x, y);
  return { from: b, to: b, t: 0, ambientLevel: b.ambientLevel, ambientColor: b.ambientColor };
}
