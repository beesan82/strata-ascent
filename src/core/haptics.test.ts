import { describe, expect, it } from 'vitest';
import { hapticCannonFire, hapticDamage, hapticEnemyDown, hapticWeaponSwitch, initNativeShell } from './haptics';

describe('haptics(Web 環境では no-op)', () => {
  it('例外なく解決する', async () => {
    await expect(initNativeShell()).resolves.toBeUndefined();
    // 発火系は void だが、内部の非同期処理で例外が漏れないこと
    expect(() => hapticDamage()).not.toThrow();
    expect(() => hapticEnemyDown()).not.toThrow();
    expect(() => hapticCannonFire()).not.toThrow();
    expect(() => hapticWeaponSwitch()).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});
