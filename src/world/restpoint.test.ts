import { describe, expect, it } from 'vitest';
import { groupLadderX, interfaceBottom, interfaceTop, passageX } from './interface';
import { TILE } from './tiles';
import { nearestRestPoint, restPointAt, restPointTileAt, restWarmthAt } from './restpoint';

const seeds = [1, 42, 20260711];

describe('restPointAt', () => {
  it('床は層の 40〜60%、X は上下の孔の中点 ±64、箱に 32 タイル梯子列が 1 本入る、灯は 3〜5 個', () => {
    for (const seed of seeds) for (let cell = -4; cell <= 3; cell++) for (const k of [-3, 0, 2]) {
      const rp = restPointAt(seed, cell, k);
      const bottom = interfaceBottom(seed, cell);
      const H = interfaceTop(seed, cell + 1) - bottom;
      expect(rp.floorY).toBeGreaterThanOrEqual(bottom + 0.4 * H - 1);
      expect(rp.floorY).toBeLessThanOrEqual(bottom + 0.6 * H + 1);
      const mid = (passageX(seed, cell + 1, k) + passageX(seed, cell, k)) / 2;
      expect(Math.abs(rp.x - mid)).toBeLessThanOrEqual(64);
      expect(rp.left).toBe(rp.x - 16);
      expect(rp.right).toBe(rp.x + 15);
      let ladders = 0;
      for (let x = rp.left; x <= rp.right; x++) if (x === groupLadderX(seed, x)) ladders++;
      expect(ladders).toBeGreaterThanOrEqual(1);
      expect(rp.lamps.length).toBeGreaterThanOrEqual(3);
      expect(rp.lamps.length).toBeLessThanOrEqual(5);
      for (const lx of rp.lamps) {
        expect(lx).toBeGreaterThan(rp.left);
        expect(lx).toBeLessThan(rp.right);
        expect(lx === groupLadderX(seed, lx)).toBe(false);
      }
      expect(rp.packX).toBe(rp.right - 3);
      expect(rp.tallyY).toBe(rp.floorY - 6);
    }
  });
  it('決定論: 同入力同出力', () => {
    expect(restPointAt(42, 1, 2)).toEqual(restPointAt(42, 1, 2));
    expect(restPointAt(42, 1, 2).x).not.toBe(restPointAt(43, 1, 2).x);
  });
});

describe('restPointTileAt', () => {
  it('床と天井は SOLID、壁は上 10 行 SOLID・下 3 行 AIR(出入口)、中は AIR、梯子列は残る、外は null', () => {
    const rp = restPointAt(42, 0, 0);
    expect(restPointTileAt(42, rp.x, rp.floorY)).toBe(TILE.SOLID);
    expect(restPointTileAt(42, rp.x, rp.floorY - 13)).toBe(TILE.SOLID);
    expect(restPointTileAt(42, rp.left, rp.floorY - 6)).toBe(TILE.SOLID);
    expect(restPointTileAt(42, rp.left, rp.floorY - 4)).toBe(TILE.SOLID);
    expect(restPointTileAt(42, rp.left, rp.floorY - 1)).toBe(TILE.AIR);
    expect(restPointTileAt(42, rp.right, rp.floorY - 3)).toBe(TILE.AIR);
    expect(restPointTileAt(42, rp.x, rp.floorY - 14)).toBe(null);
    expect(restPointTileAt(42, rp.x, rp.floorY + 1)).toBe(null);
    expect(restPointTileAt(42, rp.left - 1, rp.floorY)).toBe(null);
    expect(restPointTileAt(42, rp.right + 1, rp.floorY)).toBe(null);
    let ladders = 0;
    for (let x = rp.left; x <= rp.right; x++) if (x === groupLadderX(42, x)) {
      ladders++;
      expect(restPointTileAt(42, x, rp.floorY)).toBe(TILE.LADDER);
      expect(restPointTileAt(42, x, rp.floorY - 13)).toBe(TILE.LADDER);
      expect(restPointTileAt(42, x, rp.floorY - 5)).toBe(TILE.LADDER);
    }
    expect(ladders).toBeGreaterThanOrEqual(1);
    let air = 0;
    for (let x = rp.left + 1; x < rp.right; x++) for (let y = rp.floorY - 12; y < rp.floorY; y++) if (restPointTileAt(42, x, y) === TILE.AIR) air++;
    expect(air).toBeGreaterThan(30 * 12 - 13 * ladders - 1);
  });
});

describe('nearestRestPoint / restWarmthAt', () => {
  it('nearestRestPoint は y の層の最寄り。restWarmthAt は箱の中で 1、12 タイル先で 0', () => {
    const rp = restPointAt(20260711, -1, 1);
    expect(nearestRestPoint(20260711, rp.x + 100, rp.floorY)).toEqual(rp);
    expect(nearestRestPoint(20260711, rp.x - 100, rp.floorY - 50)).toEqual(rp);
    expect(restWarmthAt(20260711, rp.x, rp.floorY - 5)).toBe(1);
    expect(restWarmthAt(20260711, rp.left, rp.floorY - 13)).toBe(1);
    expect(restWarmthAt(20260711, rp.right + 6, rp.floorY - 5)).toBeCloseTo(0.5, 5);
    expect(restWarmthAt(20260711, rp.x, rp.floorY + 6)).toBeCloseTo(0.5, 5);
    expect(restWarmthAt(20260711, rp.right + 12, rp.floorY - 5)).toBe(0);
    expect(restWarmthAt(20260711, rp.x + 300, rp.floorY)).toBe(0);
  });
});
