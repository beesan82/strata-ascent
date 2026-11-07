import { describe, expect, it, vi } from 'vitest';
import { Graviton, RECHARGE_TIME, rechargeTimeFor } from './graviton';

describe('Graviton', () => {
  it('初期弾数は3', () => {
    expect(new Graviton().charges).toBe(3);
  });
  it('チャージ完了(fireHeld を CHARGE_TIME 保持→離す)で fire が1回呼ばれ弾数-1', () => {
    const g = new Graviton();
    const fire = vi.fn();
    // 長押し
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire); // 1秒 > CHARGE_TIME
    expect(fire).not.toHaveBeenCalled(); // 押している間は撃たない
    g.update(1 / 60, false, fire); // 離す
    expect(fire).toHaveBeenCalledTimes(1);
    expect(g.charges).toBe(2);
  });
  it('チャージ未完で離すと発射しない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.1, true, fire); // わずかに押す
    g.update(1 / 60, false, fire); // すぐ離す(CHARGE_TIME未満)
    expect(fire).not.toHaveBeenCalled();
    expect(g.charges).toBe(3);
  });
  it('長押し継続では連射しない(離すまで1発)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 300; i++) g.update(1 / 60, true, fire); // 5秒押しっぱ
    expect(fire).not.toHaveBeenCalled();
  });
  it('弾数0ではチャージ・発射できない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let n = 0; n < 3; n++) { // 3発撃つ
      for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
      g.update(1 / 60, false, fire);
    }
    expect(g.charges).toBe(0);
    fire.mockClear();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire);
    expect(fire).not.toHaveBeenCalled();
  });
  it('時間経過で弾数が自動回復(上限3)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire); // 1発消費 → 2
    expect(g.charges).toBe(2);
    for (let i = 0; i < 60 * 7; i++) g.update(1 / 60, false, fire); // 7秒待つ(RECHARGE=6s)
    expect(g.charges).toBe(3); // 上限で頭打ち
  });
  it('満溜め後に cancelCharge すると、離しても発射せず弾数も減らない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire); // 満溜め
    g.cancelCharge();
    expect(g.chargeRatio).toBe(0);
    g.update(1 / 60, false, fire); // 離す
    expect(fire).not.toHaveBeenCalled();
    expect(g.charges).toBe(3);
  });
  it('溜め途中で cancelCharge しても、その後の再押下は通常どおり溜まる', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.2, true, fire);
    g.cancelCharge();
    g.update(1 / 60, false, fire);
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('チャージ進捗 chargeRatio は 0..1', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.3, true, fire);
    expect(g.chargeRatio).toBeGreaterThan(0);
    expect(g.chargeRatio).toBeLessThanOrEqual(1);
  });
  it('危険域(critical)では自動回復が半分の速さ=回復時間 2 倍(サバイバル段階 2、設計 §4)', () => {
    expect(RECHARGE_TIME).toBe(6);
    expect(rechargeTimeFor(false)).toBe(6);
    expect(rechargeTimeFor(true)).toBe(12);
  });
  it('回復時間 12 秒を指定すると、7 秒では回復せず 12 秒で回復する', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire); // 1発消費 → 2
    expect(g.charges).toBe(2);
    for (let i = 0; i < 14; i++) g.update(0.5, false, fire, rechargeTimeFor(true)); // 7秒(0.5 刻みで正確に数える)
    expect(g.charges).toBe(2); // 通常(6秒)なら回復しているが、半減中はまだ
    for (let i = 0; i < 10; i++) g.update(0.5, false, fire, rechargeTimeFor(true)); // +5秒=12秒
    expect(g.charges).toBe(3);
  });
  it('回復時間が途中で通常→危険域に変わっても、蓄積が負になって暴走しない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, fire);
    g.update(1 / 60, false, fire); // 1発消費 → 2
    for (let i = 0; i < 10; i++) g.update(0.5, false, fire); // 通常で 5 秒蓄積
    for (let i = 0; i < 14; i++) g.update(0.5, false, fire, rechargeTimeFor(true)); // 危険域で +7 秒
    expect(g.charges).toBe(3); // 蓄積 5 秒 + 7 秒で 12 秒の閾値を越えて 1 回だけ回復
    for (let i = 0; i < 60; i++) g.update(0.5, false, fire, rechargeTimeFor(true));
    expect(g.charges).toBe(3); // 上限で頭打ちのまま
  });
});
