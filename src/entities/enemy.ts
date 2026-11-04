import { isSolid } from '../world/tiles';
import { moveBody, type Body, type TileLookup } from './physics';

/**
 * 歩行敵「歩行ドローン」(アクション化 第1弾・第3段、設計書 2026-11-04-action-phase1)。
 * 床を左右巡回し、壁と床の端で反転する。接触ダメージのみ(敵弾は持たない)。梯子は登らない。
 */
export const WALKER_SPEED = 2; // タイル/秒
export const WALKER_HP = 3;
export const WALKER_W = 0.9;
export const WALKER_H = 0.9;
const GRAVITY = 30;
const MAX_FALL = 25;

export class Walker {
  body: Body;
  dir: 1 | -1;
  hp = WALKER_HP;
  /** 被弾直後の残りフラッシュ時間(描画側が色を変える) */
  flashT = 0;

  constructor(x: number, y: number, dir: 1 | -1) {
    this.body = { x, y, w: WALKER_W, h: WALKER_H, vx: 0, vy: 0, onGround: false };
    this.dir = dir;
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  get dead(): boolean {
    return this.hp <= 0;
  }

  /** ダメージを与える。倒れたら true */
  hit(damage: number): boolean {
    this.hp -= damage;
    this.flashT = 0.09;
    return this.dead;
  }

  update(dt: number, tiles: TileLookup): void {
    const b = this.body;
    b.vx = this.dir * WALKER_SPEED;
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
    const intendedVx = b.vx;
    moveBody(b, dt, tiles);
    // 壁に当たると moveBody が vx を 0 にする → 反転
    if (intendedVx !== 0 && b.vx === 0) {
      this.dir = (this.dir * -1) as 1 | -1;
    } else if (b.onGround) {
      // 床端: 進行方向の足元に固体が無ければ反転(梯子タイルは固体ではないので穴と同じ扱い)
      const aheadX = Math.floor(b.x + b.w / 2 + this.dir * (b.w / 2 + 0.15));
      const belowY = Math.floor(b.y + b.h + 0.1);
      if (!isSolid(tiles(aheadX, belowY))) {
        this.dir = (this.dir * -1) as 1 | -1;
      }
    }
    this.flashT = Math.max(0, this.flashT - dt);
  }
}
