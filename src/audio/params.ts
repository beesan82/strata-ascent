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

/** ボス予備動作の警告音: 短い矩形波の下降チャープ(Hz、秒)。音量は控えめに抑える */
export const WARN_FREQ_START = 880;
export const WARN_FREQ_END = 587;
export const WARN_SECONDS = 0.18;
export const WARN_GAIN = 0.1;

/** 光柱のハム: 高周波(Hz)と、軸からこの距離(タイル)で 0 になる減衰 */
export const HUM_FREQ = 2200;
export const HUM_RANGE = 64;

/** dx: 光柱の軸からの水平距離、dy: 前室の縦範囲(板の下面〜床)からのはみ出し(中なら 0)。チェビシェフ距離で減衰 */
export function beaconHum(dx: number, dy: number): number {
  return clamp01(1 - Math.max(Math.abs(dx), Math.abs(dy)) / HUM_RANGE);
}

/**
 * 重粒子砲の音(2026-11-08 追加)。調整はこの節の定数だけで行う。
 * 溜め音: 溜め比率 0→1 で基音が指数に上がる唸り。ゲインも比率で少し持ち上がる。
 */
export const CHARGE_FREQ_START = 55;
export const CHARGE_FREQ_END = 220;
/** 溜め音のゲイン(線形、マスター前)。連続音なので既存の短音より控えめに */
export const CHARGE_GAIN = 0.2;

export function chargeFreq(ratio: number): number {
  return CHARGE_FREQ_START * (CHARGE_FREQ_END / CHARGE_FREQ_START) ** clamp01(ratio);
}

export function chargeGain(ratio: number): number {
  return CHARGE_GAIN * (0.7 + 0.3 * clamp01(ratio));
}

/** 発射音: サブ正弦波の pitch 落下(重低音の芯) */
export const FIRE_SUB_START_HZ = 120;
export const FIRE_SUB_END_HZ = 34;
export const FIRE_SUB_SECONDS = 0.5;
export const FIRE_SUB_GAIN = 0.9;
/** 発射音: ノイズの破裂感。ローパスの周波数を落として「ドン」から残響の尾へ変える */
export const FIRE_NOISE_SECONDS = 0.32;
export const FIRE_NOISE_GAIN = 0.65;
export const FIRE_NOISE_START_HZ = 3800;
export const FIRE_NOISE_END_HZ = 240;

/**
 * 破砕音: 掘削で実際に壊れたタイル数(Destruction.knownBroken の差分)から
 * 音量・長さ・開始帯域を決める。破壊数は桁でばらつくので対数で圧縮し、
 * CRUSH_MAX_TILES で最大に頭打ちさせる。1 発の掘削で 1 音に集約する前提。
 */
export const CRUSH_MAX_TILES = 600;
export const CRUSH_GAIN_MIN = 0.3;
export const CRUSH_GAIN_MAX = 0.85;
export const CRUSH_SECONDS_MIN = 0.25;
export const CRUSH_SECONDS_MAX = 1.1;
export const CRUSH_HZ_MIN = 700;
export const CRUSH_HZ_MAX = 2600;

export interface CrushParams {
  gain: number;
  seconds: number;
  /** ローパスの開始周波数(Hz)。鳴りながら 180 Hz まで落ちる */
  startHz: number;
}

export function crushParams(brokenTiles: number): CrushParams {
  const k = clamp01(Math.log1p(Math.max(0, brokenTiles)) / Math.log1p(CRUSH_MAX_TILES));
  return {
    gain: CRUSH_GAIN_MIN + (CRUSH_GAIN_MAX - CRUSH_GAIN_MIN) * k,
    seconds: CRUSH_SECONDS_MIN + (CRUSH_SECONDS_MAX - CRUSH_SECONDS_MIN) * k,
    startHz: CRUSH_HZ_MIN + (CRUSH_HZ_MAX - CRUSH_HZ_MIN) * k,
  };
}

/**
 * パルスの音(音系の全面見直し、2026-11-08)。連射(6 発/秒)に耐えるよう短く軽くし、
 * 発射インデックスで pitch を決定論にばらして単調さを消す。ばらしは黄金角の sin で
 * 周期が発射間隔と共鳴しないようにする。
 */
export const PULSE_FREQ_START = 840;
export const PULSE_FREQ_END = 460;
export const PULSE_SECONDS = 0.06;
export const PULSE_GAIN = 0.16;
/** pitch ばらしの最大振れ幅(倍率 ±) */
export const PULSE_DETUNE = 0.04;

