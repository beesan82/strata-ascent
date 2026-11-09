/**
 * 重粒子砲の演出の「形」を決める純粋関数群(段階 3、設計 §5.1)。
 * グラデーションの発光ではなく、パレット実在色の階段状の帯で質量を表す。
 * 色はすべて 32 色パレット(PIXEL_PALETTE)の実在色でなければならない
 * (任意色は量子化で別色相へ寄るため)。
 */
import { hash2 } from '../world/noise';

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface BeamBand {
  /** 帯の総幅(タイル) */
  width: number;
  color: string;
  alpha: number;
}

/**
 * ビームの帯構成(広い順)。alpha は残り寿命比(1=発射直後 → 0=消滅)。
 * 発射直後が最も太く、外帯(錆・低 alpha)と熱帯(金)は寿命の前半で消え、
 * 残光の後半は中帯(明るい鋼色)と芯(白)だけが細く残る。
 * 「太さと明度の両方が痩せていく」減衰。
 */
export function beamBands(alpha: number): BeamBand[] {
  const a = clamp01(alpha);
  if (a <= 0) return [];
  const bands: BeamBand[] = [];
  // 外帯: 錆。寿命の 8 割を過ぎると消える
  const outerT = clamp01((a - 0.2) / 0.8);
  if (outerT > 0) bands.push({ width: 2.8 * outerT, color: '#9a6d32', alpha: 0.38 * outerT });
  // 熱帯: 金。寿命の前半だけ
  const hotT = clamp01((a - 0.5) / 0.5);
  if (hotT > 0) bands.push({ width: 0.5 + 0.9 * hotT, color: '#caa64a', alpha: 0.8 * hotT });
  // 中帯: 明るい鋼色
  bands.push({ width: 0.3 + 0.8 * a, color: '#51728d', alpha: 0.85 });
  // 芯: 白。最後まで残る
  bands.push({ width: 0.15 + 0.3 * a, color: '#c7d0ce', alpha: 1 });
  return bands;
}

export interface MuzzleFlash {
  /** 銃口から伸びる長さ(タイル) */
  length: number;
  /** 総幅(タイル) */
  width: number;
  alpha: number;
}

/**
 * 銃口の閃光(短い矩形)。放射グラデーションの球の置き換え。
 * 寿命の前半(残り 55% 以上)だけ出て、数フレームで縮む。
 */
export function muzzleFlash(alpha: number): MuzzleFlash | null {
  const a = clamp01(alpha);
  if (a <= 0.55) return null;
  const t = (a - 0.55) / 0.45;
  return { length: 0.35 + 0.75 * t, width: 0.5 + 0.7 * t, alpha: t };
}

/** 溜めの色段: 鋼 → 錆 → 金(パレット実在色の切り替えで表す) */
export function chargeColor(ratio: number): string {
  const t = clamp01(ratio);
  if (t < 0.45) return '#51728d';
  if (t < 0.8) return '#9a6d32';
  return '#caa64a';
}

/* ---- 溜め演出(段階1 エフェクト設計 §2) ----
 * 収束パーティクル・球コア・電弧・完了リング・グローの「形」。すべて銃口を原点とした
 * 内部バッファ座標(px)で返す。ばらつきは Math.random でなく決定論ハッシュ(hash2)で作る。
 */

/** 溜め演出のハッシュ種(固定。パーティクルの配置・位相の個体差を決める) */
const CHARGE_HASH_KEY = 0x5ca1ab1e;

/** 0..1 の循環(負の入力でも 0..1 に収める) */
function frac01(v: number): number {
  const f = v % 1;
  return f < 0 ? f + 1 : f;
}

/** '#rrggbb' を透明度付きの 'rgba(r,g,b,a)' にする(グラデーションの透明端用) */
export function hexWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 満タン時のパーティクル数。個数は ratio に比例して増える */
export const CHARGE_PARTICLE_MAX = 14;
/** パーティクルの出発半径(px)の範囲と、収束先(コア表面)の半径 */
const PARTICLE_R0_MIN = 18;
const PARTICLE_R0_MAX = 32;
const PARTICLE_R_END = 2;

