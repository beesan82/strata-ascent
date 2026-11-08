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

export const CHARGE_SEGMENTS = 6;

export interface ChargeSegment {
  /** 方向(rad)。6 本が等間隔に銃口を取り囲む */
  angle: number;
  /** 銃口中心から帯の内端までの距離(px、内部バッファ座標) */
  dist: number;
  /** 帯の長さ(px) */
  len: number;
  /** 帯の幅(px) */
  width: number;
}

/** 溜め中に銃口へ収束する短い帯。溜めるほど内端が寄り、帯が伸びる */
export function chargeSegment(ratio: number, i: number): ChargeSegment {
  const t = clamp01(ratio);
  return {
    angle: (i * Math.PI * 2) / CHARGE_SEGMENTS + Math.PI / 6,
    dist: 26 - 15 * t,
    len: 5 + 8 * t,
    width: 2,
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
