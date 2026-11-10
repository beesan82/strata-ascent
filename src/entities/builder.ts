import { isSolid } from '../world/tiles';
import { moveBody, type Body, type TileLookup } from './physics';

/**
 * 建設者(設計 2026-11-10-infrastructure §3)。敵ではない大型機械で、床をゆっくり歩く。
 * 移動は歩行敵(entities/enemy の Walker)の流用: 壁と床の端で反転し、梯子は登らない。
 * HP・被弾・接触ダメージは持たない(main は敵の配列に入れず、パルス・砲の命中判定にも渡さない)。
 */
export const BUILDER_W = 2;
export const BUILDER_H = 2.5;
export const BUILDER_SPEED = 0.8; // タイル/秒
const GRAVITY = 30;
const MAX_FALL = 25;

export class Builder {
  body: Body;
  dir: 1 | -1;

  constructor(x: number, y: number, dir: 1 | -1) {
    this.body = { x, y, w: BUILDER_W, h: BUILDER_H, vx: 0, vy: 0, onGround: false };
    this.dir = dir;
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  update(dt: number, tiles: TileLookup): void {
    const b = this.body;
    b.vx = this.dir * BUILDER_SPEED;
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
    const intendedVx = b.vx;
    moveBody(b, dt, tiles);
    // 壁に当たると moveBody が vx を 0 にする → 反転
    if (intendedVx !== 0 && b.vx === 0) {
      this.dir = (this.dir * -1) as 1 | -1;
    } else if (b.onGround) {
      // 床端: 進行方向の足元に固体が無ければ反転(歩行敵と同じく梯子タイルは穴と同じ扱い)
      const aheadX = Math.floor(b.x + b.w / 2 + this.dir * (b.w / 2 + 0.15));
      const belowY = Math.floor(b.y + b.h + 0.1);
      if (!isSolid(tiles(aheadX, belowY))) {
        this.dir = (this.dir * -1) as 1 | -1;
      }
    }
  }
}
