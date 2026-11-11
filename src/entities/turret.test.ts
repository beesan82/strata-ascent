import { describe, expect, it } from 'vitest';
import { TILE, type Tile } from '../world/tiles';
import {
  Turret,
  TurretShot,
  hasLineOfSight,
  TURRET_FIRE_INTERVAL,
  TURRET_FIRST_DELAY,
  TURRET_HP,
  TURRET_RANGE,
  TURRET_SHOT_LIFE,
  TURRET_SHOT_SIZE,
  TURRET_SHOT_SPEED,
  TURRET_W,
  TURRET_H,
  TURRET_SENSOR_HP,
} from './turret';

const noTiles = (): Tile => TILE.AIR;
/** x=8 列の壁 */
const wallTiles = (tx: number): Tile => (tx === 8 ? TILE.SOLID : TILE.AIR);
/** x=8 列の梯子 */
const ladderTiles = (tx: number): Tile => (tx === 8 ? TILE.LADDER : TILE.AIR);
/** y=10 行が床 */
const floorTiles = (_tx: number, ty: number): Tile => (ty === 10 ? TILE.SOLID : TILE.AIR);

describe('hasLineOfSight(視線判定)', () => {
  it('障害物が無ければ通る', () => {
    expect(hasLineOfSight(noTiles, 0.5, 0.5, 15.5, 0.5)).toBe(true);
    expect(hasLineOfSight(noTiles, 0.5, 0.5, 0.5, 12.5)).toBe(true);
    expect(hasLineOfSight(noTiles, 0.5, 0.5, 9.5, 9.5)).toBe(true);
  });

  it('途中に固体壁があると遮断される', () => {
    expect(hasLineOfSight(wallTiles, 0.5, 0.5, 15.5, 0.5)).toBe(false);
  });

  it('壁の手前までなら通る', () => {
    expect(hasLineOfSight(wallTiles, 0.5, 0.5, 7.5, 0.5)).toBe(true);
  });

  it('梯子は遮らない', () => {
    expect(hasLineOfSight(ladderTiles, 0.5, 0.5, 15.5, 0.5)).toBe(true);
  });

  it('HARD(破壊不能の固体)も遮断する', () => {
    const hard = (tx: number): Tile => (tx === 8 ? TILE.HARD : TILE.AIR);
    expect(hasLineOfSight(hard, 0.5, 0.5, 15.5, 0.5)).toBe(false);
  });
});