export interface ChargeParticle {
  /** 銃口からの変位(px) */
  dx: number;
  dy: number;
  /** 一辺(px) */
  size: number;
  color: string;
  alpha: number;
  /** 吸い込みの進み(0=外側の出発点 → 1=銃口)。描画では使わない(テストで単調性を見る) */
  progress: number;
}

/**
 * 銃口へ吸い込まれる火花。i 番目の火花は固定ハッシュで出発角・出発半径・位相・渦の向きが決まり、
 * 時間とともに外から銃口へ一直線(わずかに渦を巻く)に落ちて、銃口に着くと外側へ戻って繰り返す。
 * 溜めるほど個数が増え、速く、明るく、終盤は白くなる。
 */
export function chargeParticles(ratio: number, timeSec: number): ChargeParticle[] {
  const t = clamp01(ratio);
  if (t <= 0) return [];
  const count = Math.min(CHARGE_PARTICLE_MAX, Math.max(2, Math.ceil(t * CHARGE_PARTICLE_MAX)));
  const out: ChargeParticle[] = [];
  for (let i = 0; i < count; i++) {
    const hAngle = hash2(CHARGE_HASH_KEY, i, 3);
    const hPhase = hash2(CHARGE_HASH_KEY, i, 7);
    const hRadius = hash2(CHARGE_HASH_KEY, i, 13);
    const hSwirl = hash2(CHARGE_HASH_KEY, i, 19);
    const hSpeed = hash2(CHARGE_HASH_KEY, i, 29);
    // 吸い込み 1 回の速さ(回/秒): 溜めるほど速い。個体差 ±25%
    const speed = (1.2 + 1.8 * t) * (0.75 + 0.5 * hSpeed);
    const p = frac01(timeSec * speed + hPhase);
    const r0 = PARTICLE_R0_MIN + (PARTICLE_R0_MAX - PARTICLE_R0_MIN) * hRadius;
    const r = r0 + (PARTICLE_R_END - r0) * p;
    const angle = hAngle * Math.PI * 2 + (hSwirl - 0.5) * 1.6 * p;
    const near = p > 0.75;
    out.push({
      dx: Math.cos(angle) * r,
      dy: Math.sin(angle) * r,
      size: near && t >= 0.5 ? 2 : 1,
      color: near && t >= 0.5 ? '#c7d0ce' : chargeColor(t),
      alpha: (0.35 + 0.65 * p) * (0.55 + 0.45 * t),
      progress: p,
    });
  }
  return out;
}

export interface ChargeCore {
  /** 球の半径(px) */
  radius: number;
  /** 放射グラデーションの色止め(中心 白 → 溜め段の色 → 透明) */
  stops: { offset: number; color: string }[];
  alpha: number;
}

/**
 * 銃口の球コア。四角の芯を置き換える放射グラデーション(白→金→透明)。
 * 溜めるほど半径と白芯の割合と明るさが増す。量子化で帯になるが体積感は出る。
 */
export function chargeCore(ratio: number): ChargeCore {
  const t = clamp01(ratio);
  const mid = chargeColor(t);
  const whiteEnd = 0.15 + 0.3 * t;
  return {
    radius: 3 + 6 * t,
    stops: [
      { offset: 0, color: '#c7d0ce' },
      { offset: whiteEnd, color: mid },
      { offset: 0.7, color: hexWithAlpha(mid, 0.6) },
      { offset: 1, color: hexWithAlpha(mid, 0) },
    ],
    alpha: 0.6 + 0.4 * t,
  };
}

/** 電弧が出始める溜め比率 */
export const CHARGE_ARC_FROM = 0.6;
/** 電弧の形を切り替える頻度(回/秒)。時間をこの刻みで量子化してハッシュの種にする */
export const CHARGE_ARC_HZ = 18;

/** 電弧の折れ数(セグメント数)の範囲 */
export const CHARGE_ARC_SEG_MIN = 5;
export const CHARGE_ARC_SEG_MAX = 8;
/** 1 セグメントが主方向へ進む距離(px)の範囲(全長の上限に収めるため縮むことはある) */
export const CHARGE_ARC_STEP_MIN = 2;
export const CHARGE_ARC_STEP_MAX = 4;
/** 主方向に垂直なジッターの最大振幅(px) */
export const CHARGE_ARC_JITTER = 2.5;
/** 電弧の先端が銃口から離れてよい距離の上限: コア半径 + この値(px) */
export const CHARGE_ARC_REACH = 10;

