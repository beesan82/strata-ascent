import { describe, expect, it } from 'vitest';
import { PickupLog, pickupLabel, PICKUP_LOG_MAX, PICKUP_LOG_TTL } from './pickupLog';

describe('pickupLabel', () => {
  it('全種別に表示名がある', () => {
    expect(pickupLabel('charge')).toBe('砲弾');
    expect(pickupLabel('pulsecell')).toBe('パルス弾セル');
    expect(pickupLabel('material')).toBe('素材');
    expect(pickupLabel('valuable')).toBe('貴重品');
    expect(pickupLabel('heal')).toBe('回復');
    expect(pickupLabel('ration')).toBe('糧食');
  });
});

describe('PickupLog', () => {
  it('新しい順に +1 付きで返す', () => {
    const log = new PickupLog();
    log.push('material', 0);
    log.push('charge', 0.5);
    expect(log.lines(0.6)).toEqual(['砲弾 +1', '素材 +1']);
  });

  it('TTL を過ぎた行は消える', () => {
    const log = new PickupLog();
    log.push('heal', 0);
    expect(log.lines(PICKUP_LOG_TTL - 0.1)).toEqual(['回復 +1']);
    expect(log.lines(PICKUP_LOG_TTL + 0.1)).toEqual([]);
  });

  it('最大件数を超えたら古い方から落ちる', () => {
    const log = new PickupLog();
    for (let i = 0; i < PICKUP_LOG_MAX + 2; i++) log.push('ration', i * 0.1);
    const lines = log.lines(0.6);
    expect(lines).toHaveLength(PICKUP_LOG_MAX);
    expect(lines[0]).toBe('糧食 +1');
  });
});
