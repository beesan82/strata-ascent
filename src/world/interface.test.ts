import { describe, expect, it } from 'vitest';
import { biomeBoundary } from './biomeCells';
import { TILE } from './tiles';
import {
  ANTECHAMBER_DEPTH, groupLadderX, HOLE_OFFSET, interfaceBottom, interfaceThickness, interfaceTileAt, interfaceTop,
  isGreatInterface, layerNumber, mod, nearestPassage, overlookCellAt, OVERLOOK_LEFT, passageX, PASSAGE_SLOT, terrainModsAt,
} from './interface';

import { landmarkAt, towerTopFloorAt } from './landmark';

const seeds = [1, 42, 20260711];

describe('interface geometry', () => {
  it('mod は負数でも非負', () => {
    expect(mod(-1, 4)).toBe(3);
    expect(mod(-6, 4)).toBe(2);
  });
  it('大界面は mod(cell,4)===2 だけ。cell 0 は通常', () => {
    expect(isGreatInterface(0)).toBe(false);
    expect(isGreatInterface(2)).toBe(true);
    expect(isGreatInterface(-2)).toBe(true);
    expect(interfaceThickness(0)).toBe(32);
    expect(interfaceThickness(2)).toBe(96);
  });
  it('上面は景観セル境界、下面は上面+厚み', () => {
    for (const seed of seeds) for (let cell = -5; cell <= 5; cell++) {
      expect(interfaceTop(seed, cell)).toBe(biomeBoundary(seed, cell));
      expect(interfaceBottom(seed, cell) - interfaceTop(seed, cell)).toBe(interfaceThickness(cell));
    }
  });
  it('孔の間隔は 256〜512、最寄りまで 256 以内', () => {
    for (const seed of seeds) for (let cell = -5; cell <= 5; cell++) {
      for (let k = -20; k < 20; k++) {
        const d = passageX(seed, cell, k + 1) - passageX(seed, cell, k);
        expect(d).toBeGreaterThanOrEqual(256);
        expect(d).toBeLessThanOrEqual(512);
        const px = passageX(seed, cell, k);
        expect(Math.abs(px - (k * PASSAGE_SLOT + PASSAGE_SLOT / 2))).toBeLessThanOrEqual(64);
      }
      for (let x = -3000; x <= 3000; x += 37) {
        const n = nearestPassage(seed, cell, x);
        expect(Math.abs(n.x - x)).toBeLessThanOrEqual(256);
        expect(passageX(seed, cell, n.k)).toBe(n.x);
      }
    }
  });
  it('決定論: 同入力同出力、シード差で変わる', () => {
    expect(passageX(42, 1, 3)).toBe(passageX(42, 1, 3));
    expect([passageX(1, 1, 3), passageX(2, 1, 3), passageX(3, 1, 3)].some((v) => v !== passageX(1, 1, 3))).toBe(true);
  });
});

