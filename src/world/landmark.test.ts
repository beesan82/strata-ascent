import { describe, expect, it } from 'vitest';
import { ANTECHAMBER_DEPTH, interfaceBottom, interfaceTop, mod, passageX } from './interface';
import { TILE } from './tiles';
import {
  collapseRun, collapseWidth, LANDMARK_OFFSET, landmarkAt, landmarkNear, landmarkTileAt, rampTopY, towerTopFloorAt, type Landmark,
} from './landmark';

const seeds = [1, 42, 20260711];
/** 大構造層 × 大構造スロットの全候補 */
const all = (): Landmark[] =>
  seeds.flatMap((s) => [-2, 1, 4].flatMap((c) => [-3, 0, 3].map((k) => landmarkAt(s, c, k)!))).filter((lm) => lm !== null);
const seedOf = (lm: Landmark): number => seeds.find((s) => landmarkAt(s, lm.cell, lm.k)?.x === lm.x && landmarkAt(s, lm.cell, lm.k)?.kind === lm.kind)!;

describe('landmarkAt', () => {
  it('mod(cell,3)===1 の層の mod(k,3)===0 のスロットだけ。中心は孔 +160、上下は板の上面、決定論', () => {
    for (const seed of seeds) for (let cell = -6; cell <= 6; cell++) for (let k = -6; k <= 6; k++) {
      const lm = landmarkAt(seed, cell, k);
      if (mod(cell, 3) !== 1 || mod(k, 3) !== 0) {
        expect(lm).toBe(null);
        continue;
      }
      expect(lm).not.toBe(null);
      expect(lm!.x).toBe(passageX(seed, cell, k) + LANDMARK_OFFSET);
      expect(lm!.top).toBe(interfaceTop(seed, cell));
      expect(lm!.bottom).toBe(interfaceBottom(seed, cell));
      expect(lm!.floor).toBe(interfaceTop(seed, cell + 1));
      expect(landmarkAt(seed, cell, k)).toEqual(lm);
    }
    expect(new Set(all().map((lm) => lm.kind))).toEqual(new Set(['tower', 'collapse']));
  });
});

describe('塔', () => {
  it('外殻は HARD、縦坑は床の板の上から頂部 −4 まで LADDER、環状通路 3 本と基部は AIR、頂部は幅 12 の開口', () => {
    let towers = 0;
    for (const lm of all()) {
      if (lm.kind !== 'tower') continue;
      towers++;
      const seed = seedOf(lm);
      const cx = lm.x;
      for (let y = lm.floor - 1; y >= lm.top - 4; y--) expect(landmarkTileAt(seed, cx, y)).toBe(TILE.LADDER);
      expect(landmarkTileAt(seed, cx, lm.top - 5)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, cx, lm.top - 8)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, cx, lm.top - 9)).toBe(null);
      expect(landmarkTileAt(seed, cx, lm.floor)).toBe(null); // 床の板は界面のもの
      // 頂部の開口は [cx−6, cx+6)
      const t = landmarkTileAt(seed, cx - 6, lm.top - 1);
      expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
      expect(landmarkTileAt(seed, cx - 7, lm.top - 1)).toBe(null);
      expect(landmarkTileAt(seed, cx + 6, lm.top - 1)).toBe(null);
      // 縦坑の脇は AIR、その外は殻
      expect(landmarkTileAt(seed, cx + 1, lm.top + 5)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, cx - 1, lm.bottom + 10)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, cx - 2, lm.bottom + 10)).toBe(TILE.HARD);
      expect(landmarkTileAt(seed, cx - 20, lm.top + 5)).toBe(TILE.HARD); // 板の中も塔の殻
      expect(landmarkTileAt(seed, cx - 20, lm.top)).toBe(TILE.HARD);
      expect(landmarkTileAt(seed, cx - 20, lm.floor - 1)).toBe(TILE.AIR); // 基部の出入口
      expect(landmarkTileAt(seed, cx - 20, lm.floor - 3)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, cx - 20, lm.floor - 4)).toBe(TILE.HARD);
      const H = lm.floor - lm.bottom;
      for (let i = 1; i <= 3; i++) {
        const yi = lm.bottom + Math.round((H * i) / 4);
        expect(landmarkTileAt(seed, cx - 24, yi)).toBe(TILE.AIR);
        expect(landmarkTileAt(seed, cx + 23, yi - 2)).toBe(TILE.AIR);
        expect(landmarkTileAt(seed, cx + 23, yi - 3)).toBe(TILE.HARD);
        expect(landmarkTileAt(seed, cx + 23, yi + 1)).toBe(TILE.HARD);
      }
      expect(landmarkTileAt(seed, cx - 25, lm.top + 5)).toBe(null);
      expect(landmarkTileAt(seed, cx + 24, lm.top + 5)).toBe(null);
      expect(towerTopFloorAt(seed, lm.cell, cx + 5)).toBe(true);
      expect(towerTopFloorAt(seed, lm.cell, cx - 6)).toBe(true);
      expect(towerTopFloorAt(seed, lm.cell, cx + 6)).toBe(false);
      expect(towerTopFloorAt(seed, lm.cell, cx - 7)).toBe(false);
    }
    expect(towers).toBeGreaterThan(0);
  });
});

