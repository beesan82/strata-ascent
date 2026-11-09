import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import { interfaceBottom, interfaceTop } from '../world/interface';
import {
  BEAT_RANGE, beaconHum, CHARGE_FREQ_END, CHARGE_FREQ_START, CHARGE_GAIN, chargeFreq, chargeGain,
  CRUSH_GAIN_MAX, CRUSH_GAIN_MIN, CRUSH_HZ_MAX, CRUSH_HZ_MIN, CRUSH_MAX_TILES, CRUSH_SECONDS_MAX, CRUSH_SECONDS_MIN, crushParams,
  dbToGain, DRONE_TABLE, droneParams, footstepCrossed, HUM_RANGE, interfaceBeat,
  MASTER_DB, nearestPlateDistance, PULSE_DETUNE, pulseDetune, REVERB_BUCKETS, REVERB_MAX, REVERB_MIN, reverbBucket, reverbSeconds, reverbSecondsForBucket,
  LAND_GAIN_MAX, LAND_MIN_VY, landGain, LADDER_RUNG_STEP, rungCrossed,
  MILESTONE_NOTES, NEW_RECORD_NOTES, PICKUP_NOTES, pickupNotes,
  JINGLE_NOTE_SECONDS, PICKUP_MATERIAL_RATE, RESPAWN_FREQ, SECURE_NOTE_SECONDS, SECURE_NOTES, SECURE_SAMPLE_RATE,
  crushSampleGain, pickVariant, sampleRate,
  COMP_ATTACK, COMP_RATIO, COMP_THRESHOLD_DB, ROOM_IR_SECONDS, ROOM_WET_GAIN,
  CHARGE_SUB_END, CHARGE_SUB_START, chargeSubFreq,
  PULSE_SUB_END_HZ, PULSE_SUB_SECONDS, PULSE_SUB_START_HZ, ambientGain,
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
  it('パルスの pitch ばらしは決定論で、±PULSE_DETUNE の範囲に収まり、毎回同じにはならない', () => {
    for (let i = 0; i < 64; i++) {
      expect(pulseDetune(i)).toBe(pulseDetune(i)); // 同じ index では同じ値
      expect(pulseDetune(i)).toBeGreaterThanOrEqual(1 - PULSE_DETUNE);
      expect(pulseDetune(i)).toBeLessThanOrEqual(1 + PULSE_DETUNE);
    }
    const values = new Set(Array.from({ length: 12 }, (_, i) => pulseDetune(i)));
    expect(values.size).toBeGreaterThanOrEqual(8); // 連射で単調にならない程度にはばらつく
  });
  it('着地音のゲインは小さな落下では 0、落下速度で増えて LAND_GAIN_MAX で頭打ち', () => {
    expect(landGain(0)).toBe(0);
    expect(landGain(LAND_MIN_VY - 0.1)).toBe(0);
    expect(landGain(LAND_MIN_VY)).toBeGreaterThan(0);
    expect(landGain(25)).toBeCloseTo(LAND_GAIN_MAX, 10); // MAX_FALL
    expect(landGain(100)).toBeCloseTo(LAND_GAIN_MAX, 10);
    let prev = -1;
    for (let v = LAND_MIN_VY; v <= 25; v += 2) { const g = landGain(v); expect(g).toBeGreaterThan(prev); prev = g; }
  });
  it('梯子の段は LADDER_RUNG_STEP ごとの跨ぎで鳴る(足音の π 跨ぎと同じ形)', () => {
    expect(rungCrossed(0, LADDER_RUNG_STEP - 0.01)).toBe(false);
    expect(rungCrossed(0, LADDER_RUNG_STEP)).toBe(true);
    expect(rungCrossed(LADDER_RUNG_STEP, LADDER_RUNG_STEP * 2)).toBe(true);
    expect(rungCrossed(0.2, 0.3)).toBe(false);
    expect(rungCrossed(1, 1)).toBe(false);
  });
  it('取得音は種別ごとに異なる上昇 2 音で、未知の種別は既定に落ちる', () => {
    for (const kind of ['charge', 'heal', 'ration', 'material'] as const) {
      const notes = pickupNotes(kind);
      expect(notes).toBe(PICKUP_NOTES[kind]);
      expect(notes.length).toBe(2);
      expect(notes[1]).toBeGreaterThan(notes[0]); // 拾えた手応えとして上行
    }
    expect(pickupNotes('charge')).not.toEqual(pickupNotes('heal'));
    expect(pickupNotes('heal')).not.toEqual(pickupNotes('ration'));
    expect(pickupNotes('material')).not.toEqual(pickupNotes('charge'));
    expect(pickupNotes('material')).not.toEqual(pickupNotes('ration'));
    expect(pickupNotes('unknown')).toBe(PICKUP_NOTES.ration);
  });
  it('素材の取得は砲弾の素材を 1 未満のレートで鳴らし、確保の合図は短い上行 3 音(段階 A)', () => {
    expect(PICKUP_MATERIAL_RATE).toBeGreaterThan(0);
    expect(PICKUP_MATERIAL_RATE).toBeLessThan(1);
    expect(SECURE_NOTES.length).toBe(3);
    for (let i = 1; i < SECURE_NOTES.length; i++) {
      expect(SECURE_NOTES[i]).toBeGreaterThan(SECURE_NOTES[i - 1]);
    }
    // 復活点更新(440 Hz 単発)より高く始まり、節目のジングルより短い
    expect(SECURE_NOTES[0]).toBeGreaterThan(RESPAWN_FREQ);
    expect(SECURE_NOTE_SECONDS).toBeLessThan(JINGLE_NOTE_SECONDS);
    expect(SECURE_SAMPLE_RATE).toBeGreaterThan(1);
  });
  it('ジングルは節目が 3 音の上行、新記録はそれより長く高く終わる', () => {
    expect(MILESTONE_NOTES.length).toBe(3);
    for (let i = 1; i < MILESTONE_NOTES.length; i++) {
      expect(MILESTONE_NOTES[i]).toBeGreaterThan(MILESTONE_NOTES[i - 1]);
    }
    expect(NEW_RECORD_NOTES.length).toBeGreaterThan(MILESTONE_NOTES.length);
    for (let i = 1; i < NEW_RECORD_NOTES.length; i++) {
      expect(NEW_RECORD_NOTES[i]).toBeGreaterThan(NEW_RECORD_NOTES[i - 1]);
    }
    expect(NEW_RECORD_NOTES[NEW_RECORD_NOTES.length - 1])
      .toBeGreaterThan(MILESTONE_NOTES[MILESTONE_NOTES.length - 1]);
  });
  it('バリエーション選択は決定論の剰余で、負数でも範囲内に落ちる', () => {
    expect(pickVariant(0, 5)).toBe(0);
    expect(pickVariant(7, 5)).toBe(2);
    expect(pickVariant(-1, 5)).toBe(4);
    expect(pickVariant(3, 0)).toBe(0);
    for (let i = -20; i < 20; i++) {
      const v = pickVariant(i, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
    }
  });
  it('サンプルレートのばらしは ±spread に収まり、index で変わる', () => {
    for (let i = 0; i < 40; i++) {
      const r = sampleRate(1.15, i, 0.05);
      expect(r).toBeGreaterThanOrEqual(1.15 * 0.95);
      expect(r).toBeLessThanOrEqual(1.15 * 1.05);
    }
    expect(sampleRate(1, 1, 0.05)).not.toBe(sampleRate(1, 2, 0.05));
    expect(sampleRate(2, 0, 0)).toBe(2);
  });
  it('破砕のサンプル層ゲインは破壊数で単調に増え、上下限に収まる', () => {
    expect(crushSampleGain(0)).toBeCloseTo(0.25, 10);
    expect(crushSampleGain(CRUSH_MAX_TILES)).toBeCloseTo(0.8, 10);
    let prev = -1;
    for (const n of [0, 1, 10, 60, 120, 300, 600, 5000]) {
      const g = crushSampleGain(n);
      expect(g).toBeGreaterThanOrEqual(prev);
      prev = g;
    }
    expect(crushSampleGain(-5)).toBeCloseTo(0.25, 10);
  });
  it('環境ループのゲインは全バイオームにあり(実録が主役)、0.4〜0.8 の範囲', () => {
    for (const id of BIOME_IDS) {
      const g = ambientGain(id);
      expect(g).toBeGreaterThanOrEqual(0.4);
      expect(g).toBeLessThanOrEqual(0.8);
    }
    expect(ambientGain('power')).toBeGreaterThan(ambientGain('habitation'));
  });
  it('マスターのコンプレッサはリミッター寄り(高い比率・浅い敷居・速いアタック)', () => {
    expect(COMP_RATIO).toBeGreaterThanOrEqual(10);
    expect(COMP_THRESHOLD_DB).toBeGreaterThanOrEqual(-12);
    expect(COMP_THRESHOLD_DB).toBeLessThanOrEqual(-4);
    expect(COMP_ATTACK).toBeLessThanOrEqual(0.003);
  });
  it('部屋系リバーブは短く(0.1〜0.8 秒)、ホール系の最大より短く、wet は控えめ', () => {
    expect(ROOM_IR_SECONDS).toBeGreaterThan(0.1);
    expect(ROOM_IR_SECONDS).toBeLessThan(0.8);
    expect(ROOM_IR_SECONDS).toBeLessThan(REVERB_MAX);
    expect(ROOM_WET_GAIN).toBeGreaterThan(0);
    expect(ROOM_WET_GAIN).toBeLessThan(0.35);
  });
  it('溜めの深サブは比率で 30→55 Hz へ指数で単調に上がり、範囲外はクランプ', () => {
    expect(chargeSubFreq(0)).toBe(CHARGE_SUB_START);
    expect(chargeSubFreq(1)).toBeCloseTo(CHARGE_SUB_END, 10);
    expect(chargeSubFreq(-1)).toBe(CHARGE_SUB_START);
    expect(chargeSubFreq(2)).toBeCloseTo(CHARGE_SUB_END, 10);
    let prev = -Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) { const f = chargeSubFreq(r); expect(f).toBeGreaterThan(prev); prev = f; }
  });
  it('パルスのサブサンプは低域(200 Hz 未満)へ落ちる短い層で、連射間隔より短い', () => {
    expect(PULSE_SUB_START_HZ).toBeLessThan(200);
    expect(PULSE_SUB_END_HZ).toBeLessThan(PULSE_SUB_START_HZ);
    expect(PULSE_SUB_END_HZ).toBeGreaterThanOrEqual(30);
    expect(PULSE_SUB_SECONDS).toBeLessThan(1 / 6);
  });
});