export interface ChargeArc {
  /** 折れ線の頂点(銃口原点、px)。コア表面から外へ向かう */
  points: { x: number; y: number }[];
  /** 白〜鋼色(パレット実在色) */
  color: string;
  alpha: number;
}

/**
 * コア周囲の放電(稲妻型の折れ線)。ratio >= 0.6 で 2 本、満タンで 5 本。
 * 各本はコア表面の 1 点から外向き(半径方向)の主方向を持ち、5〜8 セグメントで 1 セグメント 2〜4 px ずつ
 * 主方向へ進みながら、垂直方向へ ±CHARGE_ARC_JITTER px の鋭いジッター(頂点ごとに独立のハッシュ)を入れる。
 * 先端の銃口からの距離がコア半径 + CHARGE_ARC_REACH を超える場合は進みを一様に縮めて収める。
 * 形は timeSec を CHARGE_ARC_HZ で量子化した tick をハッシュの種にして決めるので、
 * 同じ tick では同じ形、tick が進むと別の形になる(ちらつきの表現)。枝分かれはしない。
 */
export function chargeArcs(ratio: number, timeSec: number): ChargeArc[] {
  const t = clamp01(ratio);
  if (t < CHARGE_ARC_FROM) return [];
  const u = (t - CHARGE_ARC_FROM) / (1 - CHARGE_ARC_FROM);
  const count = 2 + Math.floor(u * 3);
  const tick = Math.floor(timeSec * CHARGE_ARC_HZ);
  const coreR = chargeCore(t).radius;
  const out: ChargeArc[] = [];
  for (let j = 0; j < count; j++) {
    const segRange = CHARGE_ARC_SEG_MAX - CHARGE_ARC_SEG_MIN + 1;
    const steps = CHARGE_ARC_SEG_MIN + Math.min(segRange - 1, Math.floor(hash2(tick, j, 2) * segRange));
    // 主方向: コア表面の出発点から半径方向の外向き
    const a0 = hash2(tick, j, 1) * Math.PI * 2;
    const ux = Math.cos(a0);
    const uy = Math.sin(a0);
    const r0 = coreR * 0.85;
    // 各セグメントの主方向への進み(2〜4 px)。合計が届く範囲を超えるなら一様に縮める
    const advances: number[] = [];
    let total = 0;
    for (let s = 1; s <= steps; s++) {
      const adv = CHARGE_ARC_STEP_MIN + (CHARGE_ARC_STEP_MAX - CHARGE_ARC_STEP_MIN) * hash2(tick, j, 10 + s);
      advances.push(adv);
      total += adv;
    }
    // 先端(ジッター込み)の銃口からの距離が coreR + REACH を超えないよう、主方向の到達点に上限を置く
    const reach = coreR + CHARGE_ARC_REACH;
    const alongMax = Math.sqrt(reach * reach - CHARGE_ARC_JITTER * CHARGE_ARC_JITTER);
    const budget = alongMax - r0;
    const scale = total > budget ? budget / total : 1;
    const points = [{ x: ux * r0, y: uy * r0 }];
    let along = r0;
    for (let s = 1; s <= steps; s++) {
      along += advances[s - 1] * scale;
      const jitter = (hash2(tick, j, 30 + s) - 0.5) * 2 * CHARGE_ARC_JITTER;
      points.push({ x: ux * along - uy * jitter, y: uy * along + ux * jitter });
    }
    out.push({
      points,
      color: hash2(tick, j, 5) < 0.6 ? '#c7d0ce' : '#51728d',
      alpha: 0.6 + 0.4 * u,
    });
  }
  return out;
}

/** 完了リングの寿命(秒)。満タンになってからこの間だけ拡大するリングを描く */
export const CHARGE_RING_TTL = 0.18;
/** 完了リングの半径(内部バッファ px)の範囲。コアのすぐ外から始まり、プレイヤーを囲まない大きさで止まる */
export const CHARGE_RING_R_MIN = 4;
export const CHARGE_RING_R_MAX = 13;

export interface ChargeRing {
  radius: number;
  /** 芯の線幅(px) */
  width: number;
  alpha: number;
}

