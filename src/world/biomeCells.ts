import { hash2 } from './noise';

export const BIOME_IDS = ['coldSteel', 'habitation', 'disposal', 'waterVoid', 'power'] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

/** 地区名（字幕で宣言する地名。設計書 2026-11-04-zones-design §2.3 のカタログ名） */
export const BIOME_DISTRICT_NAME: Record<BiomeId, string> = {
  coldSteel: '寒鋼基層',
  habitation: '居住区画',
  disposal: '廃棄沈殿層',
  waterVoid: '大空洞水域',
  power: '電力区',
};

export function districtNameForCell(seed: number, cell: number): string {
  return BIOME_DISTRICT_NAME[biomeIdForCell(seed, cell)];
}

export const BIOME_CELL_BASE = 375;
export const BIOME_CELL_JITTER = 75;
export const BIOME_BLEND_HALF_WIDTH = 50;

const signedHash = (seed: number, cell: number, sign: number): number => {
  let hash = (seed | 0) ^ Math.imul(cell | 0, 0x9e3779b1);
  hash = Math.imul(hash ^ (sign < 0 ? 0x85ebca6b : 0xc2b2ae35), 0x27d4eb2d);
  hash ^= hash >>> 15;
  return Math.imul(hash, 0x85ebca6b);
};

const cellSign = (cell: number): number => cell < 0 ? -1 : 1;

const unsignedHash = (seed: number, cell: number): number =>
  signedHash(seed, cell, cellSign(cell)) >>> 0;

const biomeJitter = (seed: number, cell: number): number =>
  (unsignedHash(seed, cell) % (BIOME_CELL_JITTER + 1)) - Math.floor(BIOME_CELL_JITTER / 2);

export function biomeBoundary(seed: number, cell: number): number {
  return cell * BIOME_CELL_BASE + biomeJitter(seed, cell);
}

export function biomeCellAt(seed: number, y: number): number {
  let cell = Math.floor(y / BIOME_CELL_BASE);
  while (y < biomeBoundary(seed, cell)) cell--;
  while (y >= biomeBoundary(seed, cell + 1)) cell++;
  return cell;
}

/** 巡回シャッフル専用の salt（他のハッシュ用途と混ざらないよう分ける） */
const CYCLE_SALT = 707;

/** サイクル（地区数ぶんのセル）の基礎順序。決定的 Fisher–Yates シャッフル */
function cyclePermutation(seed: number, cycle: number): BiomeId[] {
  const perm = [...BIOME_IDS];
  for (let i = perm.length - 1; i > 0; i--) {
    const j = Math.floor(hash2(seed + CYCLE_SALT, cycle, i) * (i + 1));
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  return perm;
}

/**
 * サイクルの末尾地区。末尾は「先頭の入替」の影響を受けないため、
 * 基礎順序と cell 0 / cell -1 の末尾調整だけから直接求まる。
 */
function cycleLast(seed: number, cycle: number): BiomeId {
  if (cycle === 0) return finalCyclePermutation(seed, 0)[BIOME_IDS.length - 1];
  const perm = cyclePermutation(seed, cycle);
  // cell 0（寒鋼固定）との境界調整後の末尾
  if (cycle === -1 && perm[BIOME_IDS.length - 1] === 'coldSteel') return perm[BIOME_IDS.length - 2];
  return perm[BIOME_IDS.length - 1];
}

/** 調整込みのサイクル順序: cell 0 は寒鋼固定、サイクル境界で同地区が連続しない */
function finalCyclePermutation(seed: number, cycle: number): BiomeId[] {
  const perm = cyclePermutation(seed, cycle);
  const last = BIOME_IDS.length - 1;
  if (cycle === 0) {
    // 開始セル（スポーン直後）の体験を保証するため先頭を寒鋼に固定する
    const idx = perm.indexOf('coldSteel');
    [perm[0], perm[idx]] = [perm[idx], perm[0]];
    return perm;
  }
  if (cycle === -1 && perm[last] === 'coldSteel') {
    // cell 0 が寒鋼固定のため、直前セルの末尾が寒鋼だと境界で連続してしまう
    [perm[last - 1], perm[last]] = [perm[last], perm[last - 1]];
  }
  if (perm[0] === cycleLast(seed, cycle - 1)) {
    [perm[0], perm[1]] = [perm[1], perm[0]];
  }
  return perm;
}

/**
 * セルの地区（ゾーン）。地区数ぶんのセルを 1 サイクルとする決定論巡回で割り当てる:
 * サイクル内は全地区が重複なく 1 回ずつ現れ、サイクル境界でも同地区は連続しない。
 */
export function biomeIdForCell(seed: number, cell: number): BiomeId {
  const cycle = Math.floor(cell / BIOME_IDS.length);
  const pos = cell - cycle * BIOME_IDS.length;
  return finalCyclePermutation(seed, cycle)[pos];
}
