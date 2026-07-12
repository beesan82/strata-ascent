import { describe, expect, it } from 'vitest';
import { BIOMES, biomeAt, biomeBlend, mixHex } from './biome';

describe('biomeAt', () => {
  it('地表(y=0)は最初のバイオーム、深いほど進む(yは上が負)', () => {
    expect(biomeAt(0)).toBe(BIOMES[0]);
    expect(biomeAt(-600)).toBe(BIOMES[1]);
  });
  it('末尾以降はループ(strataと同じ)', () => {
    expect(biomeAt(-500 * BIOMES.length)).toBe(BIOMES[0]);
  });
  it('各バイオームのパラメータが妥当な範囲', () => {
    for (const b of BIOMES) {
      expect(b.ambientLevel).toBeGreaterThan(0);
      expect(b.ambientLevel).toBeLessThanOrEqual(1);
      expect(b.palette.fillMid).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.ambientColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.bgLayers.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('mixHex', () => {
  it('t=0でa、t=1でb', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
  });
  it('中間は各チャンネルの中点', () => {
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});

describe('biomeBlend', () => {
  it('境界(高度500)近傍でtは0..1', () => {
    const mid = biomeBlend(-500);
    expect(mid.t).toBeGreaterThanOrEqual(0);
    expect(mid.t).toBeLessThanOrEqual(1);
    expect([mid.from, mid.to]).toContain(BIOMES[0]);
  });
  it('遷移帯の外(帯中央)はt=0で単一バイオーム', () => {
    const deep = biomeBlend(-250);
    expect(deep.t).toBe(0);
    expect(deep.from).toBe(BIOMES[0]);
    expect(deep.to).toBe(BIOMES[0]);
  });
  it('補間した環境光レベルは両端の間', () => {
    const b = biomeBlend(-480);
    const lo = Math.min(b.from.ambientLevel, b.to.ambientLevel);
    const hi = Math.max(b.from.ambientLevel, b.to.ambientLevel);
    expect(b.ambientLevel).toBeGreaterThanOrEqual(lo - 1e-9);
    expect(b.ambientLevel).toBeLessThanOrEqual(hi + 1e-9);
  });
  it('決定論的', () => {
    expect(biomeBlend(-480)).toEqual(biomeBlend(-480));
  });
});
