import { biomeCellAt, type BiomeId } from '../world/biomeCells';
import { interfaceBottom, interfaceTop } from '../world/interface';

/**
 * 音(設計書 §6.7)のパラメータ計算。純粋関数のみ(WebAudio は engine.ts)。
 * アセットなしで合成するので、ここで決めるのは周波数・ゲイン・残響長・発火条件だけ。
 */

/** マスター音量(dB)。控えめに */
export const MASTER_DB = -12;

export function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * 足音: 接地歩行の walkPhase が π の倍数を跨いだフレームで 1 回鳴らす。walkPhase は
 * 移動距離駆動(歩幅 1 タイル = 位相 π、core/gait)で、着地は位相の π の倍数に置かれる
 * ため、π 跨ぎがそのまま着地と一致する。
 * 設計書の「整数跨ぎ」を文字通り取ると 9 回/秒の連打になった(レビューで指摘)。
 */
export function footstepCrossed(prevPhase: number, phase: number): boolean {
  return Math.floor(prevPhase / Math.PI) !== Math.floor(phase / Math.PI);
}

/** 残響の長さ(秒)の範囲。開放度 0(閉塞・休憩点)→ 短く、1(前室・大空洞)→ 長く */
export const REVERB_MIN = 0.15;
export const REVERB_MAX = 1.6;
/** インパルス応答の生成は重いので、開放度をこの段数に量子化して段ごとに 1 回だけ作る */
export const REVERB_BUCKETS = 6;

export function reverbSeconds(openness: number): number {
  return REVERB_MIN + clamp01(openness) * (REVERB_MAX - REVERB_MIN);
}

export function reverbBucket(openness: number): number {
  return Math.round(clamp01(openness) * (REVERB_BUCKETS - 1));
}

export function reverbSecondsForBucket(bucket: number): number {
  return reverbSeconds(bucket / (REVERB_BUCKETS - 1));
}

/** 層のドローン: 基音(Hz)、倍音の比(1 から)、波形、ゲイン(dB) */
export interface DroneParams {
  freq: number;
  harmonics: readonly number[];
  type: OscillatorType;
  gainDb: number;
}

/** バイオームごとの音程・倍音(§6.7「バイオームで音程・倍音を変える」) */
export const DRONE_TABLE: Record<BiomeId, DroneParams> = {
  coldSteel: { freq: 55, harmonics: [1, 2, 3], type: 'sine', gainDb: -6 },
  habitation: { freq: 65.41, harmonics: [1, 1.5, 2], type: 'triangle', gainDb: -9 },
  disposal: { freq: 49, harmonics: [1, 2.01, 2.5], type: 'sawtooth', gainDb: -12 },
  waterVoid: { freq: 41.2, harmonics: [1, 2, 4], type: 'sine', gainDb: -6 },
  power: { freq: 73.42, harmonics: [1, 3, 5], type: 'square', gainDb: -15 },
  foundry: { freq: 46.25, harmonics: [1, 2, 3.02], type: 'sawtooth', gainDb: -12 },
  biomech: { freq: 36.71, harmonics: [1, 1.5, 2.02], type: 'sine', gainDb: -8 },
};

export function droneParams(id: BiomeId): DroneParams {
  return DRONE_TABLE[id];
}

/** 界面のうなり: 板(上面・下面)からこの距離(タイル)で 0 になる。基音 + BEAT_DETUNE_HZ の正弦波を足してうならせる */
export const BEAT_RANGE = 24;
export const BEAT_DETUNE_HZ = 0.7;

export function interfaceBeat(distToPlate: number): number {
  return clamp01(1 - distToPlate / BEAT_RANGE);
}

/** 今いる層の天井の板(cell)と床の板(cell+1)の上面・下面のうち、y に最も近いものまでの距離(タイル) */
export function nearestPlateDistance(seed: number, y: number): number {
  const cell = biomeCellAt(seed, y);
  let best = Infinity;
  for (const c of [cell, cell + 1]) {
    best = Math.min(best, Math.abs(y - interfaceTop(seed, c)), Math.abs(y - interfaceBottom(seed, c)));
  }
  return best;
}

/** 通過音: 低い正弦波の減衰音(Hz、秒) */
export const PASSAGE_FREQ = 110;
export const PASSAGE_DECAY = 1.8;

/** 光柱のハム: 高周波(Hz)と、軸からこの距離(タイル)で 0 になる減衰 */
export const HUM_FREQ = 2200;
export const HUM_RANGE = 64;

/** dx: 光柱の軸からの水平距離、dy: 前室の縦範囲(板の下面〜床)からのはみ出し(中なら 0)。チェビシェフ距離で減衰 */
export function beaconHum(dx: number, dy: number): number {
  return clamp01(1 - Math.max(Math.abs(dx), Math.abs(dy)) / HUM_RANGE);
}