describe('Turret(固定砲台)', () => {
  it('定数の初期値: HP 4・射程 10・間隔 1.6・初回遅延 0.8・弾速 12・弾 0.3・寿命約 1.1', () => {
    expect(TURRET_HP).toBe(4);
    expect(TURRET_RANGE).toBe(10);
    expect(TURRET_FIRE_INTERVAL).toBe(1.6);
    expect(TURRET_FIRST_DELAY).toBe(0.8);
    expect(TURRET_SHOT_SPEED).toBe(12);
    expect(TURRET_SHOT_SIZE).toBe(0.3);
    expect(TURRET_SHOT_LIFE).toBeCloseTo(1.1);
    expect(TURRET_SHOT_LIFE).toBeGreaterThan(TURRET_RANGE / TURRET_SHOT_SPEED);
  });

  it('動かない(位置が変わらず、床の上に置かれる前提の体格 1.2×1.2。2.19 で 0.9 から大型化)', () => {
    const t = new Turret(3, 10 - TURRET_H);
    expect(TURRET_W).toBe(1.2);
    expect(TURRET_H).toBe(1.2);
    expect(t.body.w).toBe(TURRET_W);
    expect(t.body.h).toBe(TURRET_H);
    for (let i = 0; i < 60; i++) t.update(1 / 60, floorTiles, 100, 100);
    expect(t.body.x).toBe(3);
    expect(t.body.y).toBe(10 - TURRET_H);
  });

  it('4 発で倒れる(hit のたびに HP が減り flashT が立つ)', () => {
    const t = new Turret(0, 0);
    expect(t.hit(1)).toBe(false);
    expect(t.flashT).toBeGreaterThan(0);
    expect(t.hit(1)).toBe(false);
    expect(t.hit(1)).toBe(false);
    expect(t.hit(1)).toBe(true);
    expect(t.dead).toBe(true);
  });

  it('初回発射遅延 0.8 秒までは撃たず、それを過ぎると撃つ', () => {
    const t = new Turret(0, 0); // 中心 (0.6, 0.6)
    let shots = 0;
    // 0.7 秒ぶんは無発射
    for (let i = 0; i < 42; i++) shots += t.update(1 / 60, noTiles, 5.45, 0.45).length;
    expect(shots).toBe(0);
    // 遅延を過ぎると発射する(1 秒以内に 1 発)
    for (let i = 0; i < 60 && shots === 0; i++) shots += t.update(1 / 60, noTiles, 5.45, 0.45).length;
    expect(shots).toBe(1);
  });

  it('連射間隔 1.6 秒で撃ち続ける', () => {
    const t = new Turret(0, 0);
    let shots = 0;
    // 初回遅延 + 間隔 2 回ぶん + 余裕 = 約 4.2 秒で 3 発
    for (let i = 0; i < Math.round(4.2 * 60); i++) {
      shots += t.update(1 / 60, noTiles, 5.45, 0.45).length;
    }
    expect(shots).toBe(3);
  });

  it('射程外(中心間距離 > 10)は撃たない', () => {
    const t = new Turret(0, 0);
    let shots = 0;
    for (let i = 0; i < 60 * 3; i++) shots += t.update(1 / 60, noTiles, 20, 0.45).length;
    expect(shots).toBe(0);
  });

  it('視線が壁で遮られると撃たない', () => {
    const t = new Turret(0, 0);
    let shots = 0;
    for (let i = 0; i < 60 * 3; i++) shots += t.update(1 / 60, wallTiles, 5.45, 0.45).length;
    // 壁は x=8 列でプレイヤー(5.45)より向こうなので視線は通る → 撃つ
    expect(shots).toBeGreaterThan(0);
    const t2 = new Turret(0, 0);
    let shots2 = 0;
    for (let i = 0; i < 60 * 3; i++) shots2 += t2.update(1 / 60, wallTiles, 9.5, 0.45).length;
    expect(shots2).toBe(0); // 壁の向こうは射程内(距離約 8.9)でも撃たない
  });

  it('狙えていない間はクールダウンが進まない(見えた時点から初回遅延が要る)', () => {
    const t = new Turret(0, 0);
    // 射程外で 3 秒待つ(クールダウンが進んでいれば即発射になってしまう)
    for (let i = 0; i < 60 * 3; i++) t.update(1 / 60, noTiles, 100, 100);
    expect(t.cooldown).toBe(TURRET_FIRST_DELAY);
    // 射程内に入ってからも初回遅延ぶんは撃たない
    let shots = 0;
    for (let i = 0; i < 30; i++) shots += t.update(1 / 60, noTiles, 5.45, 0.45).length;
    expect(shots).toBe(0);
  });

  it('照準角は狙えている間プレイヤー中心へ更新し、見失っても保持する', () => {
    const t = new Turret(0, 0);
    t.update(1 / 60, noTiles, t.centerX, 5.45); // 真下
    expect(t.angle).toBeCloseTo(Math.PI / 2);
    const held = t.angle;
    t.update(1 / 60, noTiles, 100, 100); // 見失う
    expect(t.angle).toBe(held);
  });

  it('発射した弾は砲台中心から照準方向へ出る', () => {
    const t = new Turret(0, 0);
    let shot: TurretShot | undefined;
    for (let i = 0; i < 60 && !shot; i++) {
      const s = t.update(1 / 60, noTiles, 5.45, t.centerY); // 真右
      if (s.length > 0) shot = s[0];
    }
    expect(shot).toBeDefined();
    expect(shot!.centerX).toBeCloseTo(t.centerX);
    expect(shot!.centerY).toBeCloseTo(t.centerY);
    expect(shot!.dx).toBeCloseTo(1);
    expect(shot!.dy).toBeCloseTo(0);
  });
});

