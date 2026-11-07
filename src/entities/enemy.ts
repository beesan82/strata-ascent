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

/**
 * 飛行敵「飛行ドローン」(アクション化 第2弾・§1)。重力を受けない空中巡回機。
 * 攻撃手段は接触のみ。状態は巡回/追尾の 2 つだけ。
 */
export const FLYER_HP = 2;
export const FLYER_W = 0.8;
export const FLYER_H = 0.8;
export const FLYER_PATROL_SPEED = 1.5;
export const FLYER_CHASE_SPEED = 3.2;
export const FLYER_SENSE_R = 7;
export const FLYER_LEAVE_R = 10;
export const FLYER_PATROL_RANGE = 6;
export const FLYER_BOB_AMP = 0.8;
const FLYER_BOB_OMEGA = 1.8;
/** 追尾中にこの秒数進めなければ諦めて巡回へ戻り、その後しばらく追尾しない */
const FLYER_STUCK_LIMIT = 1;
const FLYER_CALM_TIME = 1.5;
/** 進捗チェックポイント: これだけ動けば「進んでいる」とみなし計測をリセットする */
const FLYER_PROGRESS_EPS = 0.5;

export type FlyerMode = 'patrol' | 'chase';

/** 状態遷移(純関数): 感知半径以内で追尾、離脱半径の外で巡回、その間は現状維持 */
export function nextFlyerMode(mode: FlyerMode, dist: number): FlyerMode {
  if (dist <= FLYER_SENSE_R) return 'chase';
  if (dist > FLYER_LEAVE_R) return 'patrol';
  return mode;
}

export class Flyer {
  body: Body;
  hp = FLYER_HP;
  /** 被弾直後の残りフラッシュ時間(描画側が色を変える) */
  flashT = 0;
  mode: FlyerMode = 'patrol';
  readonly anchorX: number;
  readonly anchorY: number;
  readonly phase: number;
  private dir: 1 | -1 = 1;
  private time = 0;
  private checkX: number;
  private checkY: number;
  private stuckT = 0;
  private calmT = 0;

  constructor(anchorX: number, anchorY: number, phase: number) {
    this.anchorX = anchorX;
    this.anchorY = anchorY;
    this.phase = phase;
    this.body = {
      x: anchorX - FLYER_W / 2,
      y: anchorY - FLYER_H / 2,
      w: FLYER_W,
      h: FLYER_H,
      vx: 0,
      vy: 0,
      onGround: false,
    };
    this.checkX = anchorX;
    this.checkY = anchorY;
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

  update(dt: number, tiles: TileLookup, playerX: number, playerY: number): void {
    const b = this.body;
    this.time += dt;
    const dist = Math.hypot(playerX - this.centerX, playerY - this.centerY);
    if (this.calmT > 0) {
      this.calmT -= dt;
      this.mode = 'patrol';
    } else {
      this.mode = nextFlyerMode(this.mode, dist);
    }

    if (this.mode === 'chase') {
      const dx = playerX - this.centerX;
      const dy = playerY - this.centerY;
      const len = Math.hypot(dx, dy) || 1;
      b.vx = (dx / len) * FLYER_CHASE_SPEED;
      b.vy = (dy / len) * FLYER_CHASE_SPEED;
    } else {
      if (this.centerX >= this.anchorX + FLYER_PATROL_RANGE) this.dir = -1;
      else if (this.centerX <= this.anchorX - FLYER_PATROL_RANGE) this.dir = 1;
      b.vx = this.dir * FLYER_PATROL_SPEED;
      const targetY = this.anchorY + Math.sin(this.time * FLYER_BOB_OMEGA + this.phase) * FLYER_BOB_AMP;
      b.vy = Math.max(-2.5, Math.min(2.5, (targetY - this.centerY) * 6));
    }

    const intendedVx = b.vx;
    moveBody(b, dt, tiles);
    // 巡回中に壁へ当たったら往復方向を反転する
    if (this.mode === 'patrol' && intendedVx !== 0 && b.vx === 0) {
      this.dir = (this.dir * -1) as 1 | -1;
    }

    // 固着防止: 追尾中にチェックポイントから進めていない時間を数える
    if (this.mode === 'chase') {
      if (Math.hypot(this.centerX - this.checkX, this.centerY - this.checkY) > FLYER_PROGRESS_EPS) {
        this.checkX = this.centerX;
        this.checkY = this.centerY;
        this.stuckT = 0;
      } else {
        this.stuckT += dt;
        if (this.stuckT >= FLYER_STUCK_LIMIT) {
          this.mode = 'patrol';
          this.calmT = FLYER_CALM_TIME;
          this.stuckT = 0;
          this.checkX = this.centerX;
          this.checkY = this.centerY;
        }
      }
    } else {
      this.checkX = this.centerX;
      this.checkY = this.centerY;
      this.stuckT = 0;
    }
    this.flashT = Math.max(0, this.flashT - dt);
  }
}

/**
 * ボス「広間番人」(アクション化 第2弾・§2)。大広間に 1 体だけ居る大型歩行機。
 * 行動は 巡回 → 接近 → 予備動作 → 突進 → 硬直 の状態機械で、読み合いの柱は
 * 予備動作 0.7 秒のテレグラフと、硬直中の被ダメージ 2 倍。
 * 番人は広間の矩形の外へ出ない(移動をクランプする)。
 */
export const BOSS_HP = 30;
export const BOSS_W = 2.6;
export const BOSS_H = 2.0;
export const BOSS_PATROL_SPEED = 1.2;
export const BOSS_APPROACH_SPEED = 2.6;
/** 接近中にこの秒数が経つと予備動作へ入る(突進の間隔) */
export const BOSS_CHARGE_INTERVAL = 3;
export const BOSS_WINDUP_TIME = 0.7;
export const BOSS_CHARGE_SPEED = 9;
export const BOSS_CHARGE_TIME = 0.45;
export const BOSS_STUN_TIME = 1.2;
/** 硬直中の被ダメージ倍率 */
export const BOSS_STUN_DAMAGE_MUL = 2;
/** 重粒子砲のボスへのダメージ(第2弾 §3。通常敵は即死、ボスだけ固定値) */
export const BOSS_BEAM_DAMAGE = 10;

export type BossPhase = 'patrol' | 'approach' | 'windup' | 'charge' | 'stunned';

export interface BossPhaseContext {
  /** プレイヤーが広間の中にいるか */
  playerInHall: boolean;
  /** 突進が壁(または広間の端)に当たったか */
  hitWall: boolean;
}

/**
 * 状態遷移(純関数)。t は現在の相に入ってからの経過秒。
 * 接近だけがプレイヤーの出入りに反応し、予備動作〜硬直の突進シーケンスは
 * 一度始めたら完了する(読みの柱であるテレグラフを途中で裏切らない)。
 */
export function stepBossPhase(
  phase: BossPhase,
  t: number,
  ctx: BossPhaseContext,
  dt: number,
): { phase: BossPhase; t: number } {
  const nt = t + dt;
  switch (phase) {
    case 'patrol':
      return ctx.playerInHall ? { phase: 'approach', t: 0 } : { phase, t: nt };
    case 'approach':
      if (!ctx.playerInHall) return { phase: 'patrol', t: 0 };
      return nt >= BOSS_CHARGE_INTERVAL ? { phase: 'windup', t: 0 } : { phase, t: nt };
    case 'windup':
      return nt >= BOSS_WINDUP_TIME ? { phase: 'charge', t: 0 } : { phase, t: nt };
    case 'charge':
      if (ctx.hitWall) return { phase: 'stunned', t: 0 };
      return nt >= BOSS_CHARGE_TIME ? { phase: 'stunned', t: 0 } : { phase, t: nt };
    case 'stunned':
      if (nt < BOSS_STUN_TIME) return { phase, t: nt };
      return ctx.playerInHall ? { phase: 'approach', t: 0 } : { phase: 'patrol', t: 0 };
  }
}

export class Boss {
  body: Body;
  hp = BOSS_HP;
  phase: BossPhase = 'patrol';
  /** 現在の相に入ってからの経過秒 */
  phaseT = 0;
  /** 向き(巡回の進行方向。接近でプレイヤー側へ更新され、突進はこの向きに固定される) */
  dir: 1 | -1 = 1;
  /** 被弾直後の残りフラッシュ時間(描画側が色を変える) */
  flashT = 0;
  private readonly hallX0: number;
  private readonly hallX1: number;

