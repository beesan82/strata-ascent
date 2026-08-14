import type { TilePalette } from './tileset/generate';
import type { System } from '../world/hierarchy';
import { mixHex, steelPalette, STEEL } from './steel';
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

/** 背景レイヤーの基準色(STEELランプのみから導出)。奥(添字小)ほど暗い。bgLayersは最大3層前提。 */
const BG_BASES = [mixHex(STEEL.black, STEEL.far, 0.5), STEEL.far, mixHex(STEEL.far, STEEL.base, 0.5)];

/** 背景レイヤー色: 奥(添字小)ほど暗い鋼ランプ+微量ティント */
const bgColor = (tint: string, i: number): string =>
  mixHex(BG_BASES[Math.min(i, 2)], tint, 0.05);

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
    name: '大空洞帯', ambientColor: mixHex('#2f3f5c', '#020408', 0.66), ambientLevel: 0.72, // 最も開けた系統だけ僅かに環境色を残す
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
export const BIOME_CELL_BASE = 1500;
export const BIOME_CELL_JITTER = 150;
export const BIOME_BLEND_HALF_WIDTH = 200;

const signedHash = (seed: number, cell: number, sign: number): number => {
  let hash = (seed | 0) ^ Math.imul(cell | 0, 0x9e3779b1);
  hash = Math.imul(hash ^ (sign < 0 ? 0x85ebca6b : 0xc2b2ae35), 0x27d4eb2d);
  hash ^= hash >>> 15;
  return Math.imul(hash, 0x85ebca6b) >>> 0;
};

const cellSign = (cell: number): number => cell < 0 ? -1 : 1;

const biomeJitter = (seed: number, cell: number): number =>
  (signedHash(seed, cell, cellSign(cell)) % (BIOME_CELL_JITTER * 2 + 1)) - BIOME_CELL_JITTER;

export function biomeBoundary(seed: number, cell: number): number {
  return cell * BIOME_CELL_BASE + biomeJitter(seed, cell);
}

export function biomeCellAt(seed: number, y: number): number {
  let cell = Math.floor(y / BIOME_CELL_BASE);
  while (y < biomeBoundary(seed, cell)) cell--;
  while (y >= biomeBoundary(seed, cell + 1)) cell++;
  return cell;
}

export function biomeForCell(seed: number, cell: number): Biome {
  const pool = ((cell % 2) + 2) % 2 === 0 ? [0, 1] : [2, 3, 4];
  const index = pool[signedHash(seed, cell, cellSign(cell)) % pool.length];
  return BIOMES[index] ?? BIOMES[0];
}

export function biomeAt(seed: number, x: number, y: number): Biome {
  void x;
  return biomeForCell(seed, biomeCellAt(seed, y));
}

/** 地域ベースでは地域内は単色。from=to=地域配色, t=0。 */
const blend = (from: Biome, to: Biome, t: number): BiomeBlend => ({
  from,
  to,
  t,
  ambientLevel: from.ambientLevel + (to.ambientLevel - from.ambientLevel) * t,
  ambientColor: mixHex(from.ambientColor, to.ambientColor, t),
});

export function biomeBlend(seed: number, x: number, y: number): BiomeBlend {
  void x;
  const cell = biomeCellAt(seed, y);
  const lowerBoundary = biomeBoundary(seed, cell);
  const upperBoundary = biomeBoundary(seed, cell + 1);

  if (y < lowerBoundary + BIOME_BLEND_HALF_WIDTH) {
    const t = (y - (lowerBoundary - BIOME_BLEND_HALF_WIDTH)) / (BIOME_BLEND_HALF_WIDTH * 2);
    return blend(biomeForCell(seed, cell - 1), biomeForCell(seed, cell), t);
  }

  if (y >= upperBoundary - BIOME_BLEND_HALF_WIDTH) {
    const t = (y - (upperBoundary - BIOME_BLEND_HALF_WIDTH)) / (BIOME_BLEND_HALF_WIDTH * 2);
    return blend(biomeForCell(seed, cell), biomeForCell(seed, cell + 1), t);
  }

  const b = biomeForCell(seed, cell);
  return { from: b, to: b, t: 0, ambientLevel: b.ambientLevel, ambientColor: b.ambientColor };
}
