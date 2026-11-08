import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import { pulseAimDir, PulseGun, resolvePulseSpawn } from './pulse';

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

  it('銃口が空いていれば銃口から生まれる', () => {
    const g = new PulseGun();
    g.update(1 / 60, true, 3, 2, 1, 0, emptyTiles, 2, 2);
    expect(g.pulses).toHaveLength(1);
    expect(g.pulses[0].body.x + 0.2).toBeCloseTo(3.5); // スポーン後に 0.5 進んだ中心
    expect(g.pulses[0].body.y + 0.2).toBeCloseTo(2);
  });

  it('銃口が壁の中なら後退して空いた位置から生まれる', () => {
    // 銃口 (8.5, 2) は x=8 列の壁の中。安全点は (6, 2)
    const s = resolvePulseSpawn(wallTiles, 8.5, 2, 6, 2);
    expect(s.x).toBeLessThanOrEqual(7.8); // 弾の箱(±0.2)が壁に重ならない
    expect(s.x).toBeGreaterThan(7);
    expect(s.y).toBe(2);
  });

  it('銃口が天井に埋まっていても、後退した位置から生まれて飛び続ける', () => {
    // ty=1 の行が天井。銃口 (2, 1.5) はその中、安全点は下の (2, 2.5)
    const ceilTiles = (_tx: number, ty: number): Tile =>
      ty === 1 ? TILE.SOLID : TILE.AIR;
    const s = resolvePulseSpawn(ceilTiles, 2, 1.5, 2, 2.5);
    expect(s.y).toBeGreaterThanOrEqual(2.2); // 箱の上端が天井行から抜ける

    const g = new PulseGun();
    g.update(1 / 60, true, 2, 1.5, 1, 0, ceilTiles, 2, 2.5);
    expect(g.pulses).toHaveLength(1); // 壁の中での即消滅にはならない
    for (let i = 0; i < 10; i++) g.update(1 / 60, false, 2, 1.5, 1, 0, ceilTiles, 2, 2.5);
    expect(g.pulses).toHaveLength(1); // 天井の下を飛び続ける
    expect(g.pulses[0].body.x).toBeGreaterThan(2);
  });

  it('安全点まで埋まっている場合は安全点に生まれて即消滅する(従来どおり)', () => {
    const allSolid = (): Tile => TILE.SOLID;
    expect(resolvePulseSpawn(allSolid, 8.5, 2, 6, 2)).toEqual({ x: 6, y: 2 });
    const g = new PulseGun();
    g.update(1 / 60, true, 8.5, 2, 1, 0, allSolid, 6, 2);
    expect(g.shotsFired).toBe(1);
    expect(g.pulses).toHaveLength(0);
  });
});
