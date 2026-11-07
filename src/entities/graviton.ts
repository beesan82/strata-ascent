export const MAX_CHARGES = 3;
/** 掘削ビームの長さ(タイル)。敵判定(beamHit)も同じ幾何を使うため main と共有する */
export const BORE_LENGTH = 300;
/** 掘削ビームの半径(タイル) */
export const BORE_RADIUS = 3;
const CHARGE_TIME = 0.6;   // 秒: 発射に必要な溜め
const RECHARGE_TIME = 6;   // 秒: 弾1発の自動回復

/** 重力子砲の状態機械。チャージ/弾数/自動回復を管理(描画・破壊には非依存) */
export class Graviton {
  charges = MAX_CHARGES;
  private chargeT = 0;      // 現在の溜め秒
  private charging = false;
  private rechargeT = 0;

  get chargeRatio(): number {
    return Math.min(1, this.chargeT / CHARGE_TIME);
  }

  /** 溜めを破棄する(タッチ照準のキャンセル用)。この後の解放では発射しない */
  cancelCharge(): void {
    this.charging = false;
    this.chargeT = 0;
  }

  /**
   * held: 発射キーが押されているか。fire: チャージ完了→離した瞬間に呼ぶコールバック。
   * 弾数プールを消費し、時間で自動回復する。
   */
  update(dt: number, held: boolean, fire: () => void): void {
    // 自動回復(満タンでなければ)
    if (this.charges < MAX_CHARGES) {
      this.rechargeT += dt;
      if (this.rechargeT >= RECHARGE_TIME) {
        this.rechargeT -= RECHARGE_TIME;
        this.charges++;
      }
    } else {
      this.rechargeT = 0;
    }

    if (held && this.charges > 0) {
      this.charging = true;
      this.chargeT += dt;
    } else {
      // 離した / 弾切れ
      if (this.charging && this.chargeT >= CHARGE_TIME && this.charges > 0) {
        this.charges--;
        fire();
      }
      this.charging = false;
      this.chargeT = 0;
    }
  }
}
