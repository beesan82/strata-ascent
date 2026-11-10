import { FLYER_CHASE_SPEED } from '../entities/enemy';
import { TURRET_FIRE_INTERVAL } from '../entities/turret';

/**
 * 通常敵のポーズ(設計 2026-11-10-enemy-visuals-light-occlusion §2)。
 * 実体の状態と時刻だけから決定的に導く純粋関数を置き、Canvas への描画は enemySprite が行う。
 * 長さ・座標はすべてタイル単位。Math.random() は使わない。
 */

// ---- 歩行敵 ----

/** 1 歩行周期(左右の脚が 1 歩ずつ)で進む距離(タイル) */
export const WALKER_STRIDE = 0.64;
/** 腿と脛の長さ(タイル。等長) */
export const WALKER_THIGH = 0.2;
/** 腰(股関節)から床までの高さ(タイル) */
export const WALKER_HIP_TO_GROUND = 0.33;
/** 足の振り幅(前後の片側、タイル)。接地中の半周期で 2 倍ぶん後ろへ送る = 半歩 */
export const WALKER_SWING = WALKER_STRIDE / 4;
/** 振り出し中の足の持ち上げ(タイル) */
export const WALKER_LIFT = 0.1;
/** 胴の上下動(タイル、1 周期に 2 回) */
export const WALKER_BOB = 0.03;

export interface Joint {
  x: number;
  y: number;
}

/** 腰を原点とする脚 1 本(x は画面右が正。向き dir を掛け済み、y は下が正) */
export interface WalkerLeg {
  knee: Joint;
  foot: Joint;
}

export interface WalkerPose {
  /** 歩行位相(0..1) */
  phase: number;
  /** 胴の沈み(タイル、下が正) */
  bob: number;
  /** [奥の脚, 手前の脚]。2 本は半周期ずらす */
  legs: [WalkerLeg, WalkerLeg];
}

