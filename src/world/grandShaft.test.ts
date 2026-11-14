import { describe, expect, it } from 'vitest';
import {
  GRAND_BAND_WIDTH,
  GRAND_BELOW_PLATE,
  GRAND_GROUP_CELLS,
  GRAND_MAX_LENGTH,
  GRAND_MIN_LENGTH,
  GRAND_PASSAGE_CLEAR,
  GRAND_VISTA_REACH,
  GRAND_VISTA_ROWS,
  grandAmenitySpots,
  grandShaftAt,
  grandShaftBounds,
  grandShaftsNear,
  grandShaftTileAt,
  grandTileAt,
  type GrandShaft,
} from './grandShaft';
import { biomeCellAt } from './biomeCells';
import { elevatorShaftAt, SHAFT_DOOR_ROWS, shaftBounds } from './elevator';
import { grandHallAt, hallChimneyAt } from './grandhall';
import { groupLadderX, interfaceTileAt, PASSAGE_SLOT, passageX } from './interface';
import { landmarkAt, spanOf } from './landmark';
import { megaFacilityAt } from './megafacility';
import { REST_HEIGHT, restPointAt } from './restpoint';
import { CHUNK_SIZE, isSolid, TILE } from './tiles';
import { generateChunk, isHardAt, tileAt } from './worldgen';
import { Player } from '../entities/player';

const SEEDS = [1, 42, 20260711, 7, 99];
const BANDS = [-3, -2, -1, 0, 1, 2, 3];
const GROUPS = [-2, -1, 0, 1];

let cached: { seed: number; s: GrandShaft }[] | null = null;
/** 調べる範囲の全シャフト(列バンド × cell グループ) */
function allGrand(): { seed: number; s: GrandShaft }[] {
  if (cached) return cached;
  const out: { seed: number; s: GrandShaft }[] = [];
  for (const seed of SEEDS) {
    for (const g of GROUPS) {
      for (const band of BANDS) {
        const s = grandShaftAt(seed, band, g);
        if (s) out.push({ seed, s });
      }
    }
  }
  cached = out;
  return out;
}

/** タイル単位で全域を見るテストは数を絞る */
function someGrand(n: number): { seed: number; s: GrandShaft }[] {
  return allGrand().slice(0, n);
}

type Rect = { x0: number; x1: number; y0: number; y1: number };
function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

