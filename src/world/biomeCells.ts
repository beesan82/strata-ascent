export const BIOME_IDS = ['coldSteel', 'habitation', 'disposal', 'waterVoid', 'power'] as const;
export type BiomeId = (typeof BIOME_IDS)[number];

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

const EVEN_BIOME_POOL: readonly BiomeId[] = ['coldSteel', 'habitation'];
const ODD_BIOME_POOL: readonly BiomeId[] = ['disposal', 'waterVoid', 'power'];

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

export function biomeIdForCell(seed: number, cell: number): BiomeId {
  const pool = ((cell % 2) + 2) % 2 === 0 ? EVEN_BIOME_POOL : ODD_BIOME_POOL;
  return pool[unsignedHash(seed, cell) % pool.length];
}