  constructor(centerX: number, floorY: number, hallX0: number, hallX1: number) {
    this.hallX0 = hallX0;
    this.hallX1 = hallX1;
    this.body = {
      x: centerX - BOSS_W / 2,
      y: floorY - BOSS_H,
      w: BOSS_W,
      h: BOSS_H,
      vx: 0,
      vy: 0,
      onGround: false,
    };
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

  /** ダメージを与える。硬直中は被ダメージが 2 倍。倒れたら true */
  hit(damage: number): boolean {
    const d = this.phase === 'stunned' ? damage * BOSS_STUN_DAMAGE_MUL : damage;
    this.hp -= d;
    this.flashT = 0.09;
    return this.dead;
  }

  update(dt: number, tiles: TileLookup, playerX: number, playerY: number, playerInHall: boolean): void {
    const b = this.body;
    void playerY; // 番人は歩行機で縦には追随しない(接近は水平のみ)。引数は Flyer と形を揃える
    // 現在の相から速度を決める(予備動作と硬直はその場で止まる)
    if (this.phase === 'patrol') {
      b.vx = this.dir * BOSS_PATROL_SPEED;
    } else if (this.phase === 'approach') {
      const dx = playerX - this.centerX;
      if (Math.abs(dx) > 0.1) this.dir = dx > 0 ? 1 : -1;
      b.vx = this.dir * BOSS_APPROACH_SPEED;
    } else if (this.phase === 'charge') {
      b.vx = this.dir * BOSS_CHARGE_SPEED;
    } else {
      b.vx = 0;
    }
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
    const intendedVx = b.vx;
    moveBody(b, dt, tiles);
    let hitWall = false;
    if (intendedVx !== 0 && b.vx === 0) {
      // 壁に当たった: 突進なら硬直へ、巡回なら反転する
      if (this.phase === 'charge') hitWall = true;
      else if (this.phase === 'patrol') this.dir = (this.dir * -1) as 1 | -1;
    }
    // 広間の矩形の外へ出ない。端で止まった場合も壁当たりと同じ扱いにする
    const minX = this.hallX0;
    const maxX = this.hallX1 - b.w;
    if (b.x < minX) {
      b.x = minX;
      if (this.phase === 'charge') hitWall = true;
      else if (this.phase === 'patrol') this.dir = 1;
    } else if (b.x > maxX) {
      b.x = maxX;
      if (this.phase === 'charge') hitWall = true;
      else if (this.phase === 'patrol') this.dir = -1;
    }
    const next = stepBossPhase(this.phase, this.phaseT, { playerInHall, hitWall }, dt);
    this.phase = next.phase;
    this.phaseT = next.t;
    this.flashT = Math.max(0, this.flashT - dt);
  }
}
