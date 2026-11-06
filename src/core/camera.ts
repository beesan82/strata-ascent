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

  // ズームの追従は core/zoom.ts の advanceZoom(段への滑らかな遷移)が担う。
  // Camera は表示値 zoom を保持するだけ(書き込みは main が advanceZoom の戻り値で行う)。
}
