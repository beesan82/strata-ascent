/** プレイヤーを滑らかに追うカメラ。(x, y)は画面中心のワールド座標(タイル単位) */
export class Camera {
  constructor(
    public x: number,
    public y: number,
  ) {}

  follow(targetX: number, targetY: number, dt: number): void {
    const k = 1 - Math.exp(-8 * dt);
    this.x += (targetX - this.x) * k;
    this.y += (targetY - this.y) * k;
  }
}
