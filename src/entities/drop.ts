import { moveBody, type Body, type TileLookup } from './physics';
import type { DropKind } from '../world/drop';

export type { DropKind };

/**
 * ドロップ実体(アクション化 第2弾・§3)。敵の撃破位置から重力で落ち、床に静止する。
 * 吸着(マグネット)は第2弾では入れない。寿命を過ぎたら消える。
 */
export const DROP_SIZE = 0.5; // タイル(一辺)
export const DROP_LIFETIME = 60; // 秒
export const DROP_BLINK_TIME = 5; // 寿命の残りこの秒数から点滅する
export const MAX_DROPS = 16; // 同時存在の上限(古いものから消す)
const GRAVITY = 30;
const MAX_FALL = 25;

export class DropItem {
  body: Body;
  /** 出現からの経過秒 */
  age = 0;

  constructor(
    readonly kind: DropKind,
    centerX: number,
    centerY: number,
  ) {
    this.body = {
      x: centerX - DROP_SIZE / 2,
      y: centerY - DROP_SIZE / 2,
      w: DROP_SIZE,
      h: DROP_SIZE,
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

  get expired(): boolean {
    return this.age >= DROP_LIFETIME;
  }

  /** 寿命の残り DROP_BLINK_TIME 秒を切ったら点滅状態(描画側が明滅させる) */
  get blinking(): boolean {
    return this.age >= DROP_LIFETIME - DROP_BLINK_TIME;
  }

  update(dt: number, tiles: TileLookup): void {
    this.age += dt;
    const b = this.body;
    b.vx = 0;
    // 接地中でも毎フレーム重力を適用する(moveBody の onGround 契約)
    b.vy = Math.min(b.vy + GRAVITY * dt, MAX_FALL);
    moveBody(b, dt, tiles);
  }
}

/** ドロップを追加し、上限を超えた分は古いものから落とす */
export function pushDrop(drops: DropItem[], item: DropItem): void {
  drops.push(item);
  while (drops.length > MAX_DROPS) drops.shift();
}

/**
 * そのドロップを今拾えるか。満タン(砲弾が上限 / HP が全快)のときは拾えず、
 * ドロップはその場に残る(設計 §3)。
 */
export function canPickup(
  kind: DropKind,
  charges: number,
  maxCharges: number,
  hp: number,
  maxHp: number,
): boolean {
  return kind === 'charge' ? charges < maxCharges : hp < maxHp;
}
