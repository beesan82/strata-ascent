import { hash2 } from '../world/noise';
import { spawnIdHash } from '../world/drop';

/**
 * 敵撃破エフェクト(設計 2026-11-10 armory-stability-kill-fx §2)の決定論。
 * 撃破の瞬間に「破片バースト(パレット色の小矩形が重力で落ちて縮む)+中心の閃光+広がる輪」を出す。
 * 位置・大きさは撃破キー(実体 ID と撃破時刻のハッシュ)と経過秒だけから閉じた式で決まり、
 * Math.random は使わない。描画は renderer の fx 相乗りの中で平坦色の矩形だけ(新規パスなし、lighter なし)。
 */

export type KillKind = 'walker' | 'flyer' | 'turret' | 'boss';

export interface KillFxSpec {
  /** バースト全体の寿命(秒)。破片はこの間に落ちて縮み、後半で薄れる */
  ttl: number;
  /** 破片の数 */
  count: number;
  /** 破片の色(32 色パレットの実在色。敵の胴・目・暗部の色) */
  colors: readonly string[];
  /** 破片の初速(タイル/秒)の範囲 */
  speedMin: number;
  speedMax: number;
  /** 初速に足す上向きの成分(タイル/秒)。飛び散ってから落ちる弧にする */
  lift: number;
  /** 破片の一辺(タイル)の範囲。経過とともに縮む */
  sizeMin: number;
  sizeMax: number;
  /** 中心の閃光の寿命(秒)と一辺(タイル) */
  flashTtl: number;
  flashSize: number;
  /** 広がる輪の寿命(秒)、半径(タイル)の始点と終点、輪を作る矩形の数、太さ(タイル)、色 */
  ringTtl: number;
  ringR0: number;
  ringR1: number;
  ringSegs: number;
  ringThick: number;
  ringColor: string;
  /** 画面シェイクの最大振幅(内部バッファ px)と寿命(秒)。0 なら揺らさない */
  shakePx: number;
  shakeTtl: number;
}

/**
 * 種別ごとの差: 歩行敵は錆と金(胴と目)、ドローンは鋼と淡色、砲台は鋼・暗い紺と警告灯の金。
 * ボスは破片の数・速さ・大きさ・輪を大きくし、画面シェイクを足す(行動・数値は変えない)。
 */
export const KILL_FX: Record<KillKind, KillFxSpec> = {
  walker: {
    ttl: 0.6, count: 14, colors: ['#9a6d32', '#caa64a', '#5a3a24', '#3d2618'],
    speedMin: 2.5, speedMax: 6, lift: 3, sizeMin: 0.1, sizeMax: 0.2,
    flashTtl: 0.08, flashSize: 0.9,
    ringTtl: 0.25, ringR0: 0.3, ringR1: 1.4, ringSegs: 12, ringThick: 0.1, ringColor: '#caa64a',
    shakePx: 0, shakeTtl: 0,
  },
  flyer: {
    ttl: 0.55, count: 12, colors: ['#51728d', '#c7d0ce', '#16202b', '#9a6d32'],
    speedMin: 3, speedMax: 6.5, lift: 1.5, sizeMin: 0.08, sizeMax: 0.16,
    flashTtl: 0.08, flashSize: 0.8,
    ringTtl: 0.25, ringR0: 0.3, ringR1: 1.3, ringSegs: 12, ringThick: 0.1, ringColor: '#c7d0ce',
    shakePx: 0, shakeTtl: 0,
  },
  turret: {
    ttl: 0.6, count: 16, colors: ['#51728d', '#2b355e', '#16202b', '#caa64a'],
    speedMin: 2, speedMax: 5.5, lift: 4, sizeMin: 0.1, sizeMax: 0.22,
    flashTtl: 0.1, flashSize: 1.0,
    ringTtl: 0.28, ringR0: 0.3, ringR1: 1.5, ringSegs: 14, ringThick: 0.1, ringColor: '#caa64a',
    shakePx: 0, shakeTtl: 0,
  },
  boss: {
    ttl: 1.0, count: 36, colors: ['#5a3a24', '#9a6d32', '#3d2618', '#caa64a', '#c7d0ce'],
    speedMin: 3, speedMax: 10, lift: 5, sizeMin: 0.14, sizeMax: 0.34,
    flashTtl: 0.16, flashSize: 2.2,
    ringTtl: 0.45, ringR0: 0.6, ringR1: 4, ringSegs: 24, ringThick: 0.16, ringColor: '#caa64a',
    shakePx: 3, shakeTtl: 0.4,
  },
};

/** 破片の重力(タイル/秒²)。手応えを出すため掘削の破片(16)より少し重い */
export const KILL_GRAVITY = 18;
/** 閃光の色(パレット実在の淡色。lighter は使わず色で発光を見せる) */
export const KILL_FLASH_COLOR = '#c7d0ce';
/** 同時に生きている撃破エフェクトの上限(古い順に捨てる) */
export const MAX_KILL_BURSTS = 16;

const KILL_SALT = 4401;

/**
 * 撃破キー: 実体のスポーン ID と撃破時刻(60 Hz のフレーム番号)から決まる 31 bit の整数。
 * 同じ敵・同じ時刻なら同じキー。破片の向き・速さ・色の種になる。
 */
export function killKey(spawnId: string, timeSec: number): number {
  const frame = Math.floor(timeSec * 60);
  return Math.floor(hash2(KILL_SALT, spawnIdHash(spawnId), frame) * 0x7fffffff);
}