describe('grandShaftAt(配置)', () => {
  it('決定的: 同じ入力は常に同じ結果(別シードを挟んでも)', () => {
    const { seed, s } = allGrand()[0];
    grandShaftAt(seed + 1, s.band, s.group);
    expect(grandShaftAt(seed, s.band, s.group)).toEqual(s);
  });

  it('範囲内に大昇降機があり、全ての組には置かない(稀少)', () => {
    const n = allGrand().length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(SEEDS.length * BANDS.length * GROUPS.length * 0.6);
  });

  it('長さは 300〜600 で、複数の層 cell を貫き、停止階は上から下へ並ぶ', () => {
    for (const { s } of allGrand()) {
      const len = s.yBottom - s.yTop;
      expect(len).toBeGreaterThanOrEqual(GRAND_MIN_LENGTH);
      expect(len).toBeLessThanOrEqual(GRAND_MAX_LENGTH);
      expect(s.endCell).toBeGreaterThan(s.startCell);
      expect(s.plates.length).toBe(s.endCell - s.startCell);
      expect(s.stations.length).toBe(s.plates.length);
      expect(s.stops[0]).toBe(s.yTop);
      expect(s.stops[s.stops.length - 1]).toBe(s.yBottom);
      expect(s.stops.length).toBe(2 + s.plates.length * 2);
      for (let i = 1; i < s.stops.length; i++) expect(s.stops[i] - s.stops[i - 1]).toBeGreaterThan(SHAFT_DOOR_ROWS + 1);
    }
  });

  it('上下の停止階と板の直下の途中駅は層の床帯の行、板の上の途中駅は板の上面', () => {
    for (const { s } of allGrand()) {
      const sp = (cell: number) => s.spacing[cell - s.startCell];
      const m = (v: number, k: number) => ((v % k) + k) % k;
      expect(m(s.yTop, sp(s.startCell))).toBe(0);
      expect(m(s.yBottom, sp(s.endCell))).toBe(0);
      s.plates.forEach((p, i) => {
        const st = s.stations[i];
        expect(st.cell).toBe(p.cell);
        expect(st.upper).toBe(p.top);
        expect(m(st.lower, sp(p.cell))).toBe(0);
        expect(st.lower).toBeGreaterThanOrEqual(p.bottom + GRAND_BELOW_PLATE);
        expect(st.lower - p.bottom).toBeLessThan(GRAND_BELOW_PLATE + sp(p.cell));
      });
    }
  });

  it('外形は列バンドと cell グループの内側に収まり、壁と内側に梯子列を含まない', () => {
    for (const { seed, s } of allGrand()) {
      const b = grandShaftBounds(s);
      expect(b.x0).toBeGreaterThanOrEqual(s.band * GRAND_BAND_WIDTH);
      expect(b.x1).toBeLessThanOrEqual((s.band + 1) * GRAND_BAND_WIDTH);
      expect(s.startCell).toBeGreaterThanOrEqual(s.group * GRAND_GROUP_CELLS);
      expect(s.endCell).toBeLessThanOrEqual(s.group * GRAND_GROUP_CELLS + GRAND_GROUP_CELLS - 1);
      expect(biomeCellAt(seed, b.y0)).toBe(s.startCell);
      expect(biomeCellAt(seed, b.y1 - 1)).toBe(s.endCell);
      for (let x = s.x0 - 1; x <= s.x0 + s.width; x++) expect(groupLadderX(seed, x)).not.toBe(x);
      expect(groupLadderX(seed, s.ladderX)).toBe(s.ladderX);
      expect(s.ladderX === s.landL || s.ladderX === s.landR).toBe(true);
    }
  });

  it('貫く板の孔・大構造・休憩点の箱・大広間と煙突・通常の昇降機と重ならない', () => {
    for (const { seed, s } of allGrand()) {
      const b = grandShaftBounds(s);
      const k0 = Math.floor(b.x0 / PASSAGE_SLOT) - 1;
      const k1 = Math.floor(b.x1 / PASSAGE_SLOT) + 1;
      for (const p of s.plates) {
        for (let kk = k0; kk <= k1; kk++) {
          const px = passageX(seed, p.cell, kk);
          expect(b.x0 > px + GRAND_PASSAGE_CLEAR || b.x1 <= px - GRAND_PASSAGE_CLEAR).toBe(true);
        }
      }
      for (let c = s.startCell; c <= s.endCell; c++) {
        for (let kk = k0; kk <= k1; kk++) {
          const lm = landmarkAt(seed, c, kk);
          if (lm) {
            const [x0, x1] = spanOf(lm);
            expect(b.x0 < x1 && b.x1 > x0).toBe(false);
          }
          const rp = restPointAt(seed, c, kk);
          expect(overlaps(b, { x0: rp.left, x1: rp.right + 1, y0: rp.floorY - REST_HEIGHT - 1, y1: rp.floorY + 1 })).toBe(false);
          const e = elevatorShaftAt(seed, c, kk);
          if (e) expect(overlaps(b, shaftBounds(e))).toBe(false);
        }
        const hall = grandHallAt(seed, c);
        if (hall) expect(overlaps(b, hall)).toBe(false);
      }
      for (let c = s.startCell; c <= s.endCell + 1; c++) {
        const chim = hallChimneyAt(seed, c);
        if (chim) expect(overlaps(b, chim)).toBe(false);
      }
    }
  });

  it('メガ施設と重ならない(外形の全タイル)', () => {
    for (const { seed, s } of someGrand(4)) {
      const b = grandShaftBounds(s);
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) expect(megaFacilityAt(seed, x, y)).toBeNull();
      }
    }
  });

  it('grandShaftsNear はシャフトの中ほどから引け、離れると引けない', () => {
    for (const { seed, s } of allGrand().slice(0, 10)) {
      const mid = (s.yTop + s.yBottom) / 2;
      expect(grandShaftsNear(seed, s.x0 + 3, mid, 10, 10).map((n) => n.id)).toContain(s.id);
      expect(grandShaftsNear(seed, s.x0 + 3 + GRAND_BAND_WIDTH * 10, mid, 10, 10).map((n) => n.id)).not.toContain(s.id);
    }
  });

  it('途中駅の設備は一部の駅だけに付き、識別子は種別ごとの接頭辞を持つ', () => {
    const stations = allGrand().flatMap(({ s }) => s.stations);
    const withAmenity = stations.filter((st) => st.amenity !== null).length;
    expect(withAmenity).toBeLessThan(stations.length);
    const shafts = allGrand().map(({ s }) => s);
    for (const p of grandAmenitySpots(shafts, 'supply')) expect(p.id.startsWith('s:g:')).toBe(true);
    for (const p of grandAmenitySpots(shafts, 'terminal')) expect(p.id.startsWith('m:g:')).toBe(true);
    for (const p of grandAmenitySpots(shafts, 'rest')) expect(p.id.startsWith('r:g:')).toBe(true);
  });
});

