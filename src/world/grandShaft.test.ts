import { describe, expect, it } from 'vitest';
import {
  GRAND_BAND_WIDTH,
  GRAND_BELOW_PLATE,
  GRAND_CALL_SPEED,
  GRAND_LOOKBACK_CELLS,
  GRAND_MAX_LENGTH,
  GRAND_MIN_LENGTH,
  GRAND_PASSAGE_CLEAR,
  GRAND_SPEED,
  GRAND_VISTA_REACH,
  GRAND_VISTA_ROWS,
  grandAmenitySpots,
  grandShaftAt,
  grandShaftBounds,
  grandShaftCovering,
  grandShaftsNear,
  grandShaftTileAt,
  grandStationsBelow,
  grandTileAt,
  type GrandShaft,
} from './grandShaft';
import { BIOME_CELL_BASE, BIOME_CELL_JITTER, biomeCellAt } from './biomeCells';
import { elevatorShaftAt, SHAFT_DOOR_ROWS, shaftBounds } from './elevator';
import { grandHallAt, hallChimneyAt } from './grandhall';
import { groupLadderX, interfaceTileAt, PASSAGE_SLOT, passageX } from './interface';
import { landmarkAt, spanOf } from './landmark';
import { megaFacilityAt } from './megafacility';
import { REST_HEIGHT, restPointAt } from './restpoint';
import { CHUNK_SIZE, isSolid, TILE } from './tiles';
import { generateChunk, isHardAt, tileAt } from './worldgen';
import { ELEVATOR_SPEED } from '../entities/elevator';
import { Player } from '../entities/player';

const SEEDS = [1, 42, 20260711, 7, 99];
const BANDS = [-3, -2, -1, 0, 1, 2, 3];
/** 開始 cell の走査範囲(大昇降機は稀なので広めに取る) */
const CELL_MIN = -30;
const CELL_MAX = 30;

let cached: { seed: number; s: GrandShaft }[] | null = null;
/** 調べる範囲の全シャフト(列バンド × 開始 cell) */
function allGrand(): { seed: number; s: GrandShaft }[] {
  if (cached) return cached;
  const out: { seed: number; s: GrandShaft }[] = [];
  for (const seed of SEEDS) {
    for (const band of BANDS) {
      for (let c = CELL_MIN; c < CELL_MAX; c++) {
        const s = grandShaftAt(seed, band, c);
        if (s) out.push({ seed, s });
      }
    }
  }
  cached = out;
  return out;
}

/** タイル単位で見るテストは数を絞る */
function someGrand(n: number): { seed: number; s: GrandShaft }[] {
  return allGrand().slice(0, n);
}

type Rect = { x0: number; x1: number; y0: number; y1: number };
function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

/** タイル単位の検査で見る行: 最初と最後の板のまわり(±margin 行)。全長 4800 行を毎回なめない */
function rowsNearPlates(s: GrandShaft, margin: number): number[] {
  const rows = new Set<number>();
  for (const p of [s.plates[0], s.plates[s.plates.length - 1]]) {
    for (let y = Math.max(s.bounds.y0, p.top - margin); y < Math.min(s.bounds.y1, p.bottom + margin); y++) rows.add(y);
  }
  return [...rows].sort((a, b) => a - b);
}

