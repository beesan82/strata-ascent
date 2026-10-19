import { describe, expect, it } from 'vitest';
import { displayAltitude, displayY, highestLayer } from './coordinate';

describe('displayY', () => {
  it('rounds a positive signed body coordinate plus body height', () => {
    expect(displayY(100.2, 1.75)).toBe(102);
  });

  it('rounds a negative signed body coordinate plus body height', () => {
    expect(displayY(-100.2, 1.75)).toBe(-98);
  });
});

it('高度は Y の符号を反転(上へ行くほど増える)', () => {
  expect(displayAltitude(-10.75, 1.75)).toBe(9);
  expect(displayAltitude(69.25, 1.75)).toBe(-71);
});

it('到達した最高階層は落下で下がっても減らない', () => {
  expect(highestLayer(2, 1)).toBe(2);
  expect(highestLayer(1, 2)).toBe(2);
});
