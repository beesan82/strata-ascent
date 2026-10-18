export const TILE = {
  AIR: 0,
  SOLID: 1,
  LADDER: 2,
  /** 破壊不能の固体(界面の板など)。物理・描画では SOLID と同様に扱う */
  HARD: 3,
} as const;

export type Tile = (typeof TILE)[keyof typeof TILE];

export const CHUNK_SIZE = 64;

/** 固体か(SOLID または HARD) */
export function isSolid(t: number): boolean {
  return t === TILE.SOLID || t === TILE.HARD;
}
