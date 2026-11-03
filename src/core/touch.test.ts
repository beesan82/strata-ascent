import { describe, expect, it } from 'vitest';
import { aimStickState, stickKeys } from './touch';

describe('stickKeys(スティック変位 → 方向キー)', () => {
  it('変位なし・デッドゾーン内では何も入らない', () => {
    expect(stickKeys(0, 0)).toEqual({ left: false, right: false, up: false, down: false });
    expect(stickKeys(10, 12)).toEqual({ left: false, right: false, up: false, down: false });
  });

  it('横 14px を超えると左右が入る', () => {
    expect(stickKeys(15, 0).right).toBe(true);
    expect(stickKeys(-15, 0).left).toBe(true);
    expect(stickKeys(14, 0).right).toBe(false);
  });

  it('縦 18px を超えると上下が入る(横より鈍い)', () => {
    expect(stickKeys(0, -19).up).toBe(true);
    expect(stickKeys(0, 19).down).toBe(true);
    expect(stickKeys(0, -18).up).toBe(false);
  });

  it('斜めは両立する', () => {
    expect(stickKeys(30, -30)).toEqual({ left: false, right: true, up: true, down: false });
  });
});

describe('aimStickState(エイムスティック変位 → 照準ベクトル)', () => {
  it('デッドゾーン(18px)内は無効', () => {
    expect(aimStickState(0, 0).active).toBe(false);
    expect(aimStickState(12, 12).active).toBe(false);
  });

  it('倒すと単位ベクトルで返る', () => {
    const s = aimStickState(60, 0);
    expect(s.active).toBe(true);
    expect(s.x).toBeCloseTo(1);
    expect(s.y).toBeCloseTo(0);
    const d = aimStickState(50, -50);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(1);
    expect(d.x).toBeGreaterThan(0);
    expect(d.y).toBeLessThan(0);
  });
});
