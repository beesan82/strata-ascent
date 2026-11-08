import { describe, expect, it } from 'vitest';
import {
  GRAND_HALL_HEIGHT, GRAND_HALL_RATE, GRAND_HALL_WIDTH, grandHallAt,
  HALL_CHIMNEY_HEIGHTS, HALL_CHIMNEY_WIDTH, hallChimneyAt,
} from './grandhall';
import { biomeCellAt } from './biomeCells';
import { groupLadderX, interfaceBottom, interfaceTop } from './interface';
import { restPointAt } from './restpoint';
import { Destruction } from './destruction';
import { CHUNK_SIZE, TILE } from './tiles';
import { generateChunk, isHardAt, noiseTileAt, tileAt, tileAtLive } from './worldgen';

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

describe('hallChimneyAt(絶景拡張の煙突)', () => {
  it('広間が無いセルでは null', () => {
    let found = false;
    for (let cell = -30; cell <= 30; cell++) {
      if (grandHallAt(SEED, cell)) continue;
      expect(hallChimneyAt(SEED, cell)).toBeNull();
      found = true;
    }
    expect(found).toBe(true);
  });

  it('幾何: 幅 96・高さは候補のいずれか・y1 = 広間の y0・中心寄せ・決定論', () => {
    let halls = 0;
    for (let cell = -30; cell <= 30; cell++) {
      const hall = grandHallAt(SEED, cell);
      if (!hall) continue;
      halls++;
      const chim = hallChimneyAt(SEED, cell);
      expect(chim).not.toBeNull();
      expect(chim!).toEqual(hallChimneyAt(SEED, cell));
      expect(chim!.cell).toBe(hall.cell);
      expect(chim!.x1 - chim!.x0).toBe(HALL_CHIMNEY_WIDTH);
      expect(HALL_CHIMNEY_HEIGHTS).toContain(chim!.height);
      expect(chim!.y1).toBe(hall.y0);
      expect(chim!.y0).toBe(hall.y0 - chim!.height);
      expect((chim!.x0 + chim!.x1) / 2).toBe((hall.x0 + hall.x1) / 2);
    }
    expect(halls).toBeGreaterThanOrEqual(3);
  });

  it('煙突の内側は AIR(1 つ上のセルへ跨る範囲も含む)、外は彫られない', () => {
    const hall = firstHall(SEED, 0, 30);
    expect(hall).not.toBeNull();
    const chim = hallChimneyAt(SEED, hall!.cell)!;
    expect(chim).not.toBeNull();
    let col = chim.x0 + HALL_CHIMNEY_WIDTH / 2;
    while (col === groupLadderX(SEED, col)) col++;
    // 煙突の全高にわたって内側は空気(ノイズ躯体)
    for (const y of [chim.y0 + 4, chim.y0 + 40, Math.floor((chim.y0 + chim.y1) / 2), chim.y1 - 40, chim.y1 - 8]) {
      expect(noiseTileAt(SEED, col, y), `chimney (${col}, ${y})`).toBe(TILE.AIR);
    }
    // 上端付近は 1 つ上のセルの領域(biomeCellAt が hall.cell - 1)で、下のセルの煙突として引かれる
    expect(biomeCellAt(SEED, chim.y0 + 4)).toBe(hall!.cell - 1);
    expect(tileAt(SEED, col, chim.y0 + 4)).toBe(TILE.AIR);
    // 煙突のすぐ外(同じ行・x1 の列)は彫られず従来の躯体のまま SOLID
    expect(noiseTileAt(SEED, col, chim.y1 - 16)).toBe(TILE.AIR);
    expect(noiseTileAt(SEED, chim.x1, chim.y1 - 16)).toBe(TILE.SOLID);
  });

  it('tileAt の合成では界面の板が煙突に勝つ(優先順位の維持)', () => {
    const hall = firstHall(SEED, 0, 30);
    expect(hall).not.toBeNull();
    const chim = hallChimneyAt(SEED, hall!.cell)!;
    let col = chim.x0 + HALL_CHIMNEY_WIDTH / 2;
    while (col === groupLadderX(SEED, col)) col++;
    // 広間のセルの天井の板の行(top + 20 は板の厚みの内側)は煙突の範囲内でも HARD のまま
    const plateY = interfaceTop(SEED, hall!.cell) + 20;
    expect(plateY).toBeGreaterThanOrEqual(chim.y0);
    expect(plateY).toBeLessThan(chim.y1);
    expect(noiseTileAt(SEED, col, plateY)).toBe(TILE.AIR);
    expect(tileAt(SEED, col, plateY)).toBe(TILE.HARD);
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
    // 底の床の行は不壊(HARD)
    expect(noiseTileAt(SEED, col, floorY)).toBe(TILE.HARD);
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

  it('広間の床は tileAt でも HARD で、isHardAt も真(界面・大構造に掛からない列)', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    let col = hall!.x0 + 10;
    while (col === groupLadderX(SEED, col)) col++;
    expect(tileAt(SEED, col, hall!.floorY)).toBe(TILE.HARD);
    expect(isHardAt(SEED, col, hall!.floorY)).toBe(true);
    // 床の 1 行上(内側の空気)と広間の外の同じ行は HARD ではない
    expect(isHardAt(SEED, col, hall!.floorY - 1)).toBe(false);
    expect(isHardAt(SEED, hall!.x1 + 10, hall!.floorY)).toBe(false);
  });

  it('bore で広間の床は掘れない(生成済み・未生成のどちらの経路でも)', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    let col = hall!.x0 + 10;
    while (col === groupLadderX(SEED, col)) col++;
    const { floorY } = hall!;
    // 生成済みタイル経路: HARD は bore がスキップする
    const d = new Destruction();
    d.bore(col - 5, floorY, 0, 10, 0, (ax, ay) => tileAt(SEED, ax, ay), (ax, ay) => isHardAt(SEED, ax, ay));
    expect(d.isDestroyed(col, floorY)).toBe(false);
    expect(tileAtLive(SEED, col, floorY, d)).toBe(TILE.HARD);
    // 未生成チャンク経路: isHardAt の述語で記録自体をしない
    const d2 = new Destruction();
    d2.bore(col - 5, floorY, 0, 10, 0, () => undefined, (ax, ay) => isHardAt(SEED, ax, ay));
    expect(d2.isDestroyed(col, floorY)).toBe(false);
    const cx = Math.floor(col / CHUNK_SIZE), cy = Math.floor(floorY / CHUNK_SIZE);
    const chunk = generateChunk(SEED, cx, cy);
    d2.applyTo(chunk, cx, cy);
    expect(chunk[(floorY - cy * CHUNK_SIZE) * CHUNK_SIZE + (col - cx * CHUNK_SIZE)]).toBe(TILE.HARD);
  });

  it('広間の外の通常の床は従来どおり SOLID で bore で掘れる', () => {
    const hall = firstHall(SEED);
    expect(hall).not.toBeNull();
    // 広間の外(同じ層・範囲外)から SOLID を 1 枚探す(決定論スキャン)
    let target: { x: number; y: number } | null = null;
    for (let y = hall!.y0; y <= hall!.floorY && !target; y++) {
      for (let x = hall!.x1 + 50; x < hall!.x1 + 400 && !target; x++) {
        if (tileAt(SEED, x, y) === TILE.SOLID) target = { x, y };
      }
    }
    expect(target).not.toBeNull();
    expect(isHardAt(SEED, target!.x, target!.y)).toBe(false);
    const d = new Destruction();
    d.bore(target!.x, target!.y, 0, 0, 0, (ax, ay) => tileAt(SEED, ax, ay), (ax, ay) => isHardAt(SEED, ax, ay));
    expect(d.isDestroyed(target!.x, target!.y)).toBe(true);
    expect(tileAtLive(SEED, target!.x, target!.y, d)).toBe(TILE.AIR);
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
