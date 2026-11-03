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
// アクション化 第1段(設計書 2026-11-04-action-phase1): 移動の手触り
const ACCEL = 60; // 水平加速(タイル/秒²)。最高速まで 0.1 秒
const DECEL = 90; // 水平減速。離して約 0.07 秒で停止
const JUMP_CUT = 0.45; // 可変ジャンプ: 上昇中に離すと vy をこの倍率に割る
const COYOTE_TIME = 0.1; // 足場を離れてから跳べる猶予(秒)
const JUMP_BUFFER = 0.12; // ジャンプ押下を先行受付する時間(秒)
const FALL_GRAVITY_MULT = 1.5; // 落下時のみ重力を増す(キレ)

function approach(v: number, target: number, delta: number): number {
  return v < target ? Math.min(v + delta, target) : Math.max(v - delta, target);
}

export class Player {
  body: Body;
  /** 向き(1=右, -1=左)。描画用でゲームプレイには影響しない */
  facing: 1 | -1 = 1;
  /** 歩行アニメーションの位相(接地歩行中のみ進む) */
  walkPhase = 0;
  private coyoteT = 0;
  private bufferT = 0;
  private prevJump = false;

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

    // 横移動: 目標速度へ加速/減速で寄せる(空中も同じ)
    const target = (input.right ? WALK_SPEED : 0) - (input.left ? WALK_SPEED : 0);
    b.vx = approach(b.vx, target, (target === 0 ? DECEL : ACCEL) * dt);

    if (b.vx > 0) this.facing = 1;
    else if (b.vx < 0) this.facing = -1;
    if (b.vx !== 0 && b.onGround) this.walkPhase += dt * 9 * (Math.abs(b.vx) / WALK_SPEED);

    // ジャンプの押下エッジでバッファを積み、解放エッジで可変ジャンプの割り込みを行う
    const jumpPressed = input.jump && !this.prevJump;
    const jumpReleased = !input.jump && this.prevJump;
    if (jumpPressed) this.bufferT = JUMP_BUFFER;
    else this.bufferT = Math.max(0, this.bufferT - dt);
    this.prevJump = input.jump;

    if (this.onLadder(tiles)) {
      b.vy = (input.down ? CLIMB_SPEED : 0) - (input.up ? CLIMB_SPEED : 0);
      if (input.jump) b.vy = JUMP_VELOCITY;
      this.coyoteT = 0;
    } else {
      if (b.onGround) this.coyoteT = COYOTE_TIME;
      else this.coyoteT = Math.max(0, this.coyoteT - dt);

      const canJump = b.onGround || this.coyoteT > 0;
      if ((input.jump && b.onGround) || (this.bufferT > 0 && canJump)) {
        b.vy = JUMP_VELOCITY;
        this.bufferT = 0;
        this.coyoteT = 0;
      } else {
        if (jumpReleased && b.vy < 0) b.vy *= JUMP_CUT;
        const g = b.vy > 0 ? GRAVITY * FALL_GRAVITY_MULT : GRAVITY;
        b.vy = Math.min(b.vy + g * dt, MAX_FALL);
      }
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