describe('大昇降機の地形統合(tileAt)', () => {
  it('tileAt はシャフトの形を持つ(板に当たる SOLID は板の HARD のまま)', () => {
    for (const { seed, s } of someGrand(4)) {
      const b = grandShaftBounds(s);
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) {
          const want = grandShaftTileAt(seed, s, x, y);
          if (want === null) continue;
          const plate = interfaceTileAt(seed, x, y) === TILE.HARD;
          expect(tileAt(seed, x, y)).toBe(plate && want === TILE.SOLID ? TILE.HARD : want);
          expect(grandTileAt(seed, x, y)).toBe(want);
        }
      }
    }
  });

  it('内側は天井と底だけが固体で、板の行も含めて上から下まで空気が通る', () => {
    for (const { seed, s } of someGrand(6)) {
      for (let x = s.x0; x < s.x0 + s.width; x++) {
        expect(tileAt(seed, x, s.yTop - SHAFT_DOOR_ROWS - 1)).toBe(TILE.SOLID);
        expect(tileAt(seed, x, s.yBottom)).toBe(TILE.SOLID);
        for (let y = s.yTop - SHAFT_DOOR_ROWS; y < s.yBottom; y++) expect(tileAt(seed, x, y)).toBe(TILE.AIR);
      }
    }
  });

  it('板の行の壁は不壊で、isHardAt は tileAt と一致する', () => {
    for (const { seed, s } of someGrand(6)) {
      const b = grandShaftBounds(s);
      for (const p of s.plates) {
        for (let y = p.top; y < p.bottom; y++) {
          expect(tileAt(seed, s.x0 - 1, y)).toBe(TILE.HARD);
          expect(tileAt(seed, s.x0 + s.width, y)).toBe(TILE.HARD);
          for (let x = b.x0; x < b.x1; x++) expect(isHardAt(seed, x, y)).toBe(tileAt(seed, x, y) === TILE.HARD);
        }
      }
    }
  });

  it('眺望区間は両側の壁が抜けて、外へ張り出しの空間と床がある', () => {
    let tested = 0;
    for (const { seed, s } of someGrand(8)) {
      for (const vy of s.vistas) {
        tested++;
        for (let y = vy - GRAND_VISTA_ROWS; y < vy; y++) {
          for (let x = s.x0 - 1 - GRAND_VISTA_REACH; x <= s.x0 + s.width + GRAND_VISTA_REACH; x++) {
            if (groupLadderX(seed, x) === x) continue;
            expect(isSolid(tileAt(seed, x, y))).toBe(false);
          }
        }
        for (const x of [s.x0 - 2, s.x0 - 1 - GRAND_VISTA_REACH, s.x0 + s.width + 1, s.x0 + s.width + GRAND_VISTA_REACH]) {
          if (groupLadderX(seed, x) === x) continue;
          expect(tileAt(seed, x, vy)).toBe(TILE.SOLID);
        }
      }
    }
    expect(tested).toBeGreaterThan(0);
  });

  it('チャンク境界一致: チャンクの生成結果はシャフトの範囲で tileAt と一致し、壁は境界をまたいで続く', () => {
    for (const { seed, s } of someGrand(3)) {
      const b = grandShaftBounds(s);
      const cx0 = Math.floor(b.x0 / CHUNK_SIZE);
      const cx1 = Math.floor((b.x1 - 1) / CHUNK_SIZE);
      // 最初の板をまたぐ縦 2 チャンク(板の上面の行を含むチャンクと、その上のチャンク)
      const cy = Math.floor(s.plates[0].top / CHUNK_SIZE);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (const cyy of [cy - 1, cy]) {
          const data = generateChunk(seed, cx, cyy);
          for (let ty = 0; ty < CHUNK_SIZE; ty++) {
            const wy = cyy * CHUNK_SIZE + ty;
            if (wy < b.y0 || wy >= b.y1) continue;
            for (let tx = 0; tx < CHUNK_SIZE; tx++) {
              const wx = cx * CHUNK_SIZE + tx;
              if (wx < b.x0 || wx >= b.x1) continue;
              if (grandShaftTileAt(seed, s, wx, wy) === null) continue;
              expect(data[ty * CHUNK_SIZE + tx]).toBe(tileAt(seed, wx, wy));
            }
          }
        }
      }
      // 境界の行の上下で内側は空気、壁は同じ規則(板・出入口でない限り固体)
      const by = cy * CHUNK_SIZE;
      if (by > s.yTop && by < s.yBottom) {
        for (let x = s.x0; x < s.x0 + s.width; x++) {
          expect(tileAt(seed, x, by - 1)).toBe(TILE.AIR);
          expect(tileAt(seed, x, by)).toBe(TILE.AIR);
        }
      }
    }
  });
});

