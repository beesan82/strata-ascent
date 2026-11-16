/**
 * 大昇降機の乗車ログ(2.21 §B-3)。同じ大昇降機に連続して乗っていた間の足場の移動量を数え、
 * 長く乗って降りた瞬間に取得ログへ出す 1 行を返す。時刻・乱数・DOM に触れない純粋な状態機械
 * (main が毎フレーム update を呼び、返った文を PickupLog.pushNotice へ渡す)。
 */

/** この距離(タイル)以上を連続して乗ったときだけ、降りた瞬間に 1 行出す */
export const GRAND_RIDE_NOTICE_MIN = 100;

/** 乗っている足場(大昇降機のシャフト ID と足場の上面の Y) */
export interface GrandRide {
  shaftId: string;
  top: number;
}

/** 区間の移動量の合計 → 通知文。GRAND_RIDE_NOTICE_MIN 未満なら null */
export function grandRideNotice(total: number): string | null {
  return total >= GRAND_RIDE_NOTICE_MIN ? `昇降 ${Math.round(total)} タイル` : null;
}

export class GrandRideTracker {
  private shaftId: string | null = null;
  private lastTop = 0;
  private total = 0;

  /**
   * 毎フレーム呼ぶ。riding は乗っている大昇降機(乗っていなければ null)。
   * 同じシャフトに乗り続けている間は足場の移動量 |Δtop| を合計する(上り下りを往復しても足し続ける)。
   * 降りるかシャフトが変わると区間が終わり、合計が GRAND_RIDE_NOTICE_MIN 以上ならその瞬間に一度だけ通知文を返す。
   * それ以外は null。シャフトが変わったステップでは、前の区間を閉じてから新しい区間を始める
   */
  update(riding: GrandRide | null): string | null {
    if (this.shaftId !== null && riding !== null && riding.shaftId === this.shaftId) {
      this.total += Math.abs(riding.top - this.lastTop);
      this.lastTop = riding.top;
      return null;
    }
    const notice = this.shaftId !== null ? grandRideNotice(this.total) : null;
    this.shaftId = riding ? riding.shaftId : null;
    this.lastTop = riding ? riding.top : 0;
    this.total = 0;
    return notice;
  }
}
