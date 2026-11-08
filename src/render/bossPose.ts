import { BOSS_WINDUP_TIME } from '../entities/enemy';

/**
 * ボス「広間番人」の予備動作(windup)の見た目を決める純粋関数群(Task 2)。
 * 進捗 p = phaseT / BOSS_WINDUP_TIME(0..1)から、姿勢の沈み込み・震え・点滅・目の灯を
 * すべて決定論で導く(生成・描画に Math.random を使わない決まりに従う)。
 * 色はすべてパレット実在色だけを使う(renderer の敵描画と同じ集合)。
 */

/** 沈み込みの最大量(タイル)。予備動作の終わりに体がこのぶん低く・潰れる */
export const WINDUP_MAX_SINK_TILES = 0.35;
/** 震えの最大振幅(タイル、片側)。進捗の 2 乗で増える */
export const WINDUP_MAX_SHAKE_TILES = 0.09;
/** この進捗を超えたら点滅をやめ、熱色に固定する(突進直前の最終合図) */
export const WINDUP_HEAT_FROM = 0.75;
/** 点滅の初期周波数(Hz)。現行の 10Hz 点滅と揃える */
export const WINDUP_BLINK_START_HZ = 10;
/** 点滅の加速ぶん(Hz)。周波数は p の 2 乗で START + GAIN * p^2 まで上がる */
export const WINDUP_BLINK_GAIN_HZ = 16;
/** 震えの角周波数(rad/秒)。時刻ベースの sin で作る */
const SHAKE_OMEGA = 80;

export interface WindupPose {
  /** 予備動作の進捗 0..1(phaseT を [0, BOSS_WINDUP_TIME] に丸めた比率) */
  progress: number;
  /** 沈み込み量(タイル)。体は足元を床に anchored のまま、このぶん低くなる */
  sinkTiles: number;
  /** 震えの横オフセット(タイル、符号付き) */
  shakeTiles: number;
  /** 本体の色(パレット実在色の hex) */
  bodyColor: string;
  /** 目の灯の色(パレット実在色の hex) */
  eyeColor: string;
}

/** 点滅の位相(サイクル数)。周波数が進捗で変わるため、解析積分で位相を進める */
function blinkPhase(phaseT: number): number {
  const t = BOSS_WINDUP_TIME;
  return (
    WINDUP_BLINK_START_HZ * phaseT +
    (WINDUP_BLINK_GAIN_HZ / (3 * t * t)) * phaseT * phaseT * phaseT
  );
}

/**
 * 予備動作のポーズ。phaseT は相の経過秒、timeSec は描画時刻(震えの位相に使う)。
 * - 沈み込み: p^2 で増え、終盤に最大 0.35 タイル沈む
 * - 震え: 振幅 p^2 × 最大 0.09 タイル、sin の時刻ベース(決定論)
 * - 点滅: 10Hz から加速し、p > 0.75 で熱色(錆 #9a6d32)に固定する
 * - 目の灯: 前半は金(#caa64a)、終盤(p > 0.75)は白(#c7d0ce)になる
 */
export function windupPose(phaseT: number, timeSec: number): WindupPose {
  const clamped = Math.max(0, Math.min(BOSS_WINDUP_TIME, phaseT));
  const progress = clamped / BOSS_WINDUP_TIME;
  const p2 = progress * progress;
  const heat = progress > WINDUP_HEAT_FROM;
  const bodyColor = heat
    ? '#9a6d32'
    : Math.floor(blinkPhase(clamped)) % 2 === 0
      ? '#c7d0ce'
      : '#5a3a24';
  const shake = WINDUP_MAX_SHAKE_TILES * p2 * Math.sin(timeSec * SHAKE_OMEGA);
  return {
    progress,
    sinkTiles: WINDUP_MAX_SINK_TILES * p2,
    // 振幅 0 のときの -0 を正の 0 にそろえる(テストと呼び出し側の比較のため)
    shakeTiles: shake === 0 ? 0 : shake,
    bodyColor,
    eyeColor: heat ? '#c7d0ce' : '#caa64a',
  };
}