describe('崩落界面', () => {
  it('幅は通常 160(2 列 1 段)・大界面 144(1 列 1 段)、足は前室の床の行、上端は板の上面の 1 段下、斜路の上は AIR、出口の上は空く', () => {
    expect(collapseWidth(-2)).toBe(144);
    expect(collapseWidth(1)).toBe(160);
    expect(collapseRun(-2)).toBe(1);
    expect(collapseRun(1)).toBe(2);
    let collapses = 0;
    for (const lm of all()) {
      if (lm.kind !== 'collapse') continue;
      collapses++;
      const seed = seedOf(lm);
      expect(lm.gapRight - lm.gapLeft).toBe(collapseWidth(lm.cell));
      expect(lm.gapLeft).toBe(lm.x - collapseWidth(lm.cell) / 2);
      expect(lm.baseY).toBe(lm.bottom + ANTECHAMBER_DEPTH);
      expect(rampTopY(lm, lm.gapLeft)).toBe(lm.baseY);
      expect(rampTopY(lm, lm.gapRight - 1)).toBe(lm.top + 1);
      for (let x = lm.gapLeft; x < lm.gapRight; x++) {
        const r = rampTopY(lm, x);
        expect(landmarkTileAt(seed, x, r)).toBe(TILE.HARD);
        expect(landmarkTileAt(seed, x, lm.baseY)).toBe(TILE.HARD);
        if (r > lm.top) expect(landmarkTileAt(seed, x, r - 1)).toBe(TILE.AIR);
        expect(landmarkTileAt(seed, x, lm.top)).toBe(r === lm.top ? TILE.HARD : TILE.AIR);
        expect(landmarkTileAt(seed, x, lm.top - 1)).not.toBe(null);
        expect(landmarkTileAt(seed, x, lm.top - 1)).not.toBe(TILE.HARD);
        expect(landmarkTileAt(seed, x, lm.top - 9)).toBe(null);
        expect(landmarkTileAt(seed, x, lm.baseY + 1)).toBe(null);
      }
      // 出口の上: 裂け目の右端から 12 列は板の上 8 行が空く(梯子列は残る)
      for (let x = lm.gapRight; x < lm.gapRight + 12; x++) {
        const t = landmarkTileAt(seed, x, lm.top - 8);
        expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
        expect(landmarkTileAt(seed, x, lm.top)).toBe(null);
      }
      expect(landmarkTileAt(seed, lm.gapRight + 12, lm.top - 1)).toBe(null);
      expect(landmarkTileAt(seed, lm.gapLeft - 1, lm.top + 1)).toBe(null);
      expect(landmarkTileAt(seed, lm.gapLeft - 1, lm.top - 1)).toBe(null);
      expect(landmarkTileAt(seed, lm.gapRight, lm.top + 1)).toBe(null);
      expect(towerTopFloorAt(seed, lm.cell, lm.x)).toBe(false);
    }
    expect(collapses).toBeGreaterThan(0);
  });
});

describe('landmarkNear', () => {
  it('幾何に掛かる x でだけ返す', () => {
    for (const lm of all()) {
      const seed = seedOf(lm);
      expect(landmarkNear(seed, lm.cell, lm.x)).toEqual(lm);
      if (lm.kind === 'tower') {
        expect(landmarkNear(seed, lm.cell, lm.x - 24)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.x - 25)).toBe(null);
        expect(landmarkNear(seed, lm.cell, lm.x + 24)).toBe(null);
      } else {
        expect(landmarkNear(seed, lm.cell, lm.gapLeft)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.gapLeft - 1)).toBe(null);
        expect(landmarkNear(seed, lm.cell, lm.gapRight + 11)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.gapRight + 12)).toBe(null);
      }
    }
    expect(landmarkNear(42, 0, 100)).toBe(null); // 大構造層でない
  });
});