describe('interfaceTileAt', () => {
  const cases = seeds.flatMap((seed) => [-3, -2, 0, 1, 2].flatMap((cell) => [-2, 0, 3].map((k) => ({ seed, cell, k }))));
  it('板は HARD、孔の梯子は上端-4から前室の底の1段上まで LADDER', () => {
    for (const { seed, cell, k } of cases) {
      const top = interfaceTop(seed, cell), bottom = interfaceBottom(seed, cell);
      const px = passageX(seed, cell, k);
      for (let y = top - 4; y < bottom + ANTECHAMBER_DEPTH; y++) expect(interfaceTileAt(seed, px, y)).toBe(TILE.LADDER);
      // 梯子列の上端は top-4 だが、その上 8 行は見晴らし台(AIR)。その更に上は null
      expect(interfaceTileAt(seed, px, top - 5)).toBe(TILE.AIR);
      expect(interfaceTileAt(seed, px, top - 9)).toBe(null);
      expect(interfaceTileAt(seed, px, bottom + ANTECHAMBER_DEPTH)).toBe(null);
      for (let y = top; y < bottom; y++) expect(interfaceTileAt(seed, px - 100, y)).toBe(TILE.HARD);
      expect(interfaceTileAt(seed, px - 100, top - 1)).toBe(null);
      expect(interfaceTileAt(seed, px - 100, bottom)).toBe(null);
    }
  });
  it('縦坑の脇は AIR(通常幅3・大界面幅5)、大界面は踊り場の行が HARD', () => {
    const seed = 42;
    const px0 = passageX(seed, 0, 0), top0 = interfaceTop(seed, 0);
    expect(interfaceTileAt(seed, px0 + 1, top0 + 5)).toBe(TILE.AIR);
    expect(interfaceTileAt(seed, px0 + 2, top0 + 5)).toBe(TILE.HARD);
    const px2 = passageX(seed, 2, 0), top2 = interfaceTop(seed, 2);
    expect(interfaceTileAt(seed, px2 + 2, top2 + 5)).toBe(TILE.AIR);
    expect(interfaceTileAt(seed, px2 + 3, top2 + 5)).toBe(TILE.HARD);
    expect(interfaceTileAt(seed, px2 + 2, top2 + 32)).toBe(TILE.HARD);
    expect(interfaceTileAt(seed, px2, top2 + 32)).toBe(TILE.LADDER);
    expect(interfaceTileAt(seed, px2 + 2, top2 + Math.round((2 * 96) / 3))).toBe(TILE.HARD); // 2 段目の踊り場
  });
  it('見晴らし台は板の上 8 行が空気、大穴は板を貫通、梯子列は板の上で残る', () => {
    for (const { seed, cell, k } of cases) {
      const top = interfaceTop(seed, cell), bottom = interfaceBottom(seed, cell);
      const px = passageX(seed, cell, k);
      for (let x = px - 12; x < px + 72; x++) for (let y = top - 8; y < top; y++) {
        const t = interfaceTileAt(seed, x, y);
        expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
        if (x === groupLadderX(seed, x) && x !== px) expect(t).toBe(TILE.LADDER);
      }
      for (let x = px + 24; x < px + 72; x++) for (let y = top; y < bottom + 4; y++) expect(interfaceTileAt(seed, x, y)).toBe(TILE.AIR);
      const half = isGreatInterface(cell) ? 2 : 1;
      for (let x = px - 12; x < px + 24; x++) if (Math.abs(x - px) > half) expect(interfaceTileAt(seed, x, top)).toBe(TILE.HARD);
      expect(interfaceTileAt(seed, px - 13, top - 1)).toBe(null);
      expect(interfaceTileAt(seed, px + 72, top - 1)).toBe(null); // 見晴らし台の右端(排他)
    }
  });
});

describe('terrainModsAt', () => {
  it('前室の内側は強制空洞+梯子抑止、縁で線形に戻り、底は床、下は圧縮', () => {
    const seed = 42, cell = 0;
    const bottom = interfaceBottom(seed, cell), px = passageX(seed, cell, 0);
    expect(terrainModsAt(seed, px + 50, bottom + 10, cell)).toEqual({ cavityScale: 0, massDrop: 0, suppressLadder: true, forceFloor: false });
    expect(terrainModsAt(seed, px + 140, bottom + 10, cell)!.cavityScale).toBeCloseTo(0.5, 5);
    expect(terrainModsAt(seed, px + 140, bottom + 10, cell)!.suppressLadder).toBe(false);
    expect(terrainModsAt(seed, px + 160, bottom + 10, cell)).toBe(null);
    expect(terrainModsAt(seed, px - 120, bottom + 48, cell)!.forceFloor).toBe(true);
    expect(terrainModsAt(seed, px, bottom + 80, cell)!.massDrop).toBeCloseTo(0.15, 5);
    expect(terrainModsAt(seed, px, bottom + 109, cell)).toBe(null);
    expect(terrainModsAt(seed, px, bottom - 1, cell)).toBe(null);
  });
});

