import { describe, expect, it } from 'vitest';
import { addCarry, carriedTotal, initialCarry, type CarryState } from './carry';
import {
  canFireCannon,
  canFirePulse,
  fireCannon,
  firePulse,
  INITIAL_PULSE_CELLS,
  initialAmmoCarry,
  PULSE_SHOTS_PER_CELL,
  pulseShotsTotal,
} from './ammo';

/** パルス弾セル cells 個・砲弾 shells 個を携行した状態 */
function carrying(cells: number, shells = 0): CarryState {
  let s = initialCarry();
  for (let i = 0; i < cells; i++) s = addCarry(s, 'pulsecell');
  for (let i = 0; i < shells; i++) s = addCarry(s, 'shell');
  return s;
}

describe('initialAmmoCarry(初期所持)', () => {
  it('パルス弾セル 2 個(40 発)だけで始まり、砲弾はゼロ(設計 §1)', () => {
    expect(INITIAL_PULSE_CELLS).toBe(2);
    expect(PULSE_SHOTS_PER_CELL).toBe(20);
    const s = initialAmmoCarry();
    expect(s.carried.pulsecell).toBe(2);
    expect(s.carried.shell).toBe(0);
    expect(s.carried.material).toBe(0);
    expect(carriedTotal(s)).toBe(2);
    expect(pulseShotsTotal(0, s)).toBe(40);
    expect(canFireCannon(s)).toBe(false);
  });
});

describe('firePulse(パルスの消費と装填)', () => {
  it('装填中があれば 1 発減り、携行は変わらない', () => {
    const c = carrying(1);
    const r = firePulse(5, c);
    expect(r.fired).toBe(true);
    expect(r.reloaded).toBe(false);
    expect(r.loaded).toBe(4);
    expect(r.carry).toBe(c);
  });

  it('装填中が 0 なら携行のセルを 1 個装填して撃つ(装填と同時に 1 発消費 → 19)', () => {
    const c = carrying(2);
    const r = firePulse(0, c);
    expect(r.fired).toBe(true);
    expect(r.reloaded).toBe(true);
    expect(r.loaded).toBe(PULSE_SHOTS_PER_CELL - 1);
    expect(r.carry.carried.pulsecell).toBe(1);
    expect(carriedTotal(r.carry)).toBe(1); // 装填で携行枠が 1 個空く
    expect(c.carried.pulsecell).toBe(2); // 元の state は変えない
  });

  it('装填中も携行セルも無ければ撃てず、state は元のまま', () => {
    const c = initialCarry();
    const r = firePulse(0, c);
    expect(r.fired).toBe(false);
    expect(r.reloaded).toBe(false);
    expect(r.loaded).toBe(0);
    expect(r.carry).toBe(c);
    expect(canFirePulse(0, c)).toBe(false);
  });

  it('初期所持 2 セルを撃ち切ると 40 発で弾切れになる', () => {
    let loaded = 0;
    let carry = initialAmmoCarry();
    let shots = 0;
    let reloads = 0;
    while (canFirePulse(loaded, carry)) {
      const r = firePulse(loaded, carry);
      expect(r.fired).toBe(true);
      if (r.reloaded) reloads++;
      loaded = r.loaded;
      carry = r.carry;
      shots++;
    }
    expect(shots).toBe(40);
    expect(reloads).toBe(2);
    expect(loaded).toBe(0);
    expect(carry.carried.pulsecell).toBe(0);
    expect(firePulse(loaded, carry).fired).toBe(false);
  });

  it('装填は素材を触らず、他の携行は保たれる', () => {
    let c = carrying(1);
    c = addCarry(c, 'material');
    c = addCarry(c, 'shell');
    const r = firePulse(0, c);
    expect(r.carry.carried.material).toBe(1);
    expect(r.carry.carried.shell).toBe(1);
    expect(r.carry.secured).toEqual(c.secured);
  });
});

describe('pulseShotsTotal / canFirePulse(残弾総数)', () => {
  it('残弾総数は装填中 + 携行セル × 20', () => {
    expect(pulseShotsTotal(7, carrying(3))).toBe(67);
    expect(pulseShotsTotal(0, carrying(0))).toBe(0);
    expect(pulseShotsTotal(1, carrying(0))).toBe(1);
  });

  it('装填中だけでも、携行セルだけでも撃てる', () => {
    expect(canFirePulse(1, carrying(0))).toBe(true);
    expect(canFirePulse(0, carrying(1))).toBe(true);
    expect(canFirePulse(0, carrying(0))).toBe(false);
  });
});

describe('fireCannon(砲弾の消費)', () => {
  it('砲弾があれば 1 個減り、無ければ同じ state を返す', () => {
    const c = carrying(0, 2);
    expect(canFireCannon(c)).toBe(true);
    const after = fireCannon(c);
    expect(after.carried.shell).toBe(1);
    expect(c.carried.shell).toBe(2);
    const last = fireCannon(after);
    expect(last.carried.shell).toBe(0);
    expect(canFireCannon(last)).toBe(false);
    expect(fireCannon(last)).toBe(last);
  });

  it('砲弾の消費は他の携行と確保済みに触らない', () => {
    let c = carrying(1, 1);
    c = addCarry(c, 'material');
    const after = fireCannon(c);
    expect(after.carried.pulsecell).toBe(1);
    expect(after.carried.material).toBe(1);
    expect(after.secured).toEqual(c.secured);
  });
});
