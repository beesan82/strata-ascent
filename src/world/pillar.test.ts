import { describe, expect, it } from 'vitest';
import { TILE, isSolid } from './tiles';
import { baseTileAt, composedTileAt, generateChunk, isHardAt, tileAt } from './worldgen';
import { biomeCellAt } from './biomeCells';
import {
  pillarDoorAt, pillarForUnit, pillarsInRect, pillarTileAt,
  PILLAR_AIR_MAX, PILLAR_DOOR_ROWS, PILLAR_LADDER_CLEAR, PILLAR_LANDING_MAX,
  PILLAR_MAX_WIDTH, PILLAR_MIN_WIDTH, PILLAR_PLATE_CLEAR, PILLAR_SPACING, PILLAR_UNIT_WIDTH,
  type Pillar,
} from './pillar';
import { groupLadderX, interfaceBottom, interfaceTop } from './interface';

const SEED = 20260711;
const baseGet = (x: number, y: number): number => baseTileAt(SEED, x, y);

/** 範囲内の柱を集める(テスト用) */
export function collectPillars(seed: number, x0: number, x1: number, y0: number, y1: number): Pillar[] {
  const get = (x: number, y: number): number => baseTileAt(seed, x, y);
  return pillarsInRect(seed, x0, x1, y0, y1, get);
}

describe('巨柱: 生成と幾何', () => {
  it('標準シードで柱が見つかる', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
  }, 300_000);

  it('外形は組の内側に収まり、幅は 16〜24、上下は板から 64 行以上離れる', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      expect(p.x0).toBeGreaterThanOrEqual(p.unit * PILLAR_UNIT_WIDTH);
      expect(p.x0 + p.w).toBeLessThanOrEqual((p.unit + 1) * PILLAR_UNIT_WIDTH);
      expect(p.w).toBeGreaterThanOrEqual(PILLAR_MIN_WIDTH);
      expect(p.w).toBeLessThanOrEqual(PILLAR_MAX_WIDTH);
      expect(p.yTop).toBeGreaterThanOrEqual(interfaceBottom(SEED, p.cell) + PILLAR_PLATE_CLEAR);
      expect(p.yBottom).toBeLessThanOrEqual(interfaceTop(SEED, p.cell + 1) - PILLAR_PLATE_CLEAR);
    }
  }, 300_000);

  it('決定論: 同じ組は同じ柱を返す', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    const p = list[0];
    expect(pillarForUnit(SEED, p.unit, p.cell, baseGet)).toEqual(p);
    expect(collectPillars(SEED, -2304, 2304, -3000, 3000)).toEqual(list);
  }, 300_000);

  it('梯子列から 4 列以上離れ、乗り場は 40 列以内で梯子列に届く', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    for (const p of list) {
      // landL / landR は梯子列そのもの
      expect(groupLadderX(SEED, p.landL)).toBe(p.landL);
      expect(groupLadderX(SEED, p.landR)).toBe(p.landR);
      expect(p.x0 - p.landL).toBeGreaterThanOrEqual(PILLAR_LADDER_CLEAR);
      expect(p.landR - (p.x0 + p.w)).toBeGreaterThanOrEqual(PILLAR_LADDER_CLEAR);
      expect(p.x0 - p.landL).toBeLessThanOrEqual(PILLAR_LANDING_MAX);
      expect(p.landR - (p.x0 + p.w)).toBeLessThanOrEqual(PILLAR_LANDING_MAX);
      // 間にある梯子列はもっと近くに無い(最寄りであること)
      for (let x = p.landL + 1; x < p.x0 - PILLAR_LADDER_CLEAR + 1; x++) {
        expect(groupLadderX(SEED, x)).not.toBe(x);
      }
    }
  }, 300_000);

  it('隣の柱との間は 64 列以上', () => {
    const list = collectPillars(SEED, -4608, 4608, -3000, 3000);
    const byCell = new Map<number, Pillar[]>();
    for (const p of list) {
      const arr = byCell.get(p.cell) ?? [];
      arr.push(p);
      byCell.set(p.cell, arr);
    }
    for (const arr of byCell.values()) {
      arr.sort((a, b) => a.x0 - b.x0);
      for (let i = 1; i < arr.length; i++) {
        expect(arr[i].x0 - (arr[i - 1].x0 + arr[i - 1].w)).toBeGreaterThanOrEqual(PILLAR_SPACING);
      }
    }
  }, 300_000);

  it('空気の割合(穴)は上限以下で、穴は 2 本以上ある', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      const airRows = p.doors.length * PILLAR_DOOR_ROWS;
      const totalRows = p.yBottom - p.yTop + 1;
      expect(airRows / totalRows).toBeLessThanOrEqual(PILLAR_AIR_MAX);
      expect(p.doors.length).toBeGreaterThanOrEqual(2);
      for (const d of p.doors) expect(pillarDoorAt(p, d)).toBe(true);
      expect(pillarDoorAt(p, p.yTop)).toBe(false);
    }
  }, 300_000);

  it('最下のバンドの隙間の下に閉じた足場がある候補は採らない', () => {
    // 塞がれる足場の実例(標準シード、柱 p:-8,-6。x0=-1462, w=19, landL=-1472, landR=-1430,
    // yTop=-2070, yBottom=-1908): 基準地形では最下のバンド行 -1908 の本体列内 x=-1456 に隙間が
    // あり、そこから落ちて帯の下の足場(床行 -1899、立つ行 -1900、x -1456..-1452)に届いていた。
    // 柱を入れると最下の穴の床が隙間を塞ぎ、その足場へ届く経路が無くなるため、候補ごと棄却する
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.some((p) => p.id === 'p:-8,-6')).toBe(false);
  }, 300_000);

  it('埋め立てに囲まれる梯子がある候補は採らない', () => {
    // 囲まれる梯子の実例(シード 42、柱 p:-2,-5。x0=-290, w=18, landL=-311, landR=-257,
    // yTop=-1815, yBottom=-1562、穴は -1760, -1705, -1650, -1595): 基準地形では本体の列内
    // x=-281 / -280 に施設の梯子(行 -1803..-1785)があり、西側の斜面から乗り移って降りられた。
    // 柱を入れると梯子タイルは残るが周囲が埋め立てで固まり、どの穴のトンネルにも、上端・下端の
    // 外にもつながらない孤島になって、梯子の上に立つセルへ届かなくなるため、候補ごと棄却する
    const list = collectPillars(42, -2304, 2304, -3000, 3000);
    expect(list.some((p) => p.id === 'p:-2,-5')).toBe(false);
  }, 300_000);

  it('pillarsInRect は矩形に重なる柱だけを返す', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    const p = list[0];
    // 柱の (x0, yTop) を含む小さい矩形
    const near = pillarsInRect(SEED, p.x0 - 2, p.x0 + 2, p.yTop - 2, p.yTop + 2, baseGet);
    expect(near.some((q) => q.id === p.id)).toBe(true);
    // 柱から遠く離れた矩形(横に 5000 列先)
    const far = pillarsInRect(SEED, p.x0 + 5000, p.x0 + 5010, p.yTop - 2, p.yTop + 2, baseGet);
    expect(far.some((q) => q.id === p.id)).toBe(false);
  }, 300_000);
});

