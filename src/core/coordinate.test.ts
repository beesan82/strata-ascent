import { describe, expect, it } from 'vitest';
import { displayY } from './coordinate';

describe('displayY', () => {
  it('rounds a positive signed body coordinate plus body height', () => {
    expect(displayY(100.2, 1.75)).toBe(102);
  });

  it('rounds a negative signed body coordinate plus body height', () => {
    expect(displayY(-100.2, 1.75)).toBe(-98);
  });
});
