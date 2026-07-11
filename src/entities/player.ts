import { TILE } from '../world/tiles';
import { moveBody, type Body, type TileLookup } from './physics';

export interface PlayerInput {
  left: boolean;
  right: boolean;
  jump: boolean;
  up: boolean;
  down: boolean;
}

const WALK_SPEED = 6; // タイル/秒
const CLIMB_SPEED = 4;
export const JUMP_VELOCITY = -13;
const GRAVITY = 30;
const MAX_FALL = 25;

export class Player {
  body: Body;
  /** 向き(1=右, -1=左)。描画用でゲームプレイには影響しない */
  facing: 1 | -1 = 1;
  /** 歩行アニメーションの位相(接地歩行中のみ進む) */
  walkPhase = 0;

  constructor(x: number, y: number) {
    this.body = { x, y, w: 0.75, h: 1.75, vx: 0, vy: 0, onGround: false };
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  update(input: PlayerInput, dt: number, tiles: TileLookup): void {
    const b = this.body;
    b.vx = (input.right ? WALK_SPEED : 0) - (input.left ? WALK_SPEED : 0);

    if (b.vx > 0) this.facing = 1;
    else if (b.vx < 0) this.facing = -1;
    if (b.vx !== 0 && b.onGround) this.walkPhase += dt * 9;

    if (this.onLadder(tiles)) {
      b.vy = (input.down ? CLIMB_SPEED : 0) - (input.up ? CLIMB_SPEED : 0);
      if (input.jump) b.vy = JUMP_VELOCITY;
    } else {
      b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
      if (input.jump && b.onGround) b.vy = JUMP_VELOCITY;
    }

    moveBody(b, dt, tiles);
  }

  /**
   * 体の中心タイルだけでなく足元タイル(体がSOLID床に埋まる直前の行)も見る。
   * 中心のみだと、床帯の梯子は自bandの床行で終わっているため、体の中心が
   * 床行を越えた瞬間にonLadderがfalseになり、足はまだ床に埋まっていて
   * 上昇できず梯子の頂上で永久に足踏みするバグがあった。
   */
  private onLadder(tiles: TileLookup): boolean {
    const cx = Math.floor(this.centerX);
    if (tiles(cx, Math.floor(this.centerY)) === TILE.LADDER) return true;
    const feetY = Math.floor(this.body.y + this.body.h - 1e-6);
    return tiles(cx, feetY) === TILE.LADDER;
  }
}
