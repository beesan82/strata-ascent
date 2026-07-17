/** プレイヤーを滑らかに追うカメラ。(x, y)は画面中心のワールド座標(タイル単位) */
export class Camera {
  /** 表示倍率。1=標準(横44タイル)、小さいほどズームアウト(開放空間で豆粒化) */
  zoom = 1;

  constructor(
    public x: number,
    public y: number,
  ) {}

  follow(targetX: number, targetY: number, dt: number): void {
    const k = 1 - Math.exp(-8 * dt);
    this.x += (targetX - this.x) * k;
    this.y += (targetY - this.y) * k;
  }

  /**
   * 目標ズームへ指数平滑で近づく。位置追従(係数8)よりゆるやか(係数4)にし、
   * 空間の開閉に対してズームが穏やかに追従して酔いを防ぐ。
   */
  zoomTo(target: number, dt: number): void {
    const k = 1 - Math.exp(-4 * dt);
    this.zoom += (target - this.zoom) * k;
  }
}
