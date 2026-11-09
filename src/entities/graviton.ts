/** 掘削ビームの長さ(タイル)。敵判定(beamHit)も同じ幾何を使うため main と共有する */
export const BORE_LENGTH = 300;
/** 掘削ビームの半径(タイル) */
export const BORE_RADIUS = 3;
const CHARGE_TIME = 0.6;   // 秒: 発射に必要な溜め

/**
 * 重力子砲の溜めの状態機械(描画・破壊・弾薬には非依存)。
 * 弾数プールと自動回復は廃止した(弾薬設計 2026-11-09-ammo-armory §1)。砲弾は携行の
 * 弾薬アイテムで、発射の可否(残弾があるか)は呼び出し側が canFire で渡す。
 */
export class Graviton {
  private chargeT = 0;      // 現在の溜め秒
  private charging = false;

  get chargeRatio(): number {
    return Math.min(1, this.chargeT / CHARGE_TIME);
  }

  /** 溜めを破棄する(タッチ照準のキャンセル用)。この後の解放では発射しない */
  cancelCharge(): void {
    this.charging = false;
    this.chargeT = 0;
  }

  /**
   * held: 発射キーが押されているか。canFire: 残弾があるか(無ければ溜めを開始せず、
   * 溜め中に無くなれば不発)。fire: チャージ完了→離した瞬間に呼ぶコールバック
   * (弾薬の消費は呼び出し側が fire の中で行う)。
   */
  update(dt: number, held: boolean, canFire: boolean, fire: () => void): void {
    if (held && canFire) {
      this.charging = true;
      this.chargeT += dt;
    } else {
      // 離した / 弾切れ
      if (this.charging && this.chargeT >= CHARGE_TIME && canFire) fire();
      this.charging = false;
      this.chargeT = 0;
    }
  }
}
