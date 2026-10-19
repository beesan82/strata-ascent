import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import { interfaceBottom, interfaceTop } from '../world/interface';
import {
  BEAT_RANGE, beaconHum, dbToGain, DRONE_TABLE, droneParams, footstepCrossed, HUM_RANGE, interfaceBeat,
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
});
