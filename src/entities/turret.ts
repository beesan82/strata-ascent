import { isSolid } from '../world/tiles';
import { bodyOverlapsSolid, type Body, type TileLookup } from './physics';
import { inUpperBand, type PartHit } from './parts';

/**
 * 新敵「固定砲台」(v2.0 Task 6)。床の上に据え置きで動かず、射程内に
 * プレイヤーがいて視線が通ると一定間隔で狙撃する。接触ダメージは持たない。
 * 2.19(設計 2026-11-12-action-overhaul): 体格を 1.2 四方へ一回り大きくし、センサー(上端の帯)を部位にした。
 * センサーへの被弾 2 回でセンサー破壊 → 照準も発射もしない(盲目化)。本体 HP は 4 のまま。
 */
export const TURRET_HP = 4;
/** 体格(タイル)。頭上 2 タイルの空きがある床ランに収まる高さ(出現位置は spawn.ts が床 - TURRET_H に置く) */
export const TURRET_W = 1.2;
export const TURRET_H = 1.2;
/** センサーの耐久(本体 HP とは別枠) */
export const TURRET_SENSOR_HP = 2;
/** 射程(タイル、中心間距離) */
export const TURRET_RANGE = 10;
/** 連射間隔(秒) */
export const TURRET_FIRE_INTERVAL = 1.6;
/** 出現後の初回発射遅延(秒) */
export const TURRET_FIRST_DELAY = 0.8;
/** 弾速(タイル/秒) */
export const TURRET_SHOT_SPEED = 12;
/** 弾の一辺(タイル) */
export const TURRET_SHOT_SIZE = 0.3;
/** 弾の寿命(秒): 射程/弾速(約 0.83)+ 余裕で約 1.1 */
export const TURRET_SHOT_LIFE = 1.1;

/** 視線サンプリングの刻み(タイル) */
const LOS_STEP = 0.25;

/**
 * 視線判定(純関数): 線分 (x0, y0) → (x1, y1) を 0.25 刻みで見て、
 * 固体(isSolid)に触れたら遮断とする。梯子は固体ではないので遮らない。
 */
export function hasLineOfSight(
  tiles: TileLookup,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(dist / LOS_STEP));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (isSolid(tiles(Math.floor(x), Math.floor(y)))) return false;
  }
  return true;
}

/**
 * 砲台の弾。重力なしの直進弾で、地形(固体)に触れたら消え、寿命でも消える。
 * 敵やボスには当たらない(判定は main 側でプレイヤーだけを見る)。
 */
export class TurretShot {
  body: Body;
  /** 単位方向 */
  readonly dx: number;
  readonly dy: number;
  age = 0;
  dead = false;

  constructor(centerX: number, centerY: number, angle: number) {
    this.dx = Math.cos(angle);
    this.dy = Math.sin(angle);
    this.body = {
      x: centerX - TURRET_SHOT_SIZE / 2,
      y: centerY - TURRET_SHOT_SIZE / 2,
      w: TURRET_SHOT_SIZE,
      h: TURRET_SHOT_SIZE,
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

  update(dt: number, tiles: TileLookup): void {
    if (this.dead) return;
    this.age += dt;
    // 1 フレームの移動(最大 0.2 タイル)を細かく刻み、固体へのめり込みで消す
    const dist = TURRET_SHOT_SPEED * dt;
    const steps = Math.max(1, Math.ceil(dist / 0.1));
    for (let i = 0; i < steps && !this.dead; i++) {
      this.body.x += (this.dx * dist) / steps;
      this.body.y += (this.dy * dist) / steps;
      if (bodyOverlapsSolid(tiles, this.body.x, this.body.y, this.body.w, this.body.h)) {
        this.dead = true;
      }
    }
    if (this.age >= TURRET_SHOT_LIFE) this.dead = true;
  }
}

export class Turret {
  body: Body;
  hp = TURRET_HP;
  /** センサーの残り耐久。0 でセンサー破壊(発射停止) */
  sensorHp = TURRET_SENSOR_HP;
  /** 被弾直後の残りフラッシュ時間(描画側が色を変える) */
  flashT = 0;
  /** 照準角(ラジアン)。狙えている間だけ更新し、見失っても最後の角度を保持する */
  angle = 0;
  /** 次の発射までの残り秒。狙えている間だけ減る */
  cooldown = TURRET_FIRST_DELAY;
  /** 直近の update で狙えていたか(描画の警告灯が読む。行動には使わない) */
  aiming = false;

  constructor(x: number, y: number) {
    this.body = { x, y, w: TURRET_W, h: TURRET_H, vx: 0, vy: 0, onGround: false };
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

  get sensorBroken(): boolean {
    return this.sensorHp <= 0;
  }

  /** ダメージを与える。他敵と同じ(重粒子砲の即死もここを通す)。倒れたら true */
  hit(damage: number): boolean {
    this.hp -= damage;
    this.flashT = 0.09;
    return this.dead;
  }

  /**
   * 被弾位置 hitY(タイル)つきのダメージ。センサーが健在で上端の帯に当たればセンサーの耐久だけを削る。
   * センサー破壊後と帯の外は本体へ入る
   */
  hitAt(damage: number, hitY: number): PartHit {
    if (!this.sensorBroken && inUpperBand(this.body.y, this.body.h, hitY)) {
      this.sensorHp -= damage;
      this.flashT = 0.09;
      if (this.sensorBroken) this.aiming = false;
      return { killed: false, part: true, broke: this.sensorBroken };
    }
    return { killed: this.hit(damage), part: false, broke: false };
  }

  /**
   * 発射条件: センサーが健在で、プレイヤー中心までの距離が射程内かつ視線が通ること。
   * クールダウンは狙えている間だけ減り、0 になったら発射して間隔に戻す。
   * 返り値はこのフレームに発射した弾(最大 1 発)。
   */
  update(dt: number, tiles: TileLookup, playerX: number, playerY: number): TurretShot[] {
    this.flashT = Math.max(0, this.flashT - dt);
    if (this.sensorBroken) {
      this.aiming = false;
      return [];
    }
    const dx = playerX - this.centerX;
    const dy = playerY - this.centerY;
    const dist = Math.hypot(dx, dy);
    const canAim =
      dist <= TURRET_RANGE &&
      hasLineOfSight(tiles, this.centerX, this.centerY, playerX, playerY);
    this.aiming = canAim;
    if (!canAim) return [];
    this.angle = Math.atan2(dy, dx);
    this.cooldown -= dt;
    if (this.cooldown > 0) return [];
    this.cooldown = TURRET_FIRE_INTERVAL;
    return [new TurretShot(this.centerX, this.centerY, this.angle)];
  }
}
