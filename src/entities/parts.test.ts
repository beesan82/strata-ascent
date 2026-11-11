import { describe, expect, it } from 'vitest';
import { inLowerBand, inUpperBand, PART_BAND, PART_BREAK_LABEL } from './parts';

describe('部位の帯(設計 2026-11-12-action-overhaul §2)', () => {
  it('帯の厚みは矩形の高さの 45%', () => {
    expect(PART_BAND).toBe(0.45);
  });

  it('上端の帯: 上端から 45% 未満が帯、それより下は本体', () => {
    // 矩形 [10, 12](高さ 2)。境界は 10 + 0.9 = 10.9
    expect(inUpperBand(10, 2, 10)).toBe(true);
    expect(inUpperBand(10, 2, 10.89)).toBe(true);
    expect(inUpperBand(10, 2, 10.91)).toBe(false);
    expect(inUpperBand(10, 2, 11)).toBe(false);
    expect(inUpperBand(10, 2, 12)).toBe(false);
  });

  it('下端の帯: 下端から 45% 未満が帯、それより上は本体', () => {
    // 境界は 12 - 0.9 = 11.1
    expect(inLowerBand(10, 2, 12)).toBe(true);
    expect(inLowerBand(10, 2, 11.11)).toBe(true);
    expect(inLowerBand(10, 2, 11.09)).toBe(false);
    expect(inLowerBand(10, 2, 11)).toBe(false);
    expect(inLowerBand(10, 2, 10)).toBe(false);
  });

  it('矩形の外の被弾位置は端へ寄せて判定する(かすった弾の中心が外にあっても近い側の部位に入る)', () => {
    expect(inUpperBand(10, 2, 9.8)).toBe(true);
    expect(inLowerBand(10, 2, 9.8)).toBe(false);
    expect(inLowerBand(10, 2, 12.2)).toBe(true);
    expect(inUpperBand(10, 2, 12.2)).toBe(false);
  });

  it('中央(50%)はどちらの帯にも入らない', () => {
    expect(inUpperBand(10, 2, 11)).toBe(false);
    expect(inLowerBand(10, 2, 11)).toBe(false);
  });

  it('部位破壊の通知文言が 3 種にある', () => {
    expect(PART_BREAK_LABEL.walker).toBe('脚部破壊');
    expect(PART_BREAK_LABEL.flyer).toBe('ローター破壊');
    expect(PART_BREAK_LABEL.turret).toBe('センサー破壊');
  });
});
