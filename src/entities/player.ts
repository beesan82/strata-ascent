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
const JUMP_VELOCITY = -13;
const GRAVITY = 30;
const MAX_FALL = 25;

export class Player {
  body: Body;

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

    if (this.onLadder(tiles)) {
      b.vy = (input.down ? CLIMB_SPEED : 0) - (input.up ? CLIMB_SPEED : 0);
    } else {
      b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
      if (input.jump && b.onGround) b.vy = JUMP_VELOCITY;
    }

    moveBody(b, dt, tiles);
  }

  private onLadder(tiles: TileLookup): boolean {
    return tiles(Math.floor(this.centerX), Math.floor(this.centerY)) === TILE.LADDER;
  }
}