describe('layerNumber', () => {
  it('開始層 cell 0 は第 1 階層、上(cell が小さい)へ 1 ずつ増え、決定論', () => {
    expect(layerNumber(20260711, 0)).toBe(1);
    expect(layerNumber(20260711, -1)).toBe(2);
    expect(layerNumber(20260711, 1)).toBe(0);
    for (let c = 5; c > -10; c--) expect(layerNumber(42, c - 1)).toBe(layerNumber(42, c) + 1);
    expect(layerNumber(1, -3)).toBe(layerNumber(2, -3));
  });
});

describe('overlookCellAt', () => {
  it('seed 20260711 の cell 0: 板の上面 −9 に立つ X 184〜219(梯子列 196 を除く)で 0、大穴側・他の行は null', () => {
    const seed = 20260711;
    const top = interfaceTop(seed, 0);
    const px = passageX(seed, 0, 0);
    expect(top).toBe(-9);
    expect(px).toBe(196);
    expect(overlookCellAt(seed, 210, top)).toBe(0);
    expect(overlookCellAt(seed, px - OVERLOOK_LEFT, top)).toBe(0);
    expect(overlookCellAt(seed, px, top)).toBe(null);
    expect(overlookCellAt(seed, px + HOLE_OFFSET, top)).toBe(null);
    expect(overlookCellAt(seed, px - OVERLOOK_LEFT - 1, top)).toBe(null);
    expect(overlookCellAt(seed, 210, top + 1)).toBe(null);
    expect(overlookCellAt(seed, 210, top - 1)).toBe(null);
  });
  it('大界面(cell −2、縦坑 ±2)でも見晴らし台の X 範囲で cell を返し、縦坑の列は null', () => {
    const seed = 20260711;
    const cell = -2;
    const top = interfaceTop(seed, cell);
    const px = passageX(seed, cell, 0);
    expect(isGreatInterface(cell)).toBe(true);
    expect(overlookCellAt(seed, px + 4, top)).toBe(cell);
    expect(overlookCellAt(seed, px - OVERLOOK_LEFT, top)).toBe(cell);
    expect(overlookCellAt(seed, px, top)).toBe(null);
    expect(overlookCellAt(seed, px + HOLE_OFFSET, top)).toBe(null);
    expect(overlookCellAt(seed, px + 4, top + 1)).toBe(null);
  });
  it('塔の頂部の床(幅 12、梯子列を除く)でも述語を渡せばその板の cell を返す。述語無しなら null', () => {
    let towers = 0;
    for (const seed of seeds) for (const cell of [-2, 1]) for (const k of [-3, 0, 3]) {
      const lm = landmarkAt(seed, cell, k)!;
      if (lm.kind !== 'tower') continue;
      towers++;
      const towerTop = (c: number, x: number) => towerTopFloorAt(seed, c, x);
      expect(overlookCellAt(seed, lm.x + 3, lm.top, towerTop)).toBe(cell);
      expect(overlookCellAt(seed, lm.x - 6, lm.top, towerTop)).toBe(cell);
      expect(overlookCellAt(seed, lm.x + 6, lm.top, towerTop)).toBe(null);
      expect(overlookCellAt(seed, lm.x, lm.top, towerTop)).toBe(null); // 梯子列
      expect(overlookCellAt(seed, lm.x + 3, lm.top + 1, towerTop)).toBe(null);
      expect(overlookCellAt(seed, lm.x + 3, lm.top)).toBe(null);
    }
    expect(towers).toBeGreaterThan(0);
  });
  it('全 seed・cell・k で見晴らし台の床の行は HARD、その上は HARD でない', () => {
    for (const seed of seeds) for (let cell = -3; cell <= 2; cell++) for (const k of [-2, 0, 3]) {
      const px = passageX(seed, cell, k);
      const top = interfaceTop(seed, cell);
      expect(overlookCellAt(seed, px + 4, top)).toBe(cell);
      expect(interfaceTileAt(seed, px + 4, top)).toBe(TILE.HARD);
      expect(interfaceTileAt(seed, px + 4, top - 1)).not.toBe(TILE.HARD);
    }
  });
});