describe('Turret のセンサー部位破壊(2.19、設計 2026-11-12-action-overhaul §2)', () => {
  /** 矩形 [0, 1.2]。センサーの帯は上 45%(y < 0.54) */
  const sensorY = 0.1;
  const bodyY = 1.0;

  it('センサー(上端の帯)への被弾 2 回でセンサー破壊。本体 HP 4 は減らない', () => {
    const t = new Turret(0, 0);
    expect(TURRET_SENSOR_HP).toBe(2);
    expect(t.hitAt(1, sensorY)).toEqual({ killed: false, part: true, broke: false });
    expect(t.sensorBroken).toBe(false);
    expect(t.hitAt(1, sensorY)).toEqual({ killed: false, part: true, broke: true });
    expect(t.sensorBroken).toBe(true);
    expect(t.hp).toBe(TURRET_HP);
  });

  it('帯の外(台座側)への被弾は本体に入る', () => {
    const t = new Turret(0, 0);
    expect(t.hitAt(1, bodyY)).toEqual({ killed: false, part: false, broke: false });
    expect(t.hp).toBe(TURRET_HP - 1);
    expect(t.sensorHp).toBe(TURRET_SENSOR_HP);
  });

  it('センサー破壊後は射程内・視線ありでも照準せず撃たない(盲目化)', () => {
    const t = new Turret(0, 0);
    t.hitAt(1, sensorY);
    t.hitAt(1, sensorY);
    const angle = t.angle;
    let shots = 0;
    for (let i = 0; i < 60 * 5; i++) {
      shots += t.update(1 / 60, noTiles, 5.45, t.centerY).length;
      expect(t.aiming).toBe(false);
    }
    expect(shots).toBe(0);
    expect(t.angle).toBe(angle);
  });

  it('照準中に壊しても次の update から撃たない(クールダウンが尽きかけていても)', () => {
    const t = new Turret(0, 0);
    // 初回遅延の直前まで狙わせる
    for (let i = 0; i < 45; i++) t.update(1 / 60, noTiles, 5.45, t.centerY);
    expect(t.aiming).toBe(true);
    t.hitAt(1, sensorY);
    t.hitAt(1, sensorY);
    expect(t.aiming).toBe(false);
    let shots = 0;
    for (let i = 0; i < 60 * 3; i++) shots += t.update(1 / 60, noTiles, 5.45, t.centerY).length;
    expect(shots).toBe(0);
  });

  it('センサー破壊後は上端への被弾も本体へ入り、4 発で倒れる', () => {
    const t = new Turret(0, 0);
    t.hitAt(1, sensorY);
    t.hitAt(1, sensorY);
    for (let i = 0; i < TURRET_HP - 1; i++) expect(t.hitAt(1, sensorY).killed).toBe(false);
    expect(t.hitAt(1, sensorY).killed).toBe(true);
  });
});

describe('TurretShot(砲台の弾)', () => {
  it('重力なしで直進する(弾速 12)', () => {
    const s = new TurretShot(0, 0, 0); // 真右
    for (let i = 0; i < 30; i++) s.update(1 / 60, noTiles);
    expect(s.centerX).toBeCloseTo(6, 5); // 0.5 秒 × 12
    expect(s.centerY).toBeCloseTo(0);
    expect(s.dead).toBe(false);
  });

  it('斜めでも直進する', () => {
    const s = new TurretShot(0, 0, Math.PI / 4);
    for (let i = 0; i < 30; i++) s.update(1 / 60, noTiles);
    expect(s.centerX).toBeCloseTo(6 * Math.SQRT1_2, 4);
    expect(s.centerY).toBeCloseTo(6 * Math.SQRT1_2, 4);
  });

  it('地形(固体)に触れると消える', () => {
    const s = new TurretShot(0, 0.5, 0);
    for (let i = 0; i < 60 && !s.dead; i++) s.update(1 / 60, wallTiles);
    expect(s.dead).toBe(true);
    expect(s.centerX).toBeLessThan(8.2); // 壁(x=8)を大きくは越えない
  });

  it('寿命(約 1.1 秒)で消える', () => {
    const s = new TurretShot(0, 0, 0);
    for (let i = 0; i < 60; i++) s.update(1 / 60, noTiles);
    expect(s.dead).toBe(false); // 1.0 秒ではまだ生きている
    for (let i = 0; i < 30; i++) s.update(1 / 60, noTiles);
    expect(s.dead).toBe(true); // 1.5 秒では寿命切れ
  });
});
