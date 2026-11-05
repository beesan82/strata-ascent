import { describe, expect, it } from 'vitest';
import { ANTECHAMBER_DEPTH, groupLadderX, interfaceBottom, interfaceTop, passageX } from './interface';
import { biomeIdForCell } from './biomeCells';
import { TILE } from './tiles';
import {
  ATRIUM_HALF_WIDTH, collapseRun, collapseWidth, girderY, isTowerFamily, LANDMARK_GROUP, LANDMARK_KIND_FOR,
  LANDMARK_OFFSET, landmarkAt, landmarkNear, landmarkTileAt, rampTopY, shaftLadderX, towerSpec, towerTopFloorAt,
  vertebraSway, type Landmark, type LandmarkKind,
} from './landmark';

const seeds = [1, 42, 20260711];
const cells = [-3, -2, -1, 0, 1, 2, 3];
const ks = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
/** 全候補スロット(保証配置後は null も意味を持つので呼び出し側で絞る) */
const all = (): { seed: number; lm: Landmark }[] =>
  seeds.flatMap((seed) => cells.flatMap((cell) => ks.flatMap((k) => {
    const lm = landmarkAt(seed, cell, k);
    return lm ? [{ seed, lm }] : [];
  })));
const byKind = (kind: LandmarkKind): { seed: number; lm: Landmark }[] => all().filter(({ lm }) => lm.kind === kind);

describe('landmarkAt(保証配置と地区変種)', () => {
  it('スロット 3 個のグループにちょうど 1 基、種は地区で固定。中心は孔 +160、上下は板の上面、決定論', () => {
    for (const seed of seeds) for (let cell = -6; cell <= 6; cell++) {
      // グループ境界をまたぐ範囲で数える
      for (let g = -4; g <= 4; g++) {
        const group = [0, 1, 2].map((i) => landmarkAt(seed, cell, g * LANDMARK_GROUP + i)).filter((lm) => lm !== null);
        expect(group).toHaveLength(1);
      }
      for (const k of ks) {
        const lm = landmarkAt(seed, cell, k);
        if (!lm) continue;
        expect(lm.kind).toBe(LANDMARK_KIND_FOR[biomeIdForCell(seed, cell)]);
        expect(lm.x).toBe(passageX(seed, cell, k) + LANDMARK_OFFSET);
        expect(lm.top).toBe(interfaceTop(seed, cell));
        expect(lm.bottom).toBe(interfaceBottom(seed, cell));
        expect(lm.floor).toBe(interfaceTop(seed, cell + 1));
        expect(landmarkAt(seed, cell, k)).toEqual(lm);
      }
    }
  });

  it('どの地区セルにも固有ランドマークが最低 1 基ある(グループ 10 個で 10 基)', () => {
    for (let seed = 1; seed <= 10; seed++) for (let cell = -7; cell <= 7; cell++) {
      let count = 0;
      for (let k = -15; k < 15; k++) if (landmarkAt(seed, cell, k)) count++;
      expect(count).toBe(10);
    }
  });

  it('7 地区すべての変種が現れる', () => {
    expect(new Set(all().map(({ lm }) => lm.kind))).toEqual(new Set(Object.values(LANDMARK_KIND_FOR)));
  });
});

