import { describe, expect, it } from 'vitest';
import { INITIAL_WEAPON_STATE, weaponReducer, type WeaponState } from './weapon';

const CANNON: WeaponState = { mode: 'cannon', needsNeutral: false };

describe('weaponReducer(武器モードの状態遷移)', () => {
  it('初期状態はパルスでニュートラル要求なし', () => {
    expect(INITIAL_WEAPON_STATE).toEqual({ mode: 'pulse', needsNeutral: false });
  });

  it('toggle でモードが反転する(パルス→砲→パルス)', () => {
    const s1 = weaponReducer(INITIAL_WEAPON_STATE, { type: 'toggle', stickEngaged: false });
    expect(s1.mode).toBe('cannon');
    const s2 = weaponReducer(s1, { type: 'toggle', stickEngaged: false });
    expect(s2.mode).toBe('pulse');
  });

  it('切り替え時点でスティックが倒れていたら needsNeutral が立つ', () => {
    const s = weaponReducer(INITIAL_WEAPON_STATE, { type: 'toggle', stickEngaged: true });
    expect(s).toEqual({ mode: 'cannon', needsNeutral: true });
    // 倒れていなければ立たない
    const s2 = weaponReducer(INITIAL_WEAPON_STATE, { type: 'toggle', stickEngaged: false });
    expect(s2.needsNeutral).toBe(false);
  });

  it('neutral でニュートラル要求が下りる(モードは不変)', () => {
    const engaged: WeaponState = { mode: 'cannon', needsNeutral: true };
    expect(weaponReducer(engaged, { type: 'neutral' })).toEqual({ mode: 'cannon', needsNeutral: false });
    // 要求が無いときは何も変わらない
    expect(weaponReducer(CANNON, { type: 'neutral' })).toEqual(CANNON);
  });

  it('fired(砲の発射成立)でパルスへ自動復帰する', () => {
    expect(weaponReducer(CANNON, { type: 'fired' }).mode).toBe('pulse');
  });

  it('fired がパルス側で来ても何も変わらない', () => {
    expect(weaponReducer(INITIAL_WEAPON_STATE, { type: 'fired' })).toEqual(INITIAL_WEAPON_STATE);
  });

  it('cancelled ではモードを維持する', () => {
    expect(weaponReducer(CANNON, { type: 'cancelled' })).toEqual(CANNON);
    expect(weaponReducer(INITIAL_WEAPON_STATE, { type: 'cancelled' })).toEqual(INITIAL_WEAPON_STATE);
  });

  it('元の状態を変更しない(純粋関数)', () => {
    const before: WeaponState = { mode: 'pulse', needsNeutral: false };
    weaponReducer(before, { type: 'toggle', stickEngaged: true });
    expect(before).toEqual({ mode: 'pulse', needsNeutral: false });
  });
});