describe('grandShaftAt(配置)', () => {
  it('決定的: 同じ入力は常に同じ結果(別シードを挟んでも)', () => {
    const { seed, s } = allGrand()[0];
    grandShaftAt(seed + 1, s.band, s.startCell);
    expect(grandShaftAt(seed, s.band, s.startCell)).toEqual(s);
    grandShaftCovering(seed + 1, s.band, s.endCell);
    expect(grandShaftCovering(seed, s.band, s.endCell)).toEqual(s);
  });

  it('範囲内に大昇降機があり、世界の大物として稀(列バンド × 層の 1 割未満。2.20 初版の約 1 割より稀)', () => {
    const n = allGrand().length;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThan(SEEDS.length * BANDS.length * (CELL_MAX - CELL_MIN) * 0.1);
  });

  it('長さは 2400〜4800 で、6 層以上を貫き、停止階は上から下へ並ぶ', () => {
    for (const { s } of allGrand()) {
      const len = s.yBottom - s.yTop;
      expect(len).toBeGreaterThanOrEqual(GRAND_MIN_LENGTH);
      expect(len).toBeLessThanOrEqual(GRAND_MAX_LENGTH);
      expect(s.endCell - s.startCell + 1).toBeGreaterThanOrEqual(6);
      expect(s.endCell - s.startCell).toBeLessThanOrEqual(GRAND_LOOKBACK_CELLS);
      expect(s.plates.length).toBe(s.endCell - s.startCell);
      expect(s.stations.length).toBe(s.plates.length);
      expect(s.stops[0]).toBe(s.yTop);
      expect(s.stops[s.stops.length - 1]).toBe(s.yBottom);
      expect(s.stops.length).toBe(2 + s.plates.length * 2);
      for (let i = 1; i < s.stops.length; i++) expect(s.stops[i] - s.stops[i - 1]).toBeGreaterThan(SHAFT_DOOR_ROWS + 1);
    }
  });

  it('足場の速さは 3 タイル/秒(通常の昇降機は 5 のまま)で、乗り通しは約 13〜27 分', () => {
    expect(GRAND_SPEED).toBe(3);
    expect(ELEVATOR_SPEED).toBe(5);
    expect(GRAND_MIN_LENGTH / GRAND_SPEED / 60).toBeGreaterThan(13);
    expect(GRAND_MAX_LENGTH / GRAND_SPEED / 60).toBeLessThan(27);
    // 呼び戻しは最長でも約 120 秒
    expect(GRAND_MAX_LENGTH / GRAND_CALL_SPEED).toBeLessThanOrEqual(120);
    for (const { s } of allGrand()) {
      expect(s.speed).toBe(GRAND_SPEED);
      expect(s.callSpeed).toBe(GRAND_CALL_SPEED);
    }
  });

  it('上から来ているシャフトの探索範囲は最長のシャフトが貫く cell の数を覆う', () => {
    expect(GRAND_LOOKBACK_CELLS).toBeGreaterThanOrEqual(Math.ceil(GRAND_MAX_LENGTH / (BIOME_CELL_BASE - BIOME_CELL_JITTER)));
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

  it('外形は列バンドの内側に収まり、上下端は開始 cell・終わりの cell にあり、壁と内側に梯子列を含まない', () => {
    for (const { seed, s } of allGrand()) {
      const b = grandShaftBounds(s);
      expect(b.x0).toBeGreaterThanOrEqual(s.band * GRAND_BAND_WIDTH);
      expect(b.x1).toBeLessThanOrEqual((s.band + 1) * GRAND_BAND_WIDTH);
      expect(biomeCellAt(seed, b.y0)).toBe(s.startCell);
      expect(biomeCellAt(seed, b.y1 - 1)).toBe(s.endCell);
      for (let x = s.x0 - 1; x <= s.x0 + s.width; x++) expect(groupLadderX(seed, x)).not.toBe(x);
      expect(groupLadderX(seed, s.ladderX)).toBe(s.ladderX);
      expect(s.ladderX === s.landL || s.ladderX === s.landR).toBe(true);
    }
  });

  it('下の層の側から上から来ているシャフトを引ける(貫く全 cell で同じ 1 本、外では引けない)', () => {
    for (const { seed, s } of allGrand()) {
      for (let c = s.startCell; c <= s.endCell; c++) expect(grandShaftCovering(seed, s.band, c)?.id).toBe(s.id);
      expect(grandShaftCovering(seed, s.band, s.endCell + 1)?.id).not.toBe(s.id);
      expect(grandShaftCovering(seed, s.band, s.startCell - 1)?.id).not.toBe(s.id);
    }
  });

  it('同じ列バンドに並行する 2 本目は生えない(貫く cell の範囲が重ならない)', () => {
    for (const seed of SEEDS) {
      for (const band of BANDS) {
        const list = allGrand().filter((g) => g.seed === seed && g.s.band === band).map((g) => g.s);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length; j++) {
            const [a, b] = list[i].startCell < list[j].startCell ? [list[i], list[j]] : [list[j], list[i]];
            expect(a.endCell).toBeLessThan(b.startCell);
          }
        }
        // 開始 cell より上で始まり開始 cell まで届く候補があれば置かれない: 走査範囲の各 cell の持ち主は高々 1 本
        for (let c = CELL_MIN; c < CELL_MAX; c++) {
          const owners = list.filter((s) => s.startCell <= c && c <= s.endCell);
          expect(owners.length).toBeLessThanOrEqual(1);
          if (owners.length === 1) expect(grandShaftCovering(seed, band, c)?.id).toBe(owners[0].id);
        }
      }
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
    for (const { seed, s } of someGrand(2)) {
      const b = grandShaftBounds(s);
      for (let y = b.y0; y < b.y1; y++) {
        for (let x = b.x0; x < b.x1; x++) expect(megaFacilityAt(seed, x, y)).toBeNull();
      }
    }
  });

  it('grandShaftsNear はシャフトの上端・中ほど・最下端から引け、離れると引けない', () => {
    for (const { seed, s } of allGrand().slice(0, 10)) {
      for (const y of [s.yTop, (s.yTop + s.yBottom) / 2, s.yBottom - 1]) {
        const near = grandShaftsNear(seed, s.x0 + 3, y, 10, 10).map((n) => n.id);
        expect(near).toContain(s.id);
        expect(near.filter((id) => id === s.id).length).toBe(1);
      }
      const mid = (s.yTop + s.yBottom) / 2;
      expect(grandShaftsNear(seed, s.x0 + 3 + GRAND_BAND_WIDTH * 10, mid, 10, 10).map((n) => n.id)).not.toContain(s.id);
      expect(grandShaftsNear(seed, s.x0 + 3, s.yBottom + 200, 10, 10).map((n) => n.id)).not.toContain(s.id);
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

  it('この先の途中駅の数は降りるほど減り、最下端の手前で 0', () => {
    for (const { s } of allGrand()) {
      expect(grandStationsBelow(s, s.yTop)).toBe(s.plates.length);
      expect(grandStationsBelow(s, s.yBottom - 1)).toBe(0);
      let prev = Infinity;
      for (let y = s.yTop; y < s.yBottom; y += 50) {
        const n = grandStationsBelow(s, y);
        expect(n).toBeLessThanOrEqual(prev);
        prev = n;
      }
    }
  });
});

describe('大昇降機の地形統合(tileAt)', () => {
  it('tileAt はシャフトの形を持つ(板に当たる SOLID は板の HARD のまま。最初と最後の板のまわり)', () => {
    for (const { seed, s } of someGrand(3)) {
      const b = grandShaftBounds(s);
      for (const y of rowsNearPlates(s, 40)) {
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
    for (const { seed, s } of someGrand(3)) {
      for (let x = s.x0; x < s.x0 + s.width; x++) {
        expect(tileAt(seed, x, s.yTop - SHAFT_DOOR_ROWS - 1)).toBe(TILE.SOLID);
        expect(tileAt(seed, x, s.yBottom)).toBe(TILE.SOLID);
        for (let y = s.yTop - SHAFT_DOOR_ROWS; y < s.yBottom; y++) expect(tileAt(seed, x, y)).toBe(TILE.AIR);
      }
    }
  });

  it('板の行の壁は不壊で、isHardAt は tileAt と一致する', () => {
    for (const { seed, s } of someGrand(3)) {
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
    for (const { seed, s } of someGrand(6)) {
      for (const vy of s.vistas.slice(0, 4)) {
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

  it('長い乗車でも眺望区間は一定間隔で続く(全長にわたって多数ある)', () => {
    for (const { s } of allGrand()) {
      // 板と停止階のまわりは除く(層ごとに 80 行ごとの候補の 1〜2 個)ので、候補の 4 割以上は残る
      expect(s.vistas.length).toBeGreaterThan(((s.yBottom - s.yTop) / 80) * 0.4);
    }
  });

  it('チャンク境界一致: チャンクの生成結果はシャフトの範囲で tileAt と一致し、壁は境界をまたいで続く', () => {
    for (const { seed, s } of someGrand(3)) {
      const b = grandShaftBounds(s);
      const cx0 = Math.floor(b.x0 / CHUNK_SIZE);
      const cx1 = Math.floor((b.x1 - 1) / CHUNK_SIZE);
      // 最初の板と最後の板をまたぐ縦 2 チャンクずつ(板の上面の行を含むチャンクと、その上のチャンク)
      for (const plate of [s.plates[0], s.plates[s.plates.length - 1]]) {
        const cy = Math.floor(plate.top / CHUNK_SIZE);
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
        // 境界の行の上下で内側は空気
        const by = cy * CHUNK_SIZE;
        if (by > s.yTop && by < s.yBottom) {
          for (let x = s.x0; x < s.x0 + s.width; x++) {
            expect(tileAt(seed, x, by - 1)).toBe(TILE.AIR);
            expect(tileAt(seed, x, by)).toBe(TILE.AIR);
          }
        }
      }
    }
  });
});

describe('大昇降機の到達可能性(詰みなし)', () => {
  it('どの停止階も、壁の出入口から乗り場の床と頭上の空間が梯子列まで続く', () => {
    for (const { seed, s } of someGrand(12)) {
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
    for (const { seed, s } of someGrand(2)) {
      const tiles = (tx: number, ty: number) => tileAt(seed, tx, ty);
      const player = new Player(s.x0 + s.width / 2 - 0.4, s.yTop - 1.8);
      const idle = { left: false, right: false, jump: false, up: false, down: false };
      // 4800 タイルでも最大落下速度 25 タイル/秒で 192 秒ほどで着く(余裕を見て 240 秒)
      for (let i = 0; i < 60 * 240 && !(player.body.onGround && player.body.y > s.yBottom - 3); i++) player.update(idle, 1 / 60, tiles);
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
