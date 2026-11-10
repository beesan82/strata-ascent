import { describe, expect, it } from 'vitest';
import {
  elevatorShaftAt,
  elevatorsNear,
  elevatorTileAt,
  LANDING_REACH,
  SHAFT_DOOR_ROWS,
  SHAFT_FLOOR_CLEARANCE,
  SHAFT_MIN_SPAN,
  SHAFT_WIDTH,
  shaftBounds,
  shaftTileAt,
  type ElevatorShaft,
} from './elevator';
import { biomeIdForCell } from './biomeCells';
import { terrainProfileFor } from './biomeTerrain';
import { grandHallAt, hallChimneyAt } from './grandhall';
import {
  ANTECHAMBER_DEPTH, COMPRESSION_DEPTH, groupLadderX, interfaceBottom, interfaceTop, PASSAGE_SLOT,
} from './interface';
import { landmarkAt, spanOf } from './landmark';
import { megaFacilityAt } from './megafacility';
import { REST_HEIGHT, restPointAt, restPointBand } from './restpoint';
import { isSolid, TILE } from './tiles';
import { noiseTileAt, tileAt } from './worldgen';
import { Player } from '../entities/player';

const SEEDS = [1, 42, 20260711];

/** 調べる範囲の全シャフト */
function allShafts(): { seed: number; s: ElevatorShaft }[] {
  const out: { seed: number; s: ElevatorShaft }[] = [];
  for (const seed of SEEDS) {
    for (let cell = -3; cell <= 3; cell++) {
      for (let k = -4; k <= 4; k++) {
        const s = elevatorShaftAt(seed, cell, k);
        if (s) out.push({ seed, s });
      }
    }
  }
  return out;
}

function overlaps(
  a: { x0: number; x1: number; y0: number; y1: number },
  b: { x0: number; x1: number; y0: number; y1: number },
): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

describe('elevatorShaftAt(配置)', () => {
  it('決定的: 同じ入力は常に同じ結果(別シードを挟んでも)', () => {
    const a = elevatorShaftAt(42, 1, 2);
    elevatorShaftAt(7, 1, 2);
    expect(elevatorShaftAt(42, 1, 2)).toEqual(a);
  });

  it('範囲内にシャフトがあり、全スロットには置かない(控えめな密度)', () => {
    const n = allShafts().length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(SEEDS.length * 7 * 9);
  });

  it('停止階は層の床帯の行で、2 本以上の床帯にまたがる', () => {
    for (const { seed, s } of allShafts()) {
      const sp = terrainProfileFor(biomeIdForCell(seed, s.cell)).floorSpacing;
      expect(s.spacing).toBe(sp);
      expect(((s.yBottom % sp) + sp) % sp).toBe(0);
      expect((s.yBottom - s.yTop) % sp).toBe(0);
      expect(s.yBottom - s.yTop).toBeGreaterThanOrEqual(Math.max(SHAFT_MIN_SPAN, 2 * sp));
    }
  });

  it('縦は休憩点の帯・前室・圧縮帯より下、床の板より上(層の下部)', () => {
    for (const { seed, s } of allShafts()) {
      const b = shaftBounds(s);
      expect(b.y0).toBeGreaterThan(restPointBand(seed, s.cell).y1);
      expect(b.y0).toBeGreaterThanOrEqual(interfaceBottom(seed, s.cell) + ANTECHAMBER_DEPTH + COMPRESSION_DEPTH);
      expect(s.yBottom).toBeLessThanOrEqual(interfaceTop(seed, s.cell + 1) - SHAFT_FLOOR_CLEARANCE);
    }
  });

  it('外形はスロットの中に収まり、壁と内側に 32 タイル梯子列を含まない', () => {
    for (const { seed, s } of allShafts()) {
      const b = shaftBounds(s);
      expect(b.x0).toBeGreaterThanOrEqual(s.k * PASSAGE_SLOT);
      expect(b.x1).toBeLessThanOrEqual((s.k + 1) * PASSAGE_SLOT);
      for (let x = s.x0 - 1; x <= s.x0 + SHAFT_WIDTH; x++) expect(groupLadderX(seed, x)).not.toBe(x);
    }
  });

  it('大構造・大広間と煙突・休憩点の箱・メガ施設と重ならない', () => {
    for (const { seed, s } of allShafts()) {
      const b = shaftBounds(s);
      for (let kk = s.k - 1; kk <= s.k + 1; kk++) {
        const lm = landmarkAt(seed, s.cell, kk);
        if (lm) {
          const [x0, x1] = spanOf(lm);
          expect(b.x0 < x1 && b.x1 > x0).toBe(false);
        }
        const rp = restPointAt(seed, s.cell, kk);
        expect(overlaps(b, { x0: rp.left, x1: rp.right + 1, y0: rp.floorY - REST_HEIGHT - 1, y1: rp.floorY + 1 })).toBe(false);
      }
      const hall = grandHallAt(seed, s.cell);
      if (hall) expect(overlaps(b, hall)).toBe(false);
      for (const c of [s.cell, s.cell + 1]) {
        const chim = hallChimneyAt(seed, c);
        if (chim) expect(overlaps(b, chim)).toBe(false);
      }
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) expect(megaFacilityAt(seed, x, y)).toBeNull();
      }
    }
  });

  it('elevatorsNear はシャフトの中心から引ける', () => {
    for (const { seed, s } of allShafts().slice(0, 10)) {
      const near = elevatorsNear(seed, s.x0 + 2, (s.yTop + s.yBottom) / 2, 10, 10);
      expect(near.map((n) => n.id)).toContain(s.id);
    }
  });
});

