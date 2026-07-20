import { describe, expect, it } from 'vitest';
import { biomeForSystem, biomeAt, biomeBlend, mixHex, SYSTEM_BIOME } from './biome';
import { regionAt, REGION_SIZE } from '../world/hierarchy';
import { relLum } from './steel';

describe('biomeForSystem', () => {
  it('biomeForSystem は SYSTEM_BIOME と一致', () => {
    expect(biomeForSystem('water')).toBe(SYSTEM_BIOME.water);
    expect(biomeForSystem('foundry')).toBe(SYSTEM_BIOME.foundry);
  });
  it('全系統に配色があり、パラメータが妥当', () => {
    for (const sys of ['water', 'power', 'habitation', 'disposal', 'foundry'] as const) {
      const b = SYSTEM_BIOME[sys];
      expect(b.ambientLevel).toBeGreaterThan(0);
      expect(b.ambientLevel).toBeLessThanOrEqual(1);
      expect(b.palette.fillMid).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.ambientColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(b.bgLayers.length).toBeGreaterThanOrEqual(2);
    }
  });
  it('系統ごとに異なる配色(fillMid が全て異なる)', () => {
    const mids = new Set(['water', 'power', 'habitation', 'disposal', 'foundry'].map(
      (s) => SYSTEM_BIOME[s as keyof typeof SYSTEM_BIOME].palette.fillMid));
    expect(mids.size).toBe(5);
  });
});

describe('biomeAt(地域ベース)', () => {
  it('その座標の地域 system の配色を返す(決定論)', () => {
    const b = biomeAt(42, 5000, -3000);
    expect(biomeAt(42, 5000, -3000)).toBe(b);
    expect(b).toBe(SYSTEM_BIOME[regionAt(42, 5000, -3000).system]);
  });
  it('別地域で複数 system が存在', () => {
    const systems = new Set<string>();
    for (let i = 0; i < 24; i++) systems.add(regionAt(42, i * REGION_SIZE, 0).system);
    expect(systems.size).toBeGreaterThan(1);
  });
});

describe('biomeBlend(地域ベース)', () => {
  it('地域内は from=to=地域配色, t=0(決定論)', () => {
    const bb = biomeBlend(42, 5000, -3000);
    expect(biomeBlend(42, 5000, -3000)).toEqual(bb);
    expect(bb.t).toBe(0);
    expect(bb.from).toBe(bb.to);
    expect(bb.ambientColor).toBe(bb.from.ambientColor);
    expect(bb.ambientLevel).toBe(bb.from.ambientLevel);
  });
});

describe('トーン再設計(realismモック水準)', () => {
  const systems = ['water', 'power', 'habitation', 'disposal', 'foundry'] as const;
  it('全系統: 基調はほぼ黒(fillMid 輝度 < 0.03)', () => {
    for (const s of systems) {
      expect(relLum(SYSTEM_BIOME[s].palette.fillMid)).toBeLessThan(0.03);
    }
  });
  it('全系統: 明度4段 fillDark < fillMid < fillLight < edge', () => {
    for (const s of systems) {
      const p = SYSTEM_BIOME[s].palette;
      expect(relLum(p.fillDark)).toBeLessThan(relLum(p.fillMid));
      expect(relLum(p.fillMid)).toBeLessThan(relLum(p.fillLight));
      expect(relLum(p.fillLight)).toBeLessThan(relLum(p.edge));
    }
  });
  it('全系統: 環境色も暗い(ambientColor 輝度 < 0.03)', () => {
    for (const s of systems) {
      expect(relLum(SYSTEM_BIOME[s].ambientColor)).toBeLessThan(0.03);
    }
  });
  it('全系統: 背景レイヤーは基調タイルより暗い(遠いほど暗い原則)', () => {
    for (const s of systems) {
      const b = SYSTEM_BIOME[s];
      for (const L of b.bgLayers) {
        expect(relLum(L.color)).toBeLessThanOrEqual(relLum(b.palette.fillMid) + 1e-6);
      }
    }
  });
});

describe('mixHex', () => {
  it('端点と中点', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
});
