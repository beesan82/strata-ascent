import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import { interfaceBottom, interfaceTop } from '../world/interface';
import {
  BEAT_RANGE, beaconHum, CHARGE_FREQ_END, CHARGE_FREQ_START, CHARGE_GAIN, chargeFreq, chargeGain,
  CRUSH_GAIN_MAX, CRUSH_GAIN_MIN, CRUSH_HZ_MAX, CRUSH_HZ_MIN, CRUSH_MAX_TILES, CRUSH_SECONDS_MAX, CRUSH_SECONDS_MIN, crushParams,
  dbToGain, DRONE_TABLE, droneParams, footstepCrossed, HUM_RANGE, interfaceBeat,
  MASTER_DB, nearestPlateDistance, REVERB_BUCKETS, REVERB_MAX, REVERB_MIN, reverbBucket, reverbSeconds, reverbSecondsForBucket,
} from './params';

describe('audio params', () => {
  it('マスターは −12 dB ≈ 0.251', () => {
    expect(dbToGain(MASTER_DB)).toBeCloseTo(0.251, 3);
    expect(dbToGain(0)).toBe(1);
  });
  it('足音は walkPhase(ラジアン)が π の倍数を跨いだとき = sin(walkPhase) の零交差(足が着く瞬間)。整数跨ぎでは 9 回/秒になる', () => {
    expect(footstepCrossed(3.0, 3.2)).toBe(true); // π
    expect(footstepCrossed(6.2, 6.4)).toBe(true); // 2π
    expect(footstepCrossed(0.9, 1.1)).toBe(false); // 整数 1 は跨ぐが π は跨がない
    expect(footstepCrossed(1.1, 1.9)).toBe(false);
    expect(footstepCrossed(2, 2)).toBe(false);
    // 歩行 1 秒(位相 +9 ラジアン)で 2〜3 回
    let n = 0;
    for (let t = 0; t < 1; t += 1 / 60) if (footstepCrossed(t * 9, (t + 1 / 60) * 9)) n++;
    expect(n).toBeGreaterThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(3);
  });
  it('残響は開放度に比例(0.15〜1.6 秒)、バケットは 0..5 で単調', () => {
    expect(reverbSeconds(0)).toBe(REVERB_MIN);
    expect(reverbSeconds(1)).toBe(REVERB_MAX);
    expect(reverbSeconds(0.5)).toBeCloseTo((REVERB_MIN + REVERB_MAX) / 2, 10);
    expect(reverbSeconds(2)).toBe(REVERB_MAX);
    expect(reverbBucket(0)).toBe(0);
    expect(reverbBucket(1)).toBe(REVERB_BUCKETS - 1);
    let prev = -1;
    for (let o = 0; o <= 1; o += 0.05) { const b = reverbBucket(o); expect(b).toBeGreaterThanOrEqual(prev); prev = b; }
    expect(reverbSecondsForBucket(REVERB_BUCKETS - 1)).toBe(REVERB_MAX);
    expect(reverbSecondsForBucket(0)).toBe(REVERB_MIN);
  });
  it('ドローンは 5 バイオームで音程が全て異なり、倍音は 1 から始まり、ゲインは 0 dB 以下', () => {
    const freqs = new Set(BIOME_IDS.map((id) => droneParams(id).freq));
    expect(freqs.size).toBe(BIOME_IDS.length);
    for (const id of BIOME_IDS) {
      expect(DRONE_TABLE[id].harmonics[0]).toBe(1);
      expect(DRONE_TABLE[id].gainDb).toBeLessThanOrEqual(0);
      expect(droneParams(id)).toBe(DRONE_TABLE[id]);
    }
  });
  it('うなりは板で 1、24 タイルで 0', () => {
    expect(interfaceBeat(0)).toBe(1);
    expect(interfaceBeat(BEAT_RANGE / 2)).toBeCloseTo(0.5, 10);
    expect(interfaceBeat(BEAT_RANGE)).toBe(0);
    expect(interfaceBeat(100)).toBe(0);
  });
  it('最寄りの板までの距離: 板の上面・下面で 0、層の中腹で正', () => {
    const seed = 20260711;
    expect(nearestPlateDistance(seed, interfaceTop(seed, 0))).toBe(0);
    expect(nearestPlateDistance(seed, interfaceBottom(seed, 0))).toBe(0);
    expect(nearestPlateDistance(seed, interfaceTop(seed, 1))).toBe(0);
    expect(nearestPlateDistance(seed, interfaceBottom(seed, 0) + 100)).toBeGreaterThan(50);
  });
  it('ハムは軸で 1、64 タイルで 0、距離はチェビシェフ', () => {
    expect(beaconHum(0, 0)).toBe(1);
    expect(beaconHum(HUM_RANGE, 0)).toBe(0);
    expect(beaconHum(0, HUM_RANGE / 2)).toBeCloseTo(0.5, 10);
    expect(beaconHum(-16, 8)).toBeCloseTo(1 - 16 / HUM_RANGE, 10);
  });
  it('溜め音の pitch は比率 0→1 で 55→220 Hz へ指数で単調に上がり、範囲外はクランプ', () => {
    expect(chargeFreq(0)).toBe(CHARGE_FREQ_START);
    expect(chargeFreq(1)).toBeCloseTo(CHARGE_FREQ_END, 10);
    expect(chargeFreq(0.5)).toBeCloseTo(Math.sqrt(CHARGE_FREQ_START * CHARGE_FREQ_END), 10); // 指数カーブの中点は幾何平均
    expect(chargeFreq(-1)).toBe(CHARGE_FREQ_START);
    expect(chargeFreq(2)).toBeCloseTo(CHARGE_FREQ_END, 10);
    let prev = -Infinity;
    for (let r = 0; r <= 1.0001; r += 0.05) { const f = chargeFreq(r); expect(f).toBeGreaterThan(prev); prev = f; }
  });
  it('溜め音のゲインは CHARGE_GAIN の 0.7 倍→1 倍の範囲で単調', () => {
    expect(chargeGain(0)).toBeCloseTo(CHARGE_GAIN * 0.7, 10);
    expect(chargeGain(1)).toBeCloseTo(CHARGE_GAIN, 10);
    expect(chargeGain(-1)).toBeCloseTo(CHARGE_GAIN * 0.7, 10);
    expect(chargeGain(2)).toBeCloseTo(CHARGE_GAIN, 10);
    let prev = -Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) { const g = chargeGain(r); expect(g).toBeGreaterThan(prev); prev = g; }
  });
  it('破砕音は破壊数 0 で最小、CRUSH_MAX_TILES で最大に達し、それ以上は頭打ち(対数圧縮で単調)', () => {
    const p0 = crushParams(0);
    expect(p0.gain).toBe(CRUSH_GAIN_MIN);
    expect(p0.seconds).toBe(CRUSH_SECONDS_MIN);
    expect(p0.startHz).toBe(CRUSH_HZ_MIN);
    const pMax = crushParams(CRUSH_MAX_TILES);
    expect(pMax.gain).toBeCloseTo(CRUSH_GAIN_MAX, 10);
    expect(pMax.seconds).toBeCloseTo(CRUSH_SECONDS_MAX, 10);
    expect(pMax.startHz).toBeCloseTo(CRUSH_HZ_MAX, 10);
    const pHuge = crushParams(1_000_000);
    expect(pHuge.gain).toBeCloseTo(CRUSH_GAIN_MAX, 10);
    expect(pHuge.seconds).toBeCloseTo(CRUSH_SECONDS_MAX, 10);
    expect(pHuge.startHz).toBeCloseTo(CRUSH_HZ_MAX, 10);
    // 負数は 0 と同じ
    expect(crushParams(-5)).toEqual(p0);
    let prev = crushParams(0);
    for (const n of [1, 3, 10, 30, 100, 300, 600]) {
      const p = crushParams(n);
      expect(p.gain).toBeGreaterThan(prev.gain);
      expect(p.seconds).toBeGreaterThan(prev.seconds);
      expect(p.startHz).toBeGreaterThan(prev.startHz);
      prev = p;
    }
    // 小さい破壊でも音量・長さが下限を割り込まない
    const p1 = crushParams(1);
    expect(p1.gain).toBeGreaterThanOrEqual(CRUSH_GAIN_MIN);
    expect(p1.seconds).toBeGreaterThanOrEqual(CRUSH_SECONDS_MIN);
  });
});