describe('シャフトのタイル', () => {
  const s: ElevatorShaft = { id: 'e:0,0', cell: 0, k: 0, x0: 100, yTop: 200, yBottom: 224, spacing: 8 };

  it('内側は天井と底だけが固体で、上の停止階の床の行は空気(足場の通り道)', () => {
    expect(shaftTileAt(s, 101, 200 - SHAFT_DOOR_ROWS - 1)).toBe(TILE.SOLID);
    expect(shaftTileAt(s, 101, 199)).toBe(TILE.AIR);
    expect(shaftTileAt(s, 101, 200)).toBe(TILE.AIR);
    expect(shaftTileAt(s, 103, 212)).toBe(TILE.AIR);
    expect(shaftTileAt(s, 102, 224)).toBe(TILE.SOLID);
  });

  it('壁は床帯の行ごとの上 3 行が出入口で、それ以外は固体', () => {
    for (const wx of [99, 104]) {
      for (const ym of [200, 208, 216, 224]) {
        expect(shaftTileAt(s, wx, ym)).toBe(TILE.SOLID);
        for (let d = 1; d <= SHAFT_DOOR_ROWS; d++) expect(shaftTileAt(s, wx, ym - d)).toBe(TILE.AIR);
      }
      expect(shaftTileAt(s, wx, 204)).toBe(TILE.SOLID);
      expect(shaftTileAt(s, wx, 196)).toBe(TILE.SOLID);
    }
  });

  it('乗り場は停止階だけ: 床は固体、上 3 行は空気、他の行は地形のまま', () => {
    for (const lx of [99 - LANDING_REACH, 98, 105, 104 + LANDING_REACH]) {
      for (const stop of [200, 224]) {
        expect(shaftTileAt(s, lx, stop)).toBe(TILE.SOLID);
        for (let d = 1; d <= SHAFT_DOOR_ROWS; d++) expect(shaftTileAt(s, lx, stop - d)).toBe(TILE.AIR);
      }
      expect(shaftTileAt(s, lx, 212)).toBeNull();
    }
    expect(shaftTileAt(s, 98 - LANDING_REACH, 224)).toBeNull();
    expect(shaftTileAt(s, 105 + LANDING_REACH, 224)).toBeNull();
  });
});

describe('昇降機の地形統合(tileAt)', () => {
  it('tileAt はシャフトの形を持ち(施設の梯子は残す)、ノイズの梯子は保たれる', () => {
    for (const { seed, s } of allShafts()) {
      const b = shaftBounds(s);
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) {
          const t = tileAt(seed, x, y);
          if (noiseTileAt(seed, x, y) === TILE.LADDER) {
            expect(t).toBe(TILE.LADDER);
            continue;
          }
          const want = shaftTileAt(s, x, y);
          if (want === null || t === TILE.LADDER) continue;
          expect(t).toBe(want);
        }
      }
      expect(elevatorTileAt(seed, s.x0 + 1, s.yBottom)).toBe(TILE.SOLID);
    }
  });

  it('両端の停止階は乗り場の床と頭上の空間が開いている(閉じ込めない)', () => {
    for (const { seed, s } of allShafts()) {
      for (const stop of [s.yTop, s.yBottom]) {
        for (const x of [s.x0 - 1 - LANDING_REACH, s.x0 - 2, s.x0 + SHAFT_WIDTH + 1, s.x0 + SHAFT_WIDTH + LANDING_REACH]) {
          const floor = tileAt(seed, x, stop);
          expect(isSolid(floor) || floor === TILE.LADDER).toBe(true);
          for (let d = 1; d <= SHAFT_DOOR_ROWS; d++) expect(isSolid(tileAt(seed, x, stop - d))).toBe(false);
        }
      }
    }
  });

  it('シャフトに落ちても下の停止階の床に着き、出入口から歩いて出られる(Player 結合)', () => {
    let tested = 0;
    for (const { seed, s } of allShafts()) {
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      // 内側に施設の梯子が通るシャフトは梯子に掴まって止まるので、落下の確認からは外す
      let ladder = false;
      for (let y = s.yTop - SHAFT_DOOR_ROWS; y <= s.yBottom && !ladder; y++) {
        for (let x = s.x0; x < s.x0 + SHAFT_WIDTH; x++) if (tiles(x, y) === TILE.LADDER) ladder = true;
      }
      if (ladder) continue;
      tested++;
      const player = new Player(s.x0 + 1.5, s.yTop - 1.8);
      const idle = { left: false, right: false, jump: false, up: false, down: false };
      for (let i = 0; i < 600; i++) player.update(idle, 1 / 60, tiles);
      expect(player.body.onGround).toBe(true);
      expect(Math.abs(player.body.y + player.body.h - s.yBottom)).toBeLessThan(0.1);
      const left = { ...idle, left: true };
      for (let i = 0; i < 120; i++) player.update(left, 1 / 60, tiles);
      expect(player.body.x + player.body.w).toBeLessThan(s.x0 - 1);
    }
    expect(tested).toBeGreaterThan(0);
  });
});
