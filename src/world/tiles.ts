export const TILE = {
  AIR: 0,
  SOLID: 1,
  LADDER: 2,
} as const;

export type Tile = (typeof TILE)[keyof typeof TILE];

export const CHUNK_SIZE = 64;