export function pulseDetune(shotIndex: number): number {
  return 1 + PULSE_DETUNE * Math.sin(shotIndex * 2.399963229728653);
}

/** 敵への命中(非撃破): 短いティック */
export const HIT_FREQ = 190;
export const HIT_SECONDS = 0.04;
export const HIT_GAIN = 0.18;
export const HIT_NOISE_HZ = 2600;
export const HIT_NOISE_GAIN = 0.1;

/** 敵の撃破: 低い正弦波の pitch 落下 + ノイズの崩れ */
export const DOWN_FREQ_START = 320;
export const DOWN_FREQ_END = 64;
export const DOWN_SECONDS = 0.18;
export const DOWN_GAIN = 0.3;
export const DOWN_NOISE_SECONDS = 0.15;
export const DOWN_NOISE_GAIN = 0.2;
export const DOWN_NOISE_HZ = 900;

/** プレイヤーの被弾: 鋸波の pitch 落下 */
export const HURT_FREQ_START = 170;
export const HURT_FREQ_END = 65;
export const HURT_SECONDS = 0.16;
export const HURT_GAIN = 0.35;

/** 飢餓ダメージ: 被弾とは別経路の、空虚で控えめな音 */
export const STARVE_FREQ_START = 130;
export const STARVE_FREQ_END = 80;
export const STARVE_SECONDS = 0.2;
export const STARVE_GAIN = 0.18;

/** プレイヤーの死亡: 長い pitch 落下 */
export const DEATH_FREQ_START = 220;
export const DEATH_FREQ_END = 38;
export const DEATH_SECONDS = 0.7;
export const DEATH_GAIN = 0.4;

/** 復活: 死亡音と重ならないよう少し遅らせて 2 音 */
export const REVIVE_DELAY = 0.2;
export const REVIVE_NOTES: readonly number[] = [392, 587.33];
export const REVIVE_NOTE_GAP = 0.09;
export const REVIVE_GAIN = 0.14;

/** ジャンプ: 軽い pitch 上昇 */
export const JUMP_FREQ_START = 230;
export const JUMP_FREQ_END = 430;
export const JUMP_SECONDS = 0.09;
export const JUMP_GAIN = 0.1;

/** 着地: 落下速度(着地直前の vy)からゲインを決める。小さな段差降りでは鳴らさない */
export const LAND_MIN_VY = 5;
export const LAND_GAIN_MIN = 0.12;
export const LAND_GAIN_MAX = 0.4;
export const LAND_SECONDS = 0.07;
export const LAND_NOISE_HZ = 320;
/** ゲインが最大に達する落下速度(entities/player の MAX_FALL) */
export const LAND_FULL_VY = 25;

export function landGain(fallSpeed: number): number {
  const v = Math.max(0, fallSpeed);
  if (v < LAND_MIN_VY) return 0;
  const k = clamp01((v - LAND_MIN_VY) / (LAND_FULL_VY - LAND_MIN_VY));
  return LAND_GAIN_MIN + (LAND_GAIN_MAX - LAND_GAIN_MIN) * k;
}

/** 梯子の段: 縦移動距離 LADDER_RUNG_STEP(タイル)ごとの跨ぎで 1 回鳴らす(足音の π 跨ぎと同形) */
export const LADDER_RUNG_STEP = 0.5;
export const LADDER_FREQ_A = 1450;
export const LADDER_FREQ_B = 1650;
export const LADDER_SECONDS = 0.03;
export const LADDER_GAIN = 0.07;

export function rungCrossed(prevDist: number, dist: number): boolean {
  return Math.floor(prevDist / LADDER_RUNG_STEP) !== Math.floor(dist / LADDER_RUNG_STEP);
}

/**
 * ドロップ取得音: 種別ごとに異なる上行 2 音(Hz)。砲弾は鋭く、回復は丸く、糧食は低めに。
 * 未知の種別は糧食の音に落とす(新しい種別が増えても無音にならないための既定)。
 */
export const PICKUP_NOTES: Record<string, readonly number[]> = {
  charge: [659.25, 987.77],
  heal: [523.25, 783.99],
  ration: [392, 523.25],
};
export const PICKUP_NOTE_GAP = 0.06;
export const PICKUP_GAIN = 0.18;