/**
 * 満タン直後に広がる小さな衝撃波。ratio が 1 未満、または満タン経過が寿命を過ぎたら null。
 * 半径は経過で CHARGE_RING_R_MIN → CHARGE_RING_R_MAX へ広がり、線幅は痩せ、
 * 明るさは (1-p) の 2 乗で速く消える(広がりきる前に薄くなる)。
 */
export function chargeRing(ratio: number, fullT: number): ChargeRing | null {
  if (clamp01(ratio) < 1 || fullT < 0 || fullT > CHARGE_RING_TTL) return null;
  const p = fullT / CHARGE_RING_TTL;
  const fade = 1 - p;
  return {
    radius: CHARGE_RING_R_MIN + (CHARGE_RING_R_MAX - CHARGE_RING_R_MIN) * p,
    width: 2 - p,
    alpha: fade * fade,
  };
}

export interface ChargeGlow {
  /** 光暈の半径(内部バッファ px 換算。present 後は表示倍率を掛ける) */
  radius: number;
  alpha: number;
}

/**
 * present 後に表示解像度で重ねるグロー(設計 §2-5)。半径と不透明度は ratio に比例し、
 * 満タン直後は完了リングと同期して一瞬強まる。ratio 0 以下は null。
 * リング連動分: 半径はリングの広がり(CHARGE_RING_R_MIN からの増分)の 6/9 に追随し、
 * 明るさはリングの alpha に比例して上乗せする。グロー自体の基本半径(10 + 24t)は変えない。
 */
export function chargeGlow(ratio: number, fullT: number): ChargeGlow | null {
  const t = clamp01(ratio);
  if (t <= 0) return null;
  const ring = chargeRing(t, fullT);
  const ringSpread = ring ? (ring.radius - CHARGE_RING_R_MIN) / (CHARGE_RING_R_MAX - CHARGE_RING_R_MIN) : 0;
  return {
    radius: 10 + 24 * t + 6 * ringSpread,
    alpha: 0.12 + 0.35 * t + (ring ? 0.3 * ring.alpha : 0),
  };
}

export const DEBRIS_TTL = 0.32;
export const DEBRIS_COUNT = 10;

export interface DebrisFragment {
  /** 出現点からの変位(タイル) */
  dx: number;
  dy: number;
  /** 一辺(タイル) */
  size: number;
  color: string;
  alpha: number;
}

const DEBRIS_COLORS = ['#9a6d32', '#caa64a', '#51728d', '#3d2618'] as const;
const DEBRIS_GRAVITY = 16; // タイル/秒²(破片は軽く見せるため実重力より弱く)

/**
 * 掘削点・命中点から飛ぶ破片。発射 key と角度と経過時間だけから決まる決定論配置
 * (Math.random は使わない)。大半は発射方向の逆側(切り口から手前へ吹き出す)へ、
 * 一部は前方へ。寿命の後半で薄れる。
 */
export function debrisFragments(key: number, angle: number, age: number): DebrisFragment[] {
  if (age < 0 || age > DEBRIS_TTL) return [];
  const fade = age < DEBRIS_TTL * 0.6 ? 1 : 1 - (age - DEBRIS_TTL * 0.6) / (DEBRIS_TTL * 0.4);
  const out: DebrisFragment[] = [];
  for (let i = 0; i < DEBRIS_COUNT; i++) {
    const hDir = hash2(key, i, 11);
    const hSpeed = hash2(key, i, 23);
    const hSize = hash2(key, i, 37);
    const hColor = hash2(key, i, 41);
    const hForward = hash2(key, i, 53);
    const dir = hForward < 0.25
      ? angle + (hDir - 0.5) * 1.2
      : angle + Math.PI + (hDir - 0.5) * 2.4;
    const speed = 2 + 5 * hSpeed;
    const vx = Math.cos(dir) * speed;
    const vy = Math.sin(dir) * speed - 1.5;
    out.push({
      dx: vx * age,
      dy: vy * age + 0.5 * DEBRIS_GRAVITY * age * age,
      size: 0.07 + 0.11 * hSize,
      color: DEBRIS_COLORS[Math.floor(hColor * DEBRIS_COLORS.length) % DEBRIS_COLORS.length],
      alpha: fade,
    });
  }
  return out;
}
