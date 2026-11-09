import { moveBody, type Body, type TileLookup } from './physics';
import type { DropKind } from '../world/drop';
import type { CarryKind } from '../core/carry';

export type { DropKind };

/**
 * ドロップ実体(アクション化 第2弾・§3)。敵の撃破位置から重力で落ち、床に静止する。
 * 吸着(マグネット)は入れない。
 *
 * 寿命は 2 種(サバイバル設計 §5):
 * - 通常ドロップ(敵から落ちた回復、ボス報酬の砲弾): 寿命 60 秒、同時上限 16 個。
 * - 補給品(permanent): 糧食・素材セル(発生源によらず)とキャッシュ・休憩点備蓄・武器庫から出た物資。
 *   セッション中は消えない。補給品全体の上限 32 個、うち糧食は 16 個・素材は 8 個までで、
 *   その種別が溢れた場合だけ最も古いものが点滅して消える。
 * 素材セル(エクストラクション段階 A)は補給品区分に寄せる。地面の上限は糧食と同じ仕組みで、
 * 糧食 16 + 素材 8 + 上限判定つきのキャッシュ・備蓄で補給品全体が 32 を超えないようにする。
 */
export const DROP_SIZE = 0.5; // タイル(一辺)
export const DROP_LIFETIME = 60; // 秒(通常ドロップ)
export const DROP_BLINK_TIME = 5; // 寿命の残りこの秒数から点滅する
export const MAX_DROPS = 16; // 通常ドロップの同時存在の上限(古いものから消す)
export const MAX_SUPPLIES = 32; // 補給品全体の同時存在の上限
export const MAX_GROUND_RATIONS = 16; // 地面の糧食の上限(溢れたら古いものが点滅して消える)
export const MAX_GROUND_MATERIALS = 8; // 地面の素材セルの上限(溢れたら古いものが点滅して消える)

/** 種別ごとの地面の上限(無い種別は補給品全体の上限だけで抑える) */
const GROUND_LIMIT: Partial<Record<DropKind, number>> = {
  ration: MAX_GROUND_RATIONS,
  material: MAX_GROUND_MATERIALS,
};
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
 * 補給品を追加する。糧食・素材がその種別の地面上限を超えたら、最も古いものから順に
 * 「残り DROP_BLINK_TIME 秒で消える」状態へ落とす(点滅して消える)。
 */
export function pushSupply(drops: DropItem[], item: DropItem): void {
  drops.push(item);
  const limit = GROUND_LIMIT[item.kind];
  if (limit === undefined) return;
  const same = drops.filter((d) => d.kind === item.kind);
  let excess = same.length - limit;
  for (const r of same) {
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
 * 地面の種別 → 携行の種別(弾薬設計 §1)。砲弾セル(charge)は携行の shell、パルス弾セルは
 * pulsecell、素材セルは material。即時消費の回復・糧食は携行しないので null。
 */
export function carryKindFor(kind: DropKind): CarryKind | null {
  switch (kind) {
    case 'charge':
      return 'shell';
    case 'pulsecell':
      return 'pulsecell';
    case 'material':
      return 'material';
    default:
      return null;
  }
}

/** 携行の種別 → 地面に置くときの種別(アイテムボックスで落とすとき)。carryKindFor の逆写像 */
export function dropKindFor(kind: CarryKind): DropKind {
  switch (kind) {
    case 'shell':
      return 'charge';
    case 'pulsecell':
      return 'pulsecell';
    case 'material':
      return 'material';
  }
}

/**
 * そのドロップを今拾えるか。満タン(HP が全快 / 糧食が所持上限 / 携行枠が満杯)のときは
 * 拾えず、ドロップはその場に残る(設計 §3・サバイバル設計 §5・エクストラクション段階 A)。
 * 砲弾セル・パルス弾セル・素材セルは携行へ入るので、まとめて携行枠で判定する(弾薬設計 §1)。
 * carried / maxCarry は携行中の総個数と携行枠。
 */
export function canPickup(
  kind: DropKind,
  hp: number,
  maxHp: number,
  rations: number,
  maxRations: number,
  carried: number,
  maxCarry: number,
): boolean {
  if (kind === 'heal') return hp < maxHp;
  if (kind === 'ration') return rations < maxRations;
  return carried < maxCarry;
}
