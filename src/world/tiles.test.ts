import { describe, expect, it } from 'vitest';
import { TILE, isSolid } from './tiles';

describe('isSolid', () => {
  it('SOLID と HARD だけが固体', () => {
    expect(TILE.HARD).toBe(3);
    expect(isSolid(TILE.SOLID)).toBe(true);
    expect(isSolid(TILE.HARD)).toBe(true);
    expect(isSolid(TILE.AIR)).toBe(false);
    expect(isSolid(TILE.LADDER)).toBe(false);
  });
});