describe('大昇降機の到達可能性(詰みなし)', () => {
  it('どの停止階も、壁の出入口から乗り場の床と頭上の空間が梯子列まで続く', () => {
    for (const { seed, s } of allGrand()) {
      const wallL = s.x0 - 1;
      const wallR = s.x0 + s.width;
      for (const st of s.stops) {
        // 壁の出入口
        for (const wx of [wallL, wallR]) {
          for (let d = 1; d <= SHAFT_DOOR_ROWS; d++) expect(isSolid(tileAt(seed, wx, st - d))).toBe(false);
        }
        // 乗り場(両側)。梯子列の側は梯子列まで
        const cols: number[] = [];
        for (let x = s.landL; x < wallL; x++) cols.push(x);
        for (let x = wallR + 1; x <= s.landR; x++) cols.push(x);
        for (const x of cols) {
          const floor = tileAt(seed, x, st);
          expect(isSolid(floor) || floor === TILE.LADDER).toBe(true);
          for (let d = 1; d <= SHAFT_DOOR_ROWS; d++) expect(isSolid(tileAt(seed, x, st - d))).toBe(false);
        }
        // 梯子列は停止階の上へ続く(層の上昇路へ出られる)
        for (let d = 1; d <= SHAFT_DOOR_ROWS; d++) expect(tileAt(seed, s.ladderX, st - d)).toBe(TILE.LADDER);
      }
    }
  });

  it('シャフトに落ちても下の停止階の床に着き、出入口から梯子列の側へ歩いて出られる(Player 結合)', () => {
    for (const { seed, s } of someGrand(3)) {
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const player = new Player(s.x0 + s.width / 2 - 0.4, s.yTop - 1.8);
      const idle = { left: false, right: false, jump: false, up: false, down: false };
      // 600 タイルでも最大落下速度 25 タイル/秒で 25 秒以内に着く
      for (let i = 0; i < 60 * 30 && !(player.body.onGround && player.body.y > s.yBottom - 3); i++) player.update(idle, 1 / 60, tiles);
      for (let i = 0; i < 30; i++) player.update(idle, 1 / 60, tiles);
      expect(player.body.onGround).toBe(true);
      expect(Math.abs(player.body.y + player.body.h - s.yBottom)).toBeLessThan(0.1);
      const toRight = s.ladderX > s.x0;
      const walk = { ...idle, left: !toRight, right: toRight };
      for (let i = 0; i < 240; i++) player.update(walk, 1 / 60, tiles);
      if (toRight) expect(player.body.x).toBeGreaterThan(s.x0 + s.width + 1);
      else expect(player.body.x + player.body.w).toBeLessThan(s.x0 - 1);
    }
  });
});
