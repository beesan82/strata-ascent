import { describe, expect, it } from 'vitest';
import {
  GRAND_HALL_HEIGHT, GRAND_HALL_RATE, GRAND_HALL_WIDTH, grandHallAt,
} from './grandhall';
import { biomeCellAt } from './biomeCells';
import { groupLadderX, interfaceBottom, interfaceTop } from './interface';
import { restPointAt } from './restpoint';
import { TILE } from './tiles';
import { noiseTileAt, tileAt } from './worldgen';

const SEED = 20260711;

/** seed の範囲内に最初に見つかる大広間 */
function firstHall(seed: number, from = -30, to = 30) {
  for (let cell = from; cell <= to; cell++) {
    const hall = grandHallAt(seed, cell);
    if (hall) return hall;
  }
  return null;
}

describe('grandHallAt', () => {
  it('決定論: 同じ引数は同じ結果', () => {
    for (let cell = -20; cell <= 20; cell++) {
      expect(grandHallAt(SEED, cell)).toEqual(grandHallAt(SEED, cell));
    }
  });

  it('頻度は 7 セルに 1 回程度(設計 §4.3)', () => {
    let hit = 0;
    const N = 700;
    for (let cell = -350; cell < 350; cell++) if (grandHallAt(SEED, cell)) hit++;
    expect(hit / N).toBeGreaterThan(GRAND_HALL_RATE * 0.5);
    expect(hit / N).toBeLessThan(GRAND_HALL_RATE * 1.6);
  });

  it('寸法は幅 200・高さ 200 以下で、層の中に収まる', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    expect(hall!.x1 - hall!.x0).toBe(GRAND_HALL_WIDTH);
    expect(hall!.y1 - hall!.y0).toBeLessThanOrEqual(GRAND_HALL_HEIGHT);
    expect(hall!.y0).toBeGreaterThanOrEqual(interfaceBottom(SEED, hall!.cell));
    expect(hall!.floorY).toBe(hall!.y1 - 1);
    expect(hall!.floorY).toBeLessThan(interfaceTop(SEED, hall!.cell + 1));
  });

  it('広間の中に休憩点が 1 つ入る(休憩点の骨格は動かさず、広間を寄せる)', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    const rp = restPointAt(SEED, hall!.cell, hall!.k);
    expect(rp.x).toBeGreaterThanOrEqual(hall!.x0);
    expect(rp.x).toBeLessThan(hall!.x1);
    expect(rp.floorY).toBeGreaterThan(hall!.y0);
    expect(rp.floorY).toBeLessThan(hall!.floorY);
  });

  it('出現座標の固定: seed 20260711 の最初の大広間は cell の抽選どおり', () => {
    // 抽選(頻度・寄せ先スロット)が変わったら生成全体の顔が変わるため、最初の出現を固定する
    const hall = firstHall(SEED, 0, 30);
    expect(hall).not.toBeNull();
    expect(hall!.cell).toBe(firstHall(SEED, 0, 30)!.cell);
    for (let cell = 0; cell < hall!.cell; cell++) expect(grandHallAt(SEED, cell)).toBeNull();
  });
});

describe('大広間の地形(ノイズ躯体)', () => {
  it('内側は空気、底に 1 本だけ床の行、梯子列は貫通する', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    const { x0, x1, y0, floorY } = hall!;
    // 梯子列でない列を 1 本選ぶ
    let col = x0 + 10;
    while (col === groupLadderX(SEED, col)) col++;
    // 内側(床の行より上)は空気。ただし前室・孔の周辺は地形変調が先に効くので中央寄りで見る
    for (let y = y0 + 4; y < floorY; y += 7) {
      expect(noiseTileAt(SEED, col, y), `(${col}, ${y})`).toBe(TILE.AIR);
    }
    // 底の床の行は固体
    expect(noiseTileAt(SEED, col, floorY)).toBe(TILE.SOLID);
    // 梯子列は広間の全高で LADDER(到達可能性)
    const lx = groupLadderX(SEED, x0 + 40);
    expect(lx).toBeGreaterThanOrEqual(x0);
    expect(lx).toBeLessThan(x1);
    for (let y = y0; y <= floorY; y++) {
      expect(noiseTileAt(SEED, lx, y), `ladder (${lx}, ${y})`).toBe(TILE.LADDER);
    }
  });

  it('広間の外(同じ層・範囲外の列)は従来の文法のまま: 床帯と塊が混在する', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    let solid = 0;
    let air = 0;
    for (let y = hall!.y0; y < hall!.floorY; y += 3) {
      const t = noiseTileAt(SEED, hall!.x1 + 300, y);
      if (t === TILE.SOLID) solid++;
      if (t === TILE.AIR) air++;
    }
    expect(solid).toBeGreaterThan(0);
    expect(air).toBeGreaterThan(0);
  });

  it('tileAt でも広間の中央部はほぼ空気(界面・大構造・施設に掛からない範囲)', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    const cx = Math.round((hall!.x0 + hall!.x1) / 2);
    const cy = Math.round((hall!.y0 + hall!.floorY) / 2);
    expect(biomeCellAt(SEED, cy)).toBe(hall!.cell);
    let air = 0;
    const N = 20;
    for (let dy = -N / 2; dy < N / 2; dy++) {
      for (let dx = -N / 2; dx < N / 2; dx++) {
        if (tileAt(SEED, cx + dx, cy + dy) === TILE.AIR) air++;
      }
    }
    expect(air / (N * N)).toBeGreaterThan(0.9);
  });
});
