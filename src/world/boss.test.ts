import { describe, expect, it } from 'vitest';
import { bossRewardFor, bossSpawnFor } from './boss';
import { grandHallAt } from './grandhall';

const SEED = 20260711;

/** seed の範囲内に最初に見つかる大広間のセル */
function firstHallCell(seed: number, from = -30, to = 30): number | null {
  for (let cell = from; cell <= to; cell++) {
    if (grandHallAt(seed, cell)) return cell;
  }
  return null;
}

/** seed の範囲内に最初に見つかる大広間の無いセル */
function firstPlainCell(seed: number, from = -30, to = 30): number | null {
  for (let cell = from; cell <= to; cell++) {
    if (!grandHallAt(seed, cell)) return cell;
  }
  return null;
}

describe('bossSpawnFor(ボスの配置、第2弾 §2)', () => {
  it('決定論: 同じ引数は同じ結果', () => {
    for (let cell = -20; cell <= 20; cell++) {
      expect(bossSpawnFor(SEED, cell)).toEqual(bossSpawnFor(SEED, cell));
    }
  });

  it('大広間があるセルにだけ出る(grandHallAt と一致する)', () => {
    for (let cell = -60; cell <= 60; cell++) {
      expect(bossSpawnFor(SEED, cell) !== null).toBe(grandHallAt(SEED, cell) !== null);
    }
  });

  it('大広間が無いセルでは null', () => {
    const cell = firstPlainCell(SEED);
    expect(cell).not.toBeNull();
    expect(bossSpawnFor(SEED, cell!)).toBeNull();
  });

  it('出現点は広間の床の中央で、ID は b:${cell}', () => {
    const cell = firstHallCell(SEED);
    expect(cell).not.toBeNull();
    const hall = grandHallAt(SEED, cell!)!;
    const spawn = bossSpawnFor(SEED, cell!);
    expect(spawn).not.toBeNull();
    expect(spawn!.id).toBe(`b:${cell}`);
    expect(spawn!.cell).toBe(cell);
    expect(spawn!.x).toBe((hall.x0 + hall.x1) / 2);
    expect(spawn!.floorY).toBe(hall.floorY);
    expect(spawn!.hall).toEqual(hall);
  });

  it('撃破済み(defeated)なら出ない(記録保持 §4: 再戦不可)', () => {
    const cell = firstHallCell(SEED);
    expect(cell).not.toBeNull();
    const defeated = new Set([`b:${cell}`]);
    expect(bossSpawnFor(SEED, cell!, defeated)).toBeNull();
    // 別のセルの撃破記録では抑止されない
    const other = new Set(['b:999999']);
    expect(bossSpawnFor(SEED, cell!, other)).not.toBeNull();
  });
});

describe('bossRewardFor(ボスの確定ドロップ、サバイバル段階 2)', () => {
  it('構成は回復 1 + 砲弾 1 + 糧食 1(設計 §5・§10)に貴重品 1 を確定で足した総数 4(段階 3-B §2)', () => {
    const reward = bossRewardFor();
    expect(reward).toHaveLength(4);
    expect(reward.filter((k) => k === 'heal')).toHaveLength(1);
    expect(reward.filter((k) => k === 'charge')).toHaveLength(1);
    expect(reward.filter((k) => k === 'ration')).toHaveLength(1);
    expect(reward.filter((k) => k === 'valuable')).toHaveLength(1);
  });

  it('並びは出現位置の割り当て順(中心=回復、左=砲弾、右=糧食、中心と右の間=貴重品)で決定的', () => {
    expect(bossRewardFor()).toEqual(['heal', 'charge', 'ration', 'valuable']);
    expect(bossRewardFor()).toEqual(bossRewardFor());
  });
});
