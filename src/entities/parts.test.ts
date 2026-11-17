import { describe, expect, it } from 'vitest';
import {
  clampToSpan, hitPitchFor, inLowerBand, inUpperBand, PART_BAND, PART_BREAK_BONUS_MATERIAL, PART_BREAK_LABEL,
  PART_EXPOSED_DAMAGE_MUL, PART_HIT_PITCH, PART_SIDE, partBreakBonus, partCenterY, type PartKind,
} from './parts';

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

describe('2.22 の部位破壊の強化(設計 2026-11-17-parts-overhaul)', () => {
  const KINDS: PartKind[] = ['walker', 'flyer', 'turret', 'boss'];

  it('ボスの脚も通知の対象(文言は歩行敵と同じ「脚部破壊」)', () => {
    expect(PART_BREAK_LABEL.boss).toBe('脚部破壊');
    expect(Object.keys(PART_BREAK_LABEL).sort()).toEqual([...KINDS].sort());
  });

  it('露出倍率は 2(定数)', () => {
    expect(PART_EXPOSED_DAMAGE_MUL).toBe(2);
  });

  it('確定ドロップ: 部位が壊れていれば素材 1 個、壊れていなければ空(§3)', () => {
    expect(PART_BREAK_BONUS_MATERIAL).toBe(1);
    expect(partBreakBonus(true)).toEqual(['material']);
    expect(partBreakBonus(false)).toEqual([]);
  });

  it('部位の側: 脚(歩行敵・ボス)は下端、ローターとセンサーは上端', () => {
    expect(PART_SIDE).toEqual({ walker: 'lower', flyer: 'upper', turret: 'upper', boss: 'lower' });
  });

  it('partCenterY は帯の中心で、その高さは帯の判定に入る', () => {
    // 矩形 [10, 12]: 上端の帯は [10, 10.9) → 中心 10.45、下端の帯は (11.1, 12] → 中心 11.55
    expect(partCenterY(10, 2, 'upper')).toBeCloseTo(10.45, 9);
    expect(partCenterY(10, 2, 'lower')).toBeCloseTo(11.55, 9);
    expect(inUpperBand(10, 2, partCenterY(10, 2, 'upper'))).toBe(true);
    expect(inLowerBand(10, 2, partCenterY(10, 2, 'lower'))).toBe(true);
  });

  it('clampToSpan は区間の外の値を端へ寄せ、内側の値は変えない', () => {
    expect(clampToSpan(10, 2, 9.5)).toBe(10);
    expect(clampToSpan(10, 2, 12.5)).toBe(12);
    expect(clampToSpan(10, 2, 11.3)).toBe(11.3);
  });

  it('命中音の音程: 本体は 1、下端の部位は低く、上端の部位は高い', () => {
    for (const k of KINDS) expect(hitPitchFor(k, false)).toBe(1);
    expect(hitPitchFor('walker', true)).toBe(PART_HIT_PITCH.lower);
    expect(hitPitchFor('boss', true)).toBe(PART_HIT_PITCH.lower);
    expect(hitPitchFor('flyer', true)).toBe(PART_HIT_PITCH.upper);
    expect(hitPitchFor('turret', true)).toBe(PART_HIT_PITCH.upper);
    expect(PART_HIT_PITCH.lower).toBeLessThan(1);
    expect(PART_HIT_PITCH.upper).toBeGreaterThan(1);
  });
});
