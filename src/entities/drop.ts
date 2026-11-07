import { moveBody, type Body, type TileLookup } from './physics';
import type { DropKind } from '../world/drop';

export type { DropKind };

/**
 * ドロップ実体(アクション化 第2弾・§3)。敵の撃破位置から重力で落ち、床に静止する。
 * 吸着(マグネット)は入れない。
 *
 * 寿命は 2 種(サバイバル設計 §5):
 * - 通常ドロップ(敵から落ちた砲弾・回復): 寿命 60 秒、同時上限 16 個。
 * - 補給品(permanent): 糧食(発生源によらず)とキャッシュ・休憩点備蓄から出た物資。
 *   セッション中は消えない。補給品全体の上限 32 個、うち糧食は 16 個までで、
 *   糧食が溢れた場合だけ最も古い糧食が点滅して消える。
 */
export const DROP_SIZE = 0.5; // タイル(一辺)
export const DROP_LIFETIME = 60; // 秒(通常ドロップ)
export const DROP_BLINK_TIME = 5; // 寿命の残りこの秒数から点滅する
export const MAX_DROPS = 16; // 通常ドロップの同時存在の上限(古いものから消す)
export const MAX_SUPPLIES = 32; // 補給品全体の同時存在の上限
export const MAX_GROUND_RATIONS = 16; // 地面の糧食の上限(溢れたら古いものが点滅して消える)
const GRAVITY = 30;
const MAX_FALL = 25;

export class DropItem {
  body: Body;
  /** 出現からの経過秒 */
  age = 0;
  /** この個体の寿命(秒)。補給品は Infinity で、糧食の溢れ処理で有限に落とされることがある */
  lifetime: number;

  constructor(
    readonly kind: DropKind,
    centerX: number,
    centerY: number,
    /** 補給品として出す(セッション中は消えない) */
    readonly permanent = false,
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
    this.lifetime = permanent ? Infinity : DROP_LIFETIME;
  }

  get centerX(): number {
    return this.body.x + this.body.w / 2;
  }

  get centerY(): number {
    return this.body.y + this.body.h / 2;
  }

  get expired(): boolean {
    return this.age >= this.lifetime;
  }

  /** 寿命の残り DROP_BLINK_TIME 秒を切ったら点滅状態(描画側が明滅させる)。補給品は通常点滅しない */
  get blinking(): boolean {
    return Number.isFinite(this.lifetime) && this.lifetime - this.age <= DROP_BLINK_TIME;
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

/** 通常ドロップを追加し、通常ドロップ同士の上限を超えた分は古いものから落とす(補給品は数えない) */
export function pushDrop(drops: DropItem[], item: DropItem): void {
  drops.push(item);
  let transient = drops.filter((d) => !d.permanent).length;
  for (let i = 0; transient > MAX_DROPS && i < drops.length; i++) {
    if (!drops[i].permanent) {
      drops.splice(i, 1);
      transient--;
      i--;
    }
  }
}

/**
 * 補給品を追加する。糧食が地面上限を超えたら、最も古い糧食から順に
 * 「残り DROP_BLINK_TIME 秒で消える」状態へ落とす(点滅して消える)。
 */
export function pushSupply(drops: DropItem[], item: DropItem): void {
  drops.push(item);
  if (item.kind !== 'ration') return;
  const rations = drops.filter((d) => d.kind === 'ration');
  let excess = rations.length - MAX_GROUND_RATIONS;
  for (const r of rations) {
    if (excess <= 0) break;
    if (!Number.isFinite(r.lifetime)) {
      r.lifetime = r.age + DROP_BLINK_TIME;
      excess--;
    }
  }
}

/** 補給品の数(キャッシュ・備蓄を開けられるかの判定に使う) */
export function supplyCount(drops: readonly DropItem[]): number {
  return drops.reduce((n, d) => n + (d.permanent ? 1 : 0), 0);
}

/** n 個の補給品を新たに出せるか(補給品全体の上限 32) */
export function canAddSupply(drops: readonly DropItem[], n: number): boolean {
  return supplyCount(drops) + n <= MAX_SUPPLIES;
}

/**
 * そのドロップを今拾えるか。満タン(砲弾が上限 / HP が全快 / 糧食が所持上限)のときは
 * 拾えず、ドロップはその場に残る(設計 §3・サバイバル設計 §5)。
 */
export function canPickup(
  kind: DropKind,
  charges: number,
  maxCharges: number,
  hp: number,
  maxHp: number,
  rations: number,
  maxRations: number,
): boolean {
  if (kind === 'charge') return charges < maxCharges;
  if (kind === 'heal') return hp < maxHp;
  return rations < maxRations;
}