describe('塔系(冷却塔・変圧塔・煙突塔・椎骨柱)', () => {
  it('外殻は HARD、縦坑は LADDER、基部は AIR、頂部は幅 12 の開口。環状通路の本数は変種ごと', () => {
    for (const kind of ['cooling', 'transformer', 'chimney', 'vertebra'] as const) {
      const list = byKind(kind);
      expect(list.length).toBeGreaterThan(0);
      for (const { seed, lm } of list) {
        const spec = towerSpec(kind)!;
        const cx = lm.x;
        // 縦坑の梯子列(椎骨柱はうねりに追随する列)
        for (let y = lm.floor - 1; y >= lm.top - 4; y--) expect(landmarkTileAt(seed, shaftLadderX(lm, y), y)).toBe(TILE.LADDER);
        // 開口の中心列は塔系が主張し続ける(上の層の構造底部が HARD で重なることはある)
        expect(landmarkTileAt(seed, cx, lm.top - 5)).not.toBe(null);
        // 床の板そのものは界面のもの(合成後の landmarkTileAt では下の層の構造と区別できないのでここでは見ない)
        // 頂部の開口は [cx−6, cx+6) に届く
        const t = landmarkTileAt(seed, cx - 6, lm.top - 1);
        expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
        // 縦坑の脇は AIR、その外は殻(環状通路・基部でない行で)
        const midY = lm.bottom + 10;
        if (kind !== 'vertebra') expect(landmarkTileAt(seed, cx + 1, lm.top + 5)).toBe(TILE.AIR);
        expect(landmarkTileAt(seed, cx - (spec.halfWidth - 4), midY)).toBe(TILE.HARD);
        expect(landmarkTileAt(seed, cx - (spec.halfWidth - 4), lm.top + 5)).toBe(TILE.HARD); // 板の中も殻
        expect(landmarkTileAt(seed, cx - (spec.halfWidth - 4), lm.floor - 1)).toBe(TILE.AIR); // 基部の出入口
        expect(landmarkTileAt(seed, cx - (spec.halfWidth - 4), lm.floor - 4)).toBe(TILE.HARD);
        expect(landmarkTileAt(seed, cx - spec.halfWidth - 1, lm.top + 5)).toBe(null);
        expect(landmarkTileAt(seed, cx + spec.halfWidth, lm.top + 5)).toBe(null);
        // 環状通路: 本数ぶんだけ層を横に貫く
        const H = lm.floor - lm.bottom;
        for (let i = 1; i <= spec.rings; i++) {
          const yi = lm.bottom + Math.round((H * i) / (spec.rings + 1));
          expect(landmarkTileAt(seed, cx - spec.halfWidth, yi)).toBe(TILE.AIR);
          expect(landmarkTileAt(seed, cx + spec.halfWidth - 1, yi - 2)).toBe(TILE.AIR);
          expect(landmarkTileAt(seed, cx + spec.halfWidth - 1, yi - 3)).toBe(TILE.HARD);
        }
        if (spec.rings === 0) {
          // 冷却塔は踊り場なし: 1/4 の高さでも殻のまま(縦坑と基部を除く)
          const yi = lm.bottom + Math.round(H / 4);
          expect(landmarkTileAt(seed, cx - spec.halfWidth, yi)).toBe(TILE.HARD);
        }
        expect(towerTopFloorAt(seed, lm.cell, cx + 5)).toBe(true);
        expect(towerTopFloorAt(seed, lm.cell, cx)).toBe(false); // 梯子列
        expect(towerTopFloorAt(seed, lm.cell, cx - 6)).toBe(true);
        expect(towerTopFloorAt(seed, lm.cell, cx + 6)).toBe(false);
      }
    }
  });

  it('煙突塔の縦坑は幅 5(±2 が空気、±3 は殻)', () => {
    for (const { seed, lm } of byKind('chimney')) {
      const y = lm.bottom + 10;
      expect(landmarkTileAt(seed, lm.x, y)).toBe(TILE.LADDER);
      expect(landmarkTileAt(seed, lm.x + 2, y)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, lm.x - 2, y)).toBe(TILE.AIR);
      expect(landmarkTileAt(seed, lm.x + 3, y)).toBe(TILE.HARD);
      expect(landmarkTileAt(seed, lm.x - 3, y)).toBe(TILE.HARD);
    }
  });

  it('椎骨柱の梯子列は 4 行ごとに ±1 列うねり、頂部付近は中央に戻る', () => {
    for (const { seed, lm } of byKind('vertebra')) {
      for (let y = lm.top; y < lm.top + 4; y++) expect(vertebraSway(lm, y)).toBe(0);
      // うねりの列に梯子があり、縦坑の空気も付いてくる
      let sawPlus = false, sawMinus = false;
      for (let y = lm.top + 4; y < lm.floor - 4; y++) {
        const sway = vertebraSway(lm, y);
        if (sway === 1) sawPlus = true;
        if (sway === -1) sawMinus = true;
        expect(landmarkTileAt(seed, lm.x + sway, y)).toBe(TILE.LADDER);
        // 縦坑の脇の空気は、下の層の開口帯(床の上 8 行)では外国の梯子列が残りうるので帯の外で見る
        if (y < lm.floor - 8) {
          expect(landmarkTileAt(seed, lm.x + sway + 1, y)).toBe(TILE.AIR);
          expect(landmarkTileAt(seed, lm.x + sway - 1, y)).toBe(TILE.AIR);
        }
      }
      expect(sawPlus).toBe(true);
      expect(sawMinus).toBe(true);
    }
  });
});

