/**
 * 武器モードの純粋関数群(設計書 2026-11-05-weapon-switch)。
 * 「現在の武器」(パルス / 重粒子砲)の状態遷移だけをここに集約し Vitest で固定する。
 * DOM・Input の実物には触れない。DOM への反映と Graviton への接続は呼び出し側の責務。
 */

export type WeaponMode = 'pulse' | 'cannon';

export interface WeaponState {
  mode: WeaponMode;
  /**
   * 切り替え直後のニュートラル要求(設計 §3-2)。スティックが倒れたまま切り替わったとき、
   * そのセッション(指を離すかデッドゾーン以下へ戻すまで)は発射も溜め開始も受け付けない。
   * 時間ベースのロックではなく状態ベースにするのが要点。
   */
  needsNeutral: boolean;
}

export const INITIAL_WEAPON_STATE: WeaponState = { mode: 'pulse', needsNeutral: false };

export type WeaponEvent =
  /** 切り替え。stickEngaged = 切り替え時点で右スティックがデッドゾーンを超えて倒れていたか */
  | { type: 'toggle'; stickEngaged: boolean }
  /** 重粒子砲の発射が成立した(設計 §3-3: 発射後の自動復帰) */
  | { type: 'fired' }
  /** 溜めのキャンセル・不発(設計 §3-3: モードは維持する) */
  | { type: 'cancelled' }
  /** スティックがニュートラルへ戻った(指を離した / デッドゾーン以下へ戻した) */
  | { type: 'neutral' };

export function weaponReducer(state: WeaponState, event: WeaponEvent): WeaponState {
  switch (event.type) {
    case 'toggle':
      return { mode: state.mode === 'pulse' ? 'cannon' : 'pulse', needsNeutral: event.stickEngaged };
    case 'fired':
      // 砲を 1 発撃ったらパルスへ戻す。パルス側での発射では何も変わらない
      return state.mode === 'cannon' ? { mode: 'pulse', needsNeutral: state.needsNeutral } : state;
    case 'cancelled':
      // キャンセル・不発ではモードを維持する(再試行の意図が明確なため)
      return state;
    case 'neutral':
      return state.needsNeutral ? { mode: state.mode, needsNeutral: false } : state;
  }
}
