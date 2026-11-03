import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { pulseAimDir, PulseGun } from './pulse';

const emptyTiles = (): Tile => TILE.AIR;
/** x=8 列が壁 */
const wallTiles = (tx: number): Tile => (tx === 8 ? TILE.SOLID : TILE.AIR);

describe('pulseAimDir(8 方向照準)', () => {
  const none = { left: false, right: false, up: false, down: false };
  it('入力が無ければ向きの水平', () => {
    expect(pulseAimDir(none, 1)).toEqual({ x: 1, y: 0 });
    expect(pulseAimDir(none, -1)).toEqual({ x: -1, y: 0 });
  });
  it('上下のみなら真上・真下、斜めは正規化される', () => {
    expect(pulseAimDir({ ...none, up: true }, 1)).toEqual({ x: 0, y: -1 });
    expect(pulseAimDir({ ...none, down: true }, 1)).toEqual({ x: 0, y: 1 });
    const d = pulseAimDir({ ...none, right: true, up: true }, 1);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeLessThan(0);
  });
});

describe('PulseGun', () => {
  it('発射すると弾が進み、射程を超えると消える', () => {
    const g = new PulseGun();
    g.update(1 / 60, true, 0, 0, 1, 0, emptyTiles);
    expect(g.shotsFired).toBe(1);
    expect(g.pulses).toHaveLength(1);
    for (let i = 0; i < 20; i++) g.update(1 / 60, false, 0, 0, 1, 0, emptyTiles);
    expect(g.pulses).toHaveLength(1); // 0.33 秒 ≈ 10 タイル < 射程 14
    for (let i = 0; i < 20; i++) g.update(1 / 60, false, 0, 0, 1, 0, emptyTiles);
    expect(g.pulses).toHaveLength(0); // 射程超過で消滅
  });

  it('連射は約 6 発/秒(1 秒保持で 5〜7 発)', () => {
    const g = new PulseGun();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, 0, 0, 1, 0, emptyTiles);
    expect(g.shotsFired).toBeGreaterThanOrEqual(5);
    expect(g.shotsFired).toBeLessThanOrEqual(7);
  });

  it('壁に当たると消える(壁の向こうへ抜けない)', () => {
    const g = new PulseGun();
    for (let i = 0; i < 90; i++) {
      g.update(1 / 60, true, 2, 2, 1, 0, wallTiles);
      for (const p of g.pulses) expect(p.body.x).toBeLessThan(8);
    }
  });

  it('斜めの弾は両軸に進む', () => {
    const g = new PulseGun();
    const d = pulseAimDir({ left: false, right: true, up: true, down: false }, 1);
    g.update(1 / 60, true, 5, 5, d.x, d.y, emptyTiles);
    const p = g.pulses[0];
    expect(p.body.x).toBeGreaterThan(5);
    expect(p.body.y).toBeLessThan(5);
  });
});