/** 生きている撃破エフェクト 1 件(ワールド座標の中心、種別、キー、発生からの経過秒) */
export interface KillBurst {
  x: number;
  y: number;
  kind: KillKind;
  key: number;
  age: number;
}

/** 撃破エフェクトを足す(純粋関数)。上限を超えたら古い順に捨てる */
export function addKillBurst<T extends KillBurst>(bursts: readonly T[], b: T, max: number = MAX_KILL_BURSTS): T[] {
  const out = [...bursts, b];
  return out.length > max ? out.slice(out.length - max) : out;
}

/** 撃破エフェクトの更新(純粋関数): 経過秒を dt 進め、寿命を過ぎたものを捨てる */
export function advanceKillBursts<T extends KillBurst>(bursts: readonly T[], dt: number): T[] {
  const out: T[] = [];
  for (const b of bursts) {
    const age = b.age + dt;
    if (age <= KILL_FX[b.kind].ttl) out.push({ ...b, age });
  }
  return out;
}

export interface KillFragment {
  /** 中心からの変位(タイル) */
  dx: number;
  dy: number;
  /** 一辺(タイル) */
  size: number;
  color: string;
  alpha: number;
}

/**
 * 破片の位置・大きさ・色(閉じた式)。向きはほぼ全周(真下の扇だけ空ける)で上向きの持ち上げを足し、
 * 重力で落ちる。大きさは寿命の終わりに 25% まで縮み、寿命の後半 40% で薄れる。寿命の外は空。
 */
export function killFragments(kind: KillKind, key: number, age: number): KillFragment[] {
  const s = KILL_FX[kind];
  if (age < 0 || age > s.ttl) return [];
  const u = age / s.ttl;
  const fade = u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4;
  const shrink = 1 - 0.75 * u;
  const out: KillFragment[] = [];
  for (let i = 0; i < s.count; i++) {
    const hDir = hash2(key, i, 11);
    const hSpeed = hash2(key, i, 23);
    const hSize = hash2(key, i, 37);
    const hColor = hash2(key, i, 41);
    const dir = -Math.PI / 2 + (hDir - 0.5) * Math.PI * 1.8;
    const speed = s.speedMin + (s.speedMax - s.speedMin) * hSpeed;
    const vx = Math.cos(dir) * speed;
    const vy = Math.sin(dir) * speed - s.lift;
    out.push({
      dx: vx * age,
      dy: vy * age + 0.5 * KILL_GRAVITY * age * age,
      size: (s.sizeMin + (s.sizeMax - s.sizeMin) * hSize) * shrink,
      color: s.colors[Math.floor(hColor * s.colors.length) % s.colors.length],
      alpha: fade,
    });
  }
  return out;
}

export interface KillFlash {
  /** 一辺(タイル)。十字の腕はこの 1.8 倍の長さ */
  size: number;
  alpha: number;
}

/** 中心の閃光。寿命の間に一辺が 60% まで縮み、線形に薄れる。寿命の外は null */
export function killFlash(kind: KillKind, age: number): KillFlash | null {
  const s = KILL_FX[kind];
  if (age < 0 || age > s.flashTtl) return null;
  const u = age / s.flashTtl;
  return { size: s.flashSize * (1 - 0.4 * u), alpha: 1 - u };
}

export interface KillRing {
  /** 輪を作る矩形の中心(中心からの変位、タイル) */
  points: { dx: number; dy: number }[];
  radius: number;
  /** 矩形の一辺(タイル) */
  thick: number;
  color: string;
  alpha: number;
}

/**
 * 広がる輪。半径は ease-out で ringR0 → ringR1、細い矩形を等角度に並べた円環で表す
 * (回転の初期位相だけキーで変える)。線形に薄れる。寿命の外は null。
 */
export function killRing(kind: KillKind, key: number, age: number): KillRing | null {
  const s = KILL_FX[kind];
  if (age < 0 || age > s.ringTtl) return null;
  const u = age / s.ringTtl;
  const ease = 1 - (1 - u) * (1 - u);
  const radius = s.ringR0 + (s.ringR1 - s.ringR0) * ease;
  const phase = hash2(key, 0, 61) * ((Math.PI * 2) / s.ringSegs);
  const points: { dx: number; dy: number }[] = [];
  for (let i = 0; i < s.ringSegs; i++) {
    const a = phase + (i * Math.PI * 2) / s.ringSegs;
    points.push({ dx: Math.cos(a) * radius, dy: Math.sin(a) * radius });
  }
  return { points, radius, thick: s.ringThick, color: s.ringColor, alpha: 1 - u };
}

/**
 * 画面シェイクの平行移動(内部バッファ px の整数)。シェイクのある種別(ボス)だけ、寿命の間に
 * 振幅が線形に 0 へ落ちる。向きは 30 Hz で切り替わる決定論ハッシュ(Math.random は使わない)。
 */
export function killShake(kind: KillKind, key: number, age: number): { x: number; y: number } {
  const s = KILL_FX[kind];
  if (s.shakePx <= 0 || age < 0 || age > s.shakeTtl) return { x: 0, y: 0 };
  const mag = s.shakePx * (1 - age / s.shakeTtl);
  const a = hash2(key, Math.floor(age * 30), 71) * Math.PI * 2;
  // `|| 0` は -0 を 0 に揃える(平行移動量として同じだが比較で区別されるため)
  return { x: Math.round(Math.cos(a) * mag) || 0, y: Math.round(Math.sin(a) * mag) || 0 };
}
