import { describe, expect, it } from 'vitest';
import { beamHit } from './beamHit';
import { BORE_LENGTH, BORE_RADIUS } from './graviton';

// 小型の敵(0.9×0.9。2.19 の大型化前の歩行敵)の半対角と、ボス(2.6×2.0)の半対角。
// beamHit は半対角を受けるだけの純関数なので、ここでは検査用の基準寸法として固定する
const WALKER_HALF = Math.hypot(0.9, 0.9) / 2;
const BOSS_HALF = Math.hypot(2.6, 2.0) / 2;

describe('beamHit(重粒子砲と敵の相互作用 §3)', () => {
  it('正面の敵に当たる', () => {
    expect(beamHit(0, 0, 0, 10, 0, WALKER_HALF)).toBe(true);
    expect(beamHit(0, 0, 0, 100, 0, WALKER_HALF)).toBe(true);
  });

  it('背後の敵には当たらない', () => {
    expect(beamHit(0, 0, 0, -5, 0, WALKER_HALF)).toBe(false);
  });

  it('軸からの距離が BORE_RADIUS + 半対角を超えると当たらない', () => {
    const just = BORE_RADIUS + WALKER_HALF - 0.01;
    const over = BORE_RADIUS + WALKER_HALF + 0.01;
    expect(beamHit(0, 0, 0, 10, just, WALKER_HALF)).toBe(true);
    expect(beamHit(0, 0, 0, 10, over, WALKER_HALF)).toBe(false);
  });

  it('射程の先端は丸く判定する(端点からの距離)', () => {
    // 端点より先でも、端点から BORE_RADIUS + 半対角以内なら当たる
    expect(beamHit(0, 0, 0, BORE_LENGTH + BORE_RADIUS + WALKER_HALF - 0.01, 0, WALKER_HALF)).toBe(true);
    expect(beamHit(0, 0, 0, BORE_LENGTH + BORE_RADIUS + WALKER_HALF + 0.01, 0, WALKER_HALF)).toBe(false);
  });

  it('上向き(-90°)と下向き(90°)でも判定できる', () => {
    expect(beamHit(0, 0, -Math.PI / 2, 0, -10, WALKER_HALF)).toBe(true);
    expect(beamHit(0, 0, -Math.PI / 2, 0, 10, WALKER_HALF)).toBe(false);
    expect(beamHit(0, 0, Math.PI / 2, 0, 10, WALKER_HALF)).toBe(true);
  });

  it('斜めの軸上にある敵に当たり、軸から外れた敵には当たらない', () => {
    const a = Math.PI / 4;
    const on = { x: Math.cos(a) * 20, y: Math.sin(a) * 20 };
    expect(beamHit(0, 0, a, on.x, on.y, WALKER_HALF)).toBe(true);
    expect(beamHit(0, 0, a, on.x + 10, on.y, WALKER_HALF)).toBe(false);
  });

  it('ボスの半対角では、通常敵なら外れる距離でも当たる', () => {
    const offset = BORE_RADIUS + WALKER_HALF + 0.5; // 歩行敵の半対角では外れる
    expect(beamHit(0, 0, 0, 10, offset, WALKER_HALF)).toBe(false);
    expect(beamHit(0, 0, 0, 10, offset, BOSS_HALF)).toBe(true);
  });

  it('発射点の間近にある敵にも当たる', () => {
    expect(beamHit(0, 0, 0, 0.5, 0, WALKER_HALF)).toBe(true);
  });
});