function frac(v: number): number {
  return v - Math.floor(v);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 歩行位相: 進行方向へ進んだ距離 x×dir を歩幅で割った小数部。歩行敵は水平にしか自走しないので
 * 中心の x 座標そのものが移動距離の代わりになる(状態を足さずに決定的に決まる)
 */
export function walkPhase(x: number, dir: 1 | -1): number {
  return frac((x * dir) / WALKER_STRIDE);
}

/**
 * 膝の位置: 腰 (0,0) と足 foot を等長の腿・脛(WALKER_THIGH)で結ぶ。届かないときは中点。
 * 膝は進行方向(dir)側へ曲げる
 */
export function kneeOf(foot: Joint, dir: 1 | -1): Joint {
  const d = Math.hypot(foot.x, foot.y);
  const mx = foot.x / 2;
  const my = foot.y / 2;
  if (d === 0 || d >= WALKER_THIGH * 2) return { x: mx, y: my };
  const h = Math.sqrt(WALKER_THIGH * WALKER_THIGH - (d / 2) * (d / 2));
  // foot に垂直な 2 方向のうち、x が dir 側を向くほう
  let px = foot.y / d;
  let py = -foot.x / d;
  if (px * dir < 0) {
    px = -px;
    py = -py;
  }
  return { x: mx + px * h, y: my + py * h };
}

/** 位相 q(0..1)の足の位置。前半が接地(前→後ろへ送る)、後半が振り出し(持ち上げて前へ) */
function footAt(q: number, dir: 1 | -1): Joint {
  let fwd: number;
  let lift = 0;
  if (q < 0.5) {
    fwd = WALKER_SWING - 4 * WALKER_SWING * q;
  } else {
    fwd = -WALKER_SWING + 4 * WALKER_SWING * (q - 0.5);
    lift = WALKER_LIFT * Math.sin(Math.PI * 2 * (q - 0.5));
  }
  return { x: fwd * dir, y: WALKER_HIP_TO_GROUND - lift };
}

/** 歩行敵のポーズ。x は中心の x 座標、dir は進行方向 */
export function walkerPose(x: number, dir: 1 | -1): WalkerPose {
  const phase = walkPhase(x, dir);
  const legs = [phase, frac(phase + 0.5)].map((q) => {
    const foot = footAt(q, dir);
    return { knee: kneeOf(foot, dir), foot };
  }) as [WalkerLeg, WalkerLeg];
  return {
    phase,
    bob: (WALKER_BOB * (1 - Math.cos(Math.PI * 4 * phase))) / 2,
    legs,
  };
}

// ---- 飛行ドローン ----

/** ローターの回転(ラジアン/秒) */
export const ROTOR_OMEGA = 31;
/** 航行灯の点滅周波数(Hz)と点灯の割合 */
export const NAV_HZ = 1.25;
export const NAV_DUTY = 0.2;
/** これより遅いときはスラスターを焚かない(タイル/秒) */
export const THRUST_MIN_SPEED = 0.2;

export interface FlyerPose {
  /** 2 枚のローターの羽根の見かけの長さ(0..1、回転の投影 |cos|)。2 枚は 90° ずらす */
  rotorA: number;
  rotorB: number;
  /** 航行灯が点灯しているか */
  navOn: boolean;
  /** センサーアイの向き(単位ベクトル)。追尾中はプレイヤーへ、巡回中は進行方向の斜め下 */
  eyeX: number;
  eyeY: number;
  /** スラスターの強さ(0..1)。0 なら描かない */
  thrust: number;
  /** 噴射の向き(単位ベクトル、速度と逆) */
  thrustX: number;
  thrustY: number;
}

/**
 * 飛行ドローンのポーズ。phase は個体ごとの位相(Flyer.phase)で、ローターと航行灯を個体ごとにずらす。
 * vx,vy は現在の速度、chase は追尾中か、toPlayerX/Y は機体中心からプレイヤー中心への差分
 */
export function flyerPose(
  timeSec: number, phase: number, vx: number, vy: number, chase: boolean,
  toPlayerX: number, toPlayerY: number,
): FlyerPose {
  const ra = timeSec * ROTOR_OMEGA + phase;
  const navOn = frac(timeSec * NAV_HZ + phase / (Math.PI * 2)) < NAV_DUTY;
  let eyeX: number;
  let eyeY: number;
  const pl = Math.hypot(toPlayerX, toPlayerY);
  if (chase && pl > 1e-6) {
    eyeX = toPlayerX / pl;
    eyeY = toPlayerY / pl;
  } else if (vx !== 0) {
    eyeX = Math.sign(vx) * Math.SQRT1_2;
    eyeY = Math.SQRT1_2;
  } else {
    eyeX = 0;
    eyeY = 1;
  }
  const speed = Math.hypot(vx, vy);
  let thrust = 0;
  let thrustX = 0;
  let thrustY = 1;
  if (speed >= THRUST_MIN_SPEED) {
    // 噴射の揺らぎは時刻と個体の位相だけで決める(±12%)
    const flicker = 0.88 + 0.12 * Math.sin(timeSec * 37 + phase * 3);
    thrust = clamp01(speed / FLYER_CHASE_SPEED) * flicker;
    thrustX = -vx / speed;
    thrustY = -vy / speed;
  }
  return {
    rotorA: Math.abs(Math.cos(ra)),
    rotorB: Math.abs(Math.sin(ra)),
    navOn,
    eyeX,
    eyeY,
    thrust,
    thrustX,
    thrustY,
  };
}

// ---- 固定砲台 ----

/** 警告灯が強まり始める発射前の時間(秒) */
export const TURRET_WARN_WINDOW = 0.6;
/** 警告が これ以上で点滅をやめて白く灯り続ける(発射直前) */
export const TURRET_WARN_SOLID = 0.8;
/** 発射後に砲身が引っ込んで戻るまでの時間(秒) */
export const TURRET_RECOIL_TIME = 0.15;

export interface TurretPose {
  /** 発射前の警告の強さ(0..1)。狙えていなければ 0 */
  warn: number;
  /** 警告灯の色(パレット実在色) */
  lightColor: string;
  /** 警告灯の周りに暈を描くか(発射直前) */
  halo: boolean;
  /** 砲身の後退(0..1。発射直後に 1 → 0) */
  recoil: number;
}

/**
 * 固定砲台のポーズ。cooldown は次の発射までの残り秒(Turret.cooldown)、aiming は今フレーム狙えているか。
 * 狙えていないときは消灯寄りの錆色で、照準中は金に灯り、発射の TURRET_WARN_WINDOW 秒前から
 * 加速する点滅(金/錆)、最後は白く灯り続ける。点滅は時刻だけから決まる
 */
export function turretPose(cooldown: number, aiming: boolean, timeSec: number): TurretPose {
  if (!aiming) return { warn: 0, lightColor: '#5a3a24', halo: false, recoil: 0 };
  const warn = clamp01(1 - cooldown / TURRET_WARN_WINDOW);
  const recoil = clamp01((cooldown - (TURRET_FIRE_INTERVAL - TURRET_RECOIL_TIME)) / TURRET_RECOIL_TIME);
  if (warn >= TURRET_WARN_SOLID) return { warn, lightColor: '#c7d0ce', halo: true, recoil };
  if (warn <= 0) return { warn, lightColor: '#9a6d32', halo: false, recoil };
  const hz = 4 + 10 * warn;
  const on = frac(timeSec * hz) < 0.5;
  return { warn, lightColor: on ? '#caa64a' : '#5a3a24', halo: false, recoil };
}
