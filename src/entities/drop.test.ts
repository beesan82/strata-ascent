import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import {
  canPickup,
  DropItem,
  DROP_LIFETIME,
  DROP_BLINK_TIME,
  MAX_DROPS,
  pushDrop,
} from './drop';

/** y=10 行が床(x は全面) */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);

function step(d: DropItem, seconds: number): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) d.update(dt, floorTiles);
}

describe('DropItem(ドロップ実体)', () => {
  it('撃破位置から落下して床に静止する', () => {
    const d = new DropItem('charge', 5, 5);
    step(d, 2);
    expect(d.body.onGround).toBe(true);
    // 床行(y=10)の上に底が接して止まる
    expect(d.body.y + d.body.h).toBeCloseTo(10, 2);
    const restY = d.body.y;
    step(d, 1);
    expect(d.body.y).toBe(restY); // 静止したまま動かない
    expect(d.body.vy).toBe(0);
  });

  it('寿命 60 秒で期限切れになる', () => {
    const d = new DropItem('heal', 5, 9);
    step(d, DROP_LIFETIME - 1);
    expect(d.expired).toBe(false);
    step(d, 1.1);
    expect(d.expired).toBe(true);
  });

  it('残り 5 秒から点滅状態になる', () => {
    const d = new DropItem('charge', 5, 9);
    step(d, DROP_LIFETIME - DROP_BLINK_TIME - 1);
    expect(d.blinking).toBe(false);
    step(d, 1.1);
    expect(d.blinking).toBe(true);
  });

  it('種別と中心座標を保持する', () => {
    const d = new DropItem('heal', 7.5, 3.25);
    expect(d.kind).toBe('heal');
    expect(d.centerX).toBeCloseTo(7.5);
    expect(d.centerY).toBeCloseTo(3.25);
  });
});

describe('pushDrop(同時存在の上限)', () => {
  it('上限 16 個を超えたら古いものから消す', () => {
    const drops: DropItem[] = [];
    const items: DropItem[] = [];
    for (let i = 0; i < MAX_DROPS + 3; i++) {
      const d = new DropItem('charge', i, 0);
      items.push(d);
      pushDrop(drops, d);
    }
    expect(drops.length).toBe(MAX_DROPS);
    expect(drops[0]).toBe(items[3]); // 最古の 3 個が落ちている
    expect(drops[drops.length - 1]).toBe(items[items.length - 1]);
  });
});

describe('canPickup(満タン時は拾えない)', () => {
  it('砲弾: 満タンなら false、空きがあれば true', () => {
    expect(canPickup('charge', 3, 3, 5, 5)).toBe(false);
    expect(canPickup('charge', 2, 3, 5, 5)).toBe(true);
    expect(canPickup('charge', 0, 3, 1, 5)).toBe(true);
  });

  it('回復: 全快なら false、減っていれば true', () => {
    expect(canPickup('heal', 0, 3, 5, 5)).toBe(false);
    expect(canPickup('heal', 3, 3, 4, 5)).toBe(true);
  });
});
