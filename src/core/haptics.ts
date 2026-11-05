/**
 * 振動フィードバック(Capacitor アプリ版のみ)。
 * Web では Capacitor が存在しないため、すべての関数は no-op になる。
 * ゲーム本体が Capacitor に静的依存しないよう、動的 import の裏に隠す。
 */

type ImpactStyleName = 'light' | 'medium' | 'heavy';

async function impact(style: ImpactStyleName): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
    await Haptics.impact({ style: map[style] });
  } catch {
    // Web や未対応環境では何もしない
  }
}

/** 敵を倒したとき(弱) */
export function hapticEnemyDown(): void {
  void impact('light');
}

/** 被弾したとき(中) */
export function hapticDamage(): void {
  void impact('medium');
}

/** 重粒子砲を発射したとき(強) */
export function hapticCannonFire(): void {
  void impact('heavy');
}

/** 武器を切り替えたとき(弱。設計 2026-11-05-weapon-switch §2-5) */
export function hapticWeaponSwitch(): void {
  void impact('light');
}

/**
 * アプリ起動時のネイティブ初期化: 横向きロックとステータスバー非表示。
 * Web では no-op。main の起動時に 1 回だけ呼ぶ。
 */
export async function initNativeShell(): Promise<void> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { ScreenOrientation } = await import('@capacitor/screen-orientation');
    await ScreenOrientation.lock({ orientation: 'landscape' });
    const { StatusBar } = await import('@capacitor/status-bar');
    await StatusBar.hide();
  } catch {
    // 未対応環境では何もしない
  }
}