describe('塔系の頂部の開口', () => {
  it('頂部の上の空間 [x−12, x+52) × 8 行は塔系が主張し続け、出口の梯子と 32 タイル梯子列が必ず残る(上の層へ出られる)', () => {
    let towers = 0;
    for (let seed = 1; seed <= 60; seed++) for (const cell of [-2, 1, 4]) for (const k of [-3, 0, 3]) {
      const lm = landmarkAt(seed, cell, k);
      if (!lm || !isTowerFamily(lm.kind)) continue;
      towers++;
      let ladders = 0;
      for (let x = lm.x - 12; x < lm.x + 52; x++) {
        for (let y = lm.top - 8; y < lm.top; y++) {
          // 上の層の大構造の底部(支持柱・殻)が HARD で立つことはあるが、主張が消えることはない
          expect(landmarkTileAt(seed, x, y)).not.toBe(null);
        }
        if (landmarkTileAt(seed, x, lm.top - 8) === TILE.LADDER && x !== lm.x) ladders++;
      }
      expect(ladders).toBeGreaterThanOrEqual(1);
      // 出口の梯子(張り出し 4 行)は合成でも常に残る
      for (let y = lm.top - 4; y < lm.top; y++) expect(landmarkTileAt(seed, lm.x, y)).toBe(TILE.LADDER);
    }
    expect(towers).toBeGreaterThan(50);
  });
});

describe('大桁橋(寒鋼基層)', () => {
  it('橋床は層の 4 割の高さに HARD で渡り、支持柱が床まで届く。梯子列は塞がない', () => {
    const list = byKind('girder');
    expect(list.length).toBeGreaterThan(0);
    for (const { seed, lm } of list) {
      const gy = girderY(lm);
      expect(lm.baseY).toBe(gy);
      expect(lm.gapLeft).toBe(lm.x - 40);
      expect(lm.gapRight).toBe(lm.x + 40);
      // 橋床(3 行)が両端まで
      for (const x of [lm.gapLeft, lm.x, lm.gapRight - 1]) {
        if (x === groupLadderX(seed, x)) continue;
        expect(landmarkTileAt(seed, x, gy)).toBe(TILE.HARD);
        expect(landmarkTileAt(seed, x, gy + 2)).toBe(TILE.HARD);
      }
      // 支持柱(左端 +8 の列)は橋床の下から床の板の直前まで HARD
      const pierX = lm.gapLeft + 8;
      if (pierX !== groupLadderX(seed, pierX)) {
        expect(landmarkTileAt(seed, pierX, gy + 3)).toBe(TILE.HARD);
        expect(landmarkTileAt(seed, pierX, lm.floor - 1)).toBe(TILE.HARD);
      }
      // 橋床の上 3 行は歩けるよう空いている
      const freeX = lm.gapLeft + 4;
      if (freeX !== groupLadderX(seed, freeX)) {
        expect(landmarkTileAt(seed, freeX, gy - 1)).toBe(TILE.AIR);
        expect(landmarkTileAt(seed, freeX, gy - 3)).toBe(TILE.AIR);
      }
      // 梯子列の列では大構造は口を出さない
      for (let x = lm.gapLeft; x < lm.gapRight; x++) {
        if (x === groupLadderX(seed, x)) expect(landmarkTileAt(seed, x, gy)).toBe(null);
      }
      expect(towerTopFloorAt(seed, lm.cell, lm.x)).toBe(false);
    }
  });
});

