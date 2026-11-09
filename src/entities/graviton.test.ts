import { describe, expect, it, vi } from 'vitest';
import { Graviton } from './graviton';

describe('Graviton(溜めの状態機械。弾数は持たず、発射可否は外から渡す)', () => {
  it('チャージ完了(fireHeld を CHARGE_TIME 保持→離す)で fire が 1 回呼ばれる', () => {
    const g = new Graviton();
    const fire = vi.fn();
    // 長押し
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire); // 1秒 > CHARGE_TIME
    expect(fire).not.toHaveBeenCalled(); // 押している間は撃たない
    g.update(1 / 60, false, true, fire); // 離す
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('チャージ未完で離すと発射しない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.1, true, true, fire); // わずかに押す
    g.update(1 / 60, false, true, fire); // すぐ離す(CHARGE_TIME未満)
    expect(fire).not.toHaveBeenCalled();
  });
  it('長押し継続では連射しない(離すまで1発)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 300; i++) g.update(1 / 60, true, true, fire); // 5秒押しっぱ
    expect(fire).not.toHaveBeenCalled();
  });
  it('残弾なし(canFire=false)では溜めが始まらず、chargeRatio は 0 のまま(溜め演出も出ない)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, false, fire);
    expect(g.chargeRatio).toBe(0);
    g.update(1 / 60, false, false, fire);
    expect(fire).not.toHaveBeenCalled();
  });
  it('満溜め後に残弾が無くなって離しても発射しない(不発)', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire);
    g.update(1 / 60, false, false, fire);
    expect(fire).not.toHaveBeenCalled();
    expect(g.chargeRatio).toBe(0);
  });
  it('発射後に残弾が尽きると次は溜まらず、弾薬が戻れば(canFire=true)また溜まる', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire);
    g.update(1 / 60, false, true, fire); // 1 発(最後の砲弾)
    expect(fire).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, false, fire); // 弾切れで押しても溜まらない
    expect(g.chargeRatio).toBe(0);
    g.update(1 / 60, false, false, fire);
    expect(fire).toHaveBeenCalledTimes(1);
    // 砲弾を拾い直した
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire);
    g.update(1 / 60, false, true, fire);
    expect(fire).toHaveBeenCalledTimes(2);
  });
  it('満溜め後に cancelCharge すると、離しても発射しない', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire); // 満溜め
    g.cancelCharge();
    expect(g.chargeRatio).toBe(0);
    g.update(1 / 60, false, true, fire); // 離す
    expect(fire).not.toHaveBeenCalled();
  });
  it('溜め途中で cancelCharge しても、その後の再押下は通常どおり溜まる', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.2, true, true, fire);
    g.cancelCharge();
    g.update(1 / 60, false, true, fire);
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire);
    g.update(1 / 60, false, true, fire);
    expect(fire).toHaveBeenCalledTimes(1);
  });
  it('チャージ進捗 chargeRatio は 0..1', () => {
    const g = new Graviton();
    const fire = vi.fn();
    g.update(0.3, true, true, fire);
    expect(g.chargeRatio).toBeGreaterThan(0);
    expect(g.chargeRatio).toBeLessThanOrEqual(1);
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, true, fire);
    expect(g.chargeRatio).toBe(1);
  });
  it('時間が経っても弾は増えない(自動回復の廃止): 可否は外部の canFire だけで決まる', () => {
    const g = new Graviton();
    const fire = vi.fn();
    for (let i = 0; i < 60 * 30; i++) g.update(1 / 60, false, false, fire); // 30 秒放置
    for (let i = 0; i < 60; i++) g.update(1 / 60, true, false, fire);
    g.update(1 / 60, false, false, fire);
    expect(fire).not.toHaveBeenCalled();
    expect(g.chargeRatio).toBe(0);
  });
});