export function pickupNotes(kind: string): readonly number[] {
  return PICKUP_NOTES[kind] ?? PICKUP_NOTES.ration;
}

/** 補給キャッシュ開封: ノイズの擦れ(バンドパス掃引) */
export const CACHE_SECONDS = 0.14;
export const CACHE_GAIN = 0.22;
export const CACHE_HZ_START = 500;
export const CACHE_HZ_END = 1800;

/** 休憩点の初回補給: 温かい上行 2 音 */
export const REST_STOCK_NOTES: readonly number[] = [261.63, 392];
export const REST_STOCK_GAIN = 0.18;

/** 復活点の更新: 控えめな単音 */
export const RESPAWN_FREQ = 440;
export const RESPAWN_SECONDS = 0.09;
export const RESPAWN_GAIN = 0.09;

/** 武器切替: 短いクリック */
export const SWITCH_FREQ = 1250;
export const SWITCH_SECONDS = 0.03;
export const SWITCH_GAIN = 0.13;

/** 砲の弾回復(自動回復の完了): ごく小さな合図 */
export const RECHARGE_FREQ = 1180;
export const RECHARGE_SECONDS = 0.04;
export const RECHARGE_GAIN = 0.06;

/** 満腹度の警告: 低い矩形波の 2 連 */
export const SATIETY_WARN_FREQ = 196;
export const SATIETY_WARN_SECONDS = 0.07;
export const SATIETY_WARN_GAP = 0.12;
export const SATIETY_WARN_GAIN = 0.13;

/** 糧食の自動摂取: ローパスのノイズを 2 回噛む */
export const EAT_SECONDS = 0.05;
export const EAT_GAP = 0.1;
export const EAT_GAIN = 0.2;
export const EAT_HZ = 500;

/** 字幕ジングル: 節目は 3 音の上行、新記録は 4 音でより高く終わる */
export const MILESTONE_NOTES: readonly number[] = [261.63, 329.63, 392];
export const NEW_RECORD_NOTES: readonly number[] = [392, 523.25, 659.25, 783.99];
export const JINGLE_GAIN = 0.2;
export const JINGLE_NOTE_GAP = 0.09;
export const JINGLE_NOTE_SECONDS = 0.3;

/** 砲台の発射: パルスより硬く高い矩形波の下降 */
export const TURRET_FREQ_START = 1350;
export const TURRET_FREQ_END = 280;
export const TURRET_SECONDS = 0.08;
export const TURRET_GAIN = 0.2;

/** 飛行敵の追尾開始: 小さな矩形波の上昇チャープ(気配の合図) */
export const FLYER_FREQ_START = 1150;
export const FLYER_FREQ_END = 1650;
export const FLYER_SECONDS = 0.06;
export const FLYER_GAIN = 0.07;

/** ボスの出現: 低い正弦波の膨らみ + ノイズの地鳴り */
export const BOSS_APPEAR_FREQ = 55;
export const BOSS_APPEAR_SECONDS = 0.5;
export const BOSS_APPEAR_GAIN = 0.3;
export const BOSS_APPEAR_NOISE_GAIN = 0.12;
export const BOSS_APPEAR_NOISE_HZ = 160;

/** ボスの突進開始: バンドパスを上げるノイズの疾走 */
export const BOSS_CHARGE_SECONDS = 0.3;
export const BOSS_CHARGE_GAIN = 0.22;
export const BOSS_CHARGE_HZ_START = 400;
export const BOSS_CHARGE_HZ_END = 2400;

/** ボスの激突(硬直入り): 低いノイズ + サブのドスン */
export const BOSS_CRASH_SECONDS = 0.22;
export const BOSS_CRASH_GAIN = 0.4;
export const BOSS_CRASH_HZ = 500;
export const BOSS_CRASH_SUB_FREQ = 58;
export const BOSS_CRASH_SUB_SECONDS = 0.18;
export const BOSS_CRASH_SUB_GAIN = 0.35;

/** ボスの撃破: 通常撃破より長く重い pitch 落下 + ノイズの崩壊 */
export const BOSS_DOWN_FREQ_START = 200;
export const BOSS_DOWN_FREQ_END = 30;
export const BOSS_DOWN_SECONDS = 0.7;
export const BOSS_DOWN_GAIN = 0.5;
export const BOSS_DOWN_NOISE_SECONDS = 0.5;
export const BOSS_DOWN_NOISE_GAIN = 0.35;
export const BOSS_DOWN_NOISE_HZ = 700;
