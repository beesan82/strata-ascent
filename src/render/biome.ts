import type { TilePalette } from './tileset/generate';
import { STRATUM_HEIGHT } from '../world/strata';

/** パララックス背景1層の定義 */
export interface BgLayer {
  factor: number;   // カメラ追従率(小さいほど遠い)
  color: string;
  density: number;  // 構造の出現確率
  kind: 'tower' | 'deck' | 'haze';
}

/** バイオーム: 階層帯の見た目一式 */
export interface Biome {
  name: string;
  ambientColor: string;
  ambientLevel: number;   // 0..1
  palette: TilePalette;
  accent: string;
  bgLayers: BgLayer[];
}

export const BIOMES: readonly Biome[] = [
  {
    name: '最下層', ambientColor: '#2e3a44', ambientLevel: 0.34,
    palette: { fillDark: '#141b1f', fillMid: '#26333a', fillLight: '#3a4a52', edge: '#5f7681', line: '#0f1418' },
    accent: '#6f8794',
    bgLayers: [
      { factor: 0.2, color: '#1b2830', density: 0.5, kind: 'tower' },
      { factor: 0.4, color: '#24343d', density: 0.4, kind: 'deck' },
    ],
  },
  {
    name: '居住区跡', ambientColor: '#2c4a4a', ambientLevel: 0.5,
    palette: { fillDark: '#17272a', fillMid: '#2c4747', fillLight: '#436a63', edge: '#7fc0ac', line: '#101f1f' },
    accent: '#9fd8c2',
    bgLayers: [
      { factor: 0.18, color: '#1c3232', density: 0.55, kind: 'tower' },
      { factor: 0.35, color: '#274444', density: 0.5, kind: 'deck' },
      { factor: 0.5, color: '#2f5050', density: 0.3, kind: 'haze' },
    ],
  },
  {
    name: '廃棄物層', ambientColor: '#4a3826', ambientLevel: 0.36,
    palette: { fillDark: '#221812', fillMid: '#3d2c1e', fillLight: '#5c432c', edge: '#b07a45', line: '#160f0a' },
    accent: '#c98f52',
    bgLayers: [
      { factor: 0.2, color: '#2a1f16', density: 0.5, kind: 'tower' },
      { factor: 0.4, color: '#3a2b1d', density: 0.45, kind: 'deck' },
    ],
  },
  {
    name: '大空洞帯', ambientColor: '#2f3f5c', ambientLevel: 0.72,
    palette: { fillDark: '#1a2334', fillMid: '#2f4160', fillLight: '#4a648f', edge: '#8fb4e6', line: '#121a28' },
    accent: '#a9c6ee',
    bgLayers: [
      { factor: 0.12, color: '#233350', density: 0.7, kind: 'tower' },
      { factor: 0.3, color: '#2c4066', density: 0.5, kind: 'deck' },
      { factor: 0.55, color: '#3a588a', density: 0.35, kind: 'haze' },
    ],
  },
  {
    name: '上層', ambientColor: '#3a3a55', ambientLevel: 0.6,
    palette: { fillDark: '#1e1e2c', fillMid: '#34344c', fillLight: '#50506f', edge: '#b6b6e0', line: '#14141e' },
    accent: '#c9a0ff',
    bgLayers: [
      { factor: 0.16, color: '#26263a', density: 0.55, kind: 'tower' },
      { factor: 0.36, color: '#31314a', density: 0.45, kind: 'deck' },
    ],
  },
];

const TRANSITION = 60; // 遷移帯の幅(タイル)

function indexAt(worldY: number): number {
  const altitude = Math.max(0, -worldY);
  return Math.floor(altitude / STRATUM_HEIGHT);
}

/** ワールドy → バイオーム(末尾ループ) */
export function biomeAt(worldY: number): Biome {
  return BIOMES[indexAt(worldY) % BIOMES.length];
}

export interface BiomeBlend {
  from: Biome;
  to: Biome;
  t: number;
  ambientLevel: number;
  ambientColor: string;
}

/** 境界の下側 TRANSITION タイルで from→to を線形補間。帯の外では t=0。境界点は下側バイオームの遷移帯に含む。 */
export function biomeBlend(worldY: number): BiomeBlend {
  const altitude = Math.max(0, -worldY);
  // 高度方向で直上(次)の境界の番号と、その境界までの距離。
  const boundaryIndex = Math.ceil(altitude / STRATUM_HEIGHT);
  const distToNext = boundaryIndex * STRATUM_HEIGHT - altitude;
  let from: Biome;
  let to: Biome;
  let t = 0;
  if (boundaryIndex >= 1 && distToNext < TRANSITION) {
    from = BIOMES[(boundaryIndex - 1) % BIOMES.length];
    to = BIOMES[boundaryIndex % BIOMES.length];
    t = (TRANSITION - distToNext) / TRANSITION;
  } else {
    from = BIOMES[Math.floor(altitude / STRATUM_HEIGHT) % BIOMES.length];
    to = from;
  }
  const ambientLevel = from.ambientLevel + (to.ambientLevel - from.ambientLevel) * t;
  const ambientColor = mixHex(from.ambientColor, to.ambientColor, t);
  return { from, to, t, ambientLevel, ambientColor };
}

/** #rrggbb を線形混合 */
export function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255, ag = (pa >> 8) & 255, ab = pa & 255;
  const br = (pb >> 16) & 255, bg = (pb >> 8) & 255, bb = pb & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}
