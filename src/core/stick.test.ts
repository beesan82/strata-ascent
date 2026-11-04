import { describe, expect, it } from 'vitest';
import {
  aimKeeper,
  lookahead,
  pulseTrigger,
  stickKeys,
  stickVector,
} from './stick';

describe('stickVector(スティックの倒し量 → 方向と大きさ)', () => {
  it('無入力とデッドゾーン内はゼロを返す', () => {
    expect(stickVector(0, 0, 56)).toEqual({ x: 0, y: 0, mag: 0 });
    // ストローク比 10/56 ≈ 0.18 はデッドゾーン(0.25)内
    expect(stickVector(10, 0, 56)).toEqual({ x: 0, y: 0, mag: 0 });
    // ちょうど 0.25 は「超えた」とはみなさない
    expect(stickVector(14, 0, 56)).toEqual({ x: 0, y: 0, mag: 0 });
  });

  it('直線方向は単位ベクトル × ストローク比(実効ベクトル)を返す', () => {
    const v = stickVector(28, 0, 56);
    expect(v.mag).toBeCloseTo(0.5);
    expect(v.x).toBeCloseTo(0.5);
    expect(v.y).toBeCloseTo(0);
    const up = stickVector(0, -42, 56);
    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(-0.75);
    expect(up.mag).toBeCloseTo(0.75);
  });

  it('斜めは正規化され、最大ストロークを超えたら大きさ 1 に丸める', () => {
    const d = stickVector(56, 56, 56); // 比 √2 → 1 に丸める
    expect(d.mag).toBeCloseTo(1);
    expect(d.x).toBeCloseTo(Math.SQRT1_2);
    expect(d.y).toBeCloseTo(Math.SQRT1_2);
    const over = stickVector(200, 0, 56);
    expect(over).toEqual({ x: 1, y: 0, mag: 1 });
  });
});

describe('stickKeys(スティック → 移動キー相当)', () => {
  it('横は 0.35、縦は 0.5 の閾値(境界ちょうどは含まない)', () => {
    expect(stickKeys({ x: 0.35, y: 0 }).right).toBe(false);
    expect(stickKeys({ x: 0.36, y: 0 }).right).toBe(true);
    expect(stickKeys({ x: -0.36, y: 0 }).left).toBe(true);
    expect(stickKeys({ x: 0, y: -0.5 }).up).toBe(false);
    expect(stickKeys({ x: 0, y: -0.51 }).up).toBe(true);
    expect(stickKeys({ x: 0, y: 0.51 }).down).toBe(true);
  });

  it('縦の閾値が高いので、浅い斜めでは横だけが入る(梯子の誤入力防止)', () => {
    const k = stickKeys({ x: 0.6, y: -0.4 });
    expect(k.right).toBe(true);
    expect(k.up).toBe(false);
  });

  it('ゼロは全て false、深い斜めは横と縦が両方入る', () => {
    expect(stickKeys({ x: 0, y: 0 })).toEqual({ left: false, right: false, up: false, down: false });
    expect(stickKeys({ x: 0.5, y: -0.6 })).toEqual({ left: false, right: true, up: true, down: false });
  });
});

describe('pulseTrigger(倒し量 → 照準有効 / 発射)', () => {
  it('0.25 を超えたら照準のみ、0.55 を超えたら発射も', () => {
    expect(pulseTrigger(0)).toEqual({ aim: false, fire: false });
    expect(pulseTrigger(0.25)).toEqual({ aim: false, fire: false });
    expect(pulseTrigger(0.26)).toEqual({ aim: true, fire: false });
    expect(pulseTrigger(0.55)).toEqual({ aim: true, fire: false });
    expect(pulseTrigger(0.56)).toEqual({ aim: true, fire: true });
    expect(pulseTrigger(1)).toEqual({ aim: true, fire: true });
  });
});

describe('aimKeeper(照準の保持)', () => {
  it('スティックが有効ならその方向に更新する', () => {
    expect(aimKeeper(null, { x: 1, y: 0 })).toEqual({ x: 1, y: 0 });
    expect(aimKeeper({ x: 1, y: 0 }, { x: 0, y: -1 })).toEqual({ x: 0, y: -1 });
  });

  it('スティックを離しても保持し、移動だけではリセットされない(null が続いても保持)', () => {
    const a = aimKeeper(null, { x: 0.6, y: -0.8 });
    expect(aimKeeper(a, null)).toEqual({ x: 0.6, y: -0.8 });
    expect(aimKeeper(aimKeeper(a, null), null)).toEqual({ x: 0.6, y: -0.8 });
  });

  it('何も狙ったことがなければ null のまま', () => {
    expect(aimKeeper(null, null)).toBeNull();
  });
});

describe('lookahead(カメラ先行量)', () => {
  it('照準が無ければ先行しない', () => {
    expect(lookahead(null, false)).toEqual({ x: 0, y: 0 });
    expect(lookahead(null, true)).toEqual({ x: 0, y: 0 });
    expect(lookahead({ x: 0, y: 0 }, false)).toEqual({ x: 0, y: 0 });
  });

  it('照準のみで 2.5 タイル、発射中・溜め中は 5 タイルまで伸びる', () => {
    expect(lookahead({ x: 1, y: 0 }, false)).toEqual({ x: 2.5, y: 0 });
    expect(lookahead({ x: 1, y: 0 }, true)).toEqual({ x: 5, y: 0 });
    const d = lookahead({ x: 0.6, y: 0.8 }, false);
    expect(d.x).toBeCloseTo(1.5);
    expect(d.y).toBeCloseTo(2.0);
  });

  it('単位ベクトルでなくても方向だけを使う(上限は先行量で固定)', () => {
    const d = lookahead({ x: 3, y: 4 }, true);
    expect(d.x).toBeCloseTo(3.0);
    expect(d.y).toBeCloseTo(4.0);
  });
});