describe('吹き抜けホール(居住区画)', () => {
  it('内部は大きく開き、両端に柱、上部にアーチ帯。梯子列は残る', () => {
    const list = byKind('atrium');
    expect(list.length).toBeGreaterThan(0);
    for (const { seed, lm } of list) {
      expect(lm.gapLeft).toBe(lm.x - ATRIUM_HALF_WIDTH);
      expect(lm.gapRight).toBe(lm.x + ATRIUM_HALF_WIDTH);
      // 中央は層の中ほどまで AIR(梯子列の列は除く)
      const midY = lm.bottom + Math.round((lm.floor - lm.bottom) / 2);
      if (lm.x !== groupLadderX(seed, lm.x)) expect(landmarkTileAt(seed, lm.x, midY)).toBe(TILE.AIR);
      // 柱(両端 2 列)は HARD
      expect(landmarkTileAt(seed, lm.gapLeft, midY)).toBe(TILE.HARD);
      expect(landmarkTileAt(seed, lm.gapRight - 1, midY)).toBe(TILE.HARD);
      // アーチ帯: 最下行は中央 ±8 だけ開き、上に行くほど広がる
      if (lm.x + 20 !== groupLadderX(seed, lm.x + 20)) expect(landmarkTileAt(seed, lm.x + 20, lm.bottom)).toBe(TILE.HARD);
      if (lm.x !== groupLadderX(seed, lm.x)) expect(landmarkTileAt(seed, lm.x, lm.bottom)).toBe(TILE.AIR);
      // 板(天井)には口を出さない
      expect(landmarkTileAt(seed, lm.x, lm.top + 1)).toBe(null);
      // 梯子列の列は大構造が塞がない
      for (let x = lm.gapLeft; x < lm.gapRight; x++) {
        if (x === groupLadderX(seed, x)) expect(landmarkTileAt(seed, x, midY)).toBe(null);
      }
      expect(towerTopFloorAt(seed, lm.cell, lm.x)).toBe(false);
    }
  });
});

describe('崩落界面(廃棄沈殿層)', () => {
  it('幅は通常 160(2 列 1 段)・大界面 144(1 列 1 段)、足は前室の床の行、上端は板の上面の 1 段下、斜路の上は AIR、出口の上は空く', () => {
    expect(collapseWidth(-2)).toBe(144);
    expect(collapseWidth(1)).toBe(160);
    expect(collapseRun(-2)).toBe(1);
    expect(collapseRun(1)).toBe(2);
    const list = byKind('collapse');
    expect(list.length).toBeGreaterThan(0);
    for (const { seed, lm } of list) {
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
        // 板の上 9 行目は保証の外(上の層の大構造が立ちうる)
        expect(landmarkTileAt(seed, x, lm.baseY + 1)).toBe(null);
      }
      // 出口の上: 裂け目の右端から 12 列は板の上 8 行が空く(梯子列は残る)
      for (let x = lm.gapRight; x < lm.gapRight + 12; x++) {
        const t = landmarkTileAt(seed, x, lm.top - 8);
        expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
        expect(landmarkTileAt(seed, x, lm.top)).toBe(null);
      }
      // 開口の外側(板の上)は上の層の大構造が立ちうるので、同一層側だけを見る
      expect(landmarkTileAt(seed, lm.gapLeft - 1, lm.top + 1)).toBe(null);
      expect(landmarkTileAt(seed, lm.gapRight, lm.top + 1)).toBe(null);
      expect(towerTopFloorAt(seed, lm.cell, lm.x)).toBe(false);
    }
  });
});

describe('landmarkNear', () => {
  it('幾何に掛かる x でだけ返す', () => {
    for (const { seed, lm } of all()) {
      expect(landmarkNear(seed, lm.cell, lm.x)).toEqual(lm);
      if (isTowerFamily(lm.kind)) {
        const spec = towerSpec(lm.kind)!;
        expect(landmarkNear(seed, lm.cell, lm.x - spec.halfWidth)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.x - spec.halfWidth - 1)).toBe(null);
        expect(landmarkNear(seed, lm.cell, lm.x + 51)).toEqual(lm); // 頂部の上の空間まで
        expect(landmarkNear(seed, lm.cell, lm.x + 52)).toBe(null);
      } else if (lm.kind === 'collapse') {
        expect(landmarkNear(seed, lm.cell, lm.gapLeft)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.gapLeft - 1)).toBe(null);
        expect(landmarkNear(seed, lm.cell, lm.gapRight + 11)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.gapRight + 12)).toBe(null);
      } else {
        expect(landmarkNear(seed, lm.cell, lm.gapLeft)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.gapLeft - 1)).toBe(null);
        expect(landmarkNear(seed, lm.cell, lm.gapRight - 1)).toEqual(lm);
        expect(landmarkNear(seed, lm.cell, lm.gapRight)).toBe(null);
      }
    }
  });
});