describe('巨柱: タイルの不変条件', () => {
  it('穴の行ではトンネルと乗り場が梯子列まで連続し、上が 3 行空く', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      for (const d of p.doors) {
        for (let x = p.landL + 1; x < p.landR; x++) {
          if (x === p.landL) continue;
          // 床は SOLID。ただし梯子列が通る列は LADDER のまま(上昇路を切らない)
          const floorTile = tileAt(SEED, x, d);
          expect(floorTile === TILE.SOLID || floorTile === TILE.LADDER).toBe(true);
          for (let k = 1; k <= PILLAR_DOOR_ROWS; k++) {
            const t = tileAt(SEED, x, d - k);
            if (x > p.landL && x < p.landR) {
              // 梯子列そのものは LADDER のまま。それ以外は AIR(オーバーレイの梯子もありうる)
              expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
            }
          }
        }
      }
    }
  }, 300_000);

  it('本体は穴以外の行で SOLID、頂部は平らで立てる', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    for (const p of list) {
      const midX = p.x0 + Math.floor(p.w / 2);
      for (let y = p.yTop; y <= p.yBottom; y++) {
        const t = tileAt(SEED, midX, y);
        if (pillarDoorAt(p, y)) {
          expect(t === TILE.SOLID || t === TILE.LADDER).toBe(true);
        } else if (pillarDoorAt(p, y + 1) || pillarDoorAt(p, y + 2) || pillarDoorAt(p, y + 3)) {
          expect(t === TILE.AIR || t === TILE.LADDER).toBe(true);
        } else {
          // 本体は SOLID。施設・幹線のオーバーレイの梯子が通る列だけ LADDER が残る
          expect(t === TILE.SOLID || t === TILE.LADDER).toBe(true);
        }
      }
      // 頂部: 上端の行は SOLID(梯子列が通る列だけ LADDER が残る)
      const topTile = tileAt(SEED, midX, p.yTop);
      expect(topTile === TILE.SOLID || topTile === TILE.LADDER).toBe(true);
    }
  }, 300_000);

  it('isHardAt は tileAt の HARD と一致する(柱は HARD でない)', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      for (let y = p.yTop - 2; y <= p.yBottom + 2; y += 7) {
        for (let x = p.landL; x < p.landR; x += 5) {
          expect(isHardAt(SEED, x, y)).toBe(tileAt(SEED, x, y) === TILE.HARD);
        }
      }
      const midX = p.x0 + Math.floor(p.w / 2);
      expect(isHardAt(SEED, midX, p.yTop + 10)).toBe(false);
    }
  }, 300_000);

  it('generateChunk は tileAt と一致し、チャンク境界で途切れない', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    expect(list.length).toBeGreaterThan(0);
    const p = list[0];
    const cx0 = Math.floor(p.landL / 64);
    const cx1 = Math.floor(p.landR / 64);
    const cy0 = Math.floor(p.yTop / 64);
    const cy1 = Math.floor(p.yBottom / 64);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const chunk = generateChunk(SEED, cx, cy);
        for (let ty = 0; ty < 64; ty++) {
          for (let tx = 0; tx < 64; tx++) {
            expect(chunk[ty * 64 + tx]).toBe(tileAt(SEED, cx * 64 + tx, cy * 64 + ty));
          }
        }
      }
    }
  }, 300_000);

  it('柱のタイルは composedTileAt でも同じ(中間段の対象にしない)', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    const p = list[0];
    const midX = p.x0 + Math.floor(p.w / 2);
    expect(composedTileAt(SEED, midX, p.yTop + 10)).toBe(TILE.SOLID);
    expect(pillarTileAt(SEED, midX, p.yTop + 10, baseGet)).toBe(TILE.SOLID);
    expect(isSolid(baseTileAt(SEED, midX, p.yTop + 10)) || baseTileAt(SEED, midX, p.yTop + 10) === TILE.AIR).toBe(true);
  }, 300_000);

  it('柱のセルはタイルの属するセルと一致する', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000);
    for (const p of list) {
      expect(biomeCellAt(SEED, p.yTop)).toBe(p.cell);
      expect(biomeCellAt(SEED, p.yBottom)).toBe(p.cell);
    }
  }, 300_000);

  it('帯の列は穴の行以外は埋まり、穴の行ではトンネルが開く', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000).slice(0, 3);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      const doorSet = new Set(p.doors);
      // 列は 5 列おきの標本(梯子列 landL / landR には触れない)
      for (let x = p.landL + 1; x < p.landR; x += 5) {
        for (let y = p.yTop; y <= p.yBottom; y++) {
          const isFloor = doorSet.has(y);
          const isTunnel = doorSet.has(y + 1) || doorSet.has(y + 2) || doorSet.has(y + 3);
          // 穴の床行と上 3 行は全行、それ以外の行は 5 行おきの標本
          if (!isFloor && !isTunnel && (y - p.yTop) % 5 !== 0) continue;
          const t = tileAt(SEED, x, y);
          if (isFloor) expect(t, `${p.id} 床 (${x},${y})`).toBe(TILE.SOLID);
          else if (isTunnel) expect(t, `${p.id} トンネル (${x},${y})`).toBe(TILE.AIR);
          else expect(t, `${p.id} 帯 (${x},${y})`).toBe(TILE.SOLID);
        }
      }
    }
  }, 300_000);

  it('pillarDoorAt と tileAt が整合する', () => {
    const list = collectPillars(SEED, -2304, 2304, -3000, 3000).slice(0, 3);
    expect(list.length).toBeGreaterThan(0);
    for (const p of list) {
      for (let y = p.yTop; y <= p.yBottom; y++) {
        if (pillarDoorAt(p, y)) {
          expect(tileAt(SEED, p.x0, y), `${p.id} 穴の床行 ${y}`).toBe(TILE.SOLID);
        } else if (pillarDoorAt(p, y + 1) || pillarDoorAt(p, y + 2) || pillarDoorAt(p, y + 3)) {
          expect(tileAt(SEED, p.x0, y), `${p.id} 穴の直上 ${y}`).toBe(TILE.AIR);
        }
      }
    }
  }, 300_000);
});
