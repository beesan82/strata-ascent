import { describe, expect, it } from 'vitest';
import { BOSS_WINDUP_TIME } from '../entities/enemy';
import {
  windupPose,
  WINDUP_BLINK_GAIN_HZ,
  WINDUP_BLINK_START_HZ,
  WINDUP_HEAT_FROM,
  WINDUP_MAX_SHAKE_TILES,
  WINDUP_MAX_SINK_TILES,
} from './bossPose';

const T = BOSS_WINDUP_TIME; // 0.7 秒(数値は変えない決まり)

describe('windupPose', () => {
  it('進捗は phaseT / 0.7 で、範囲外は 0..1 に丸める', () => {
    expect(windupPose(0, 0).progress).toBe(0);
    expect(windupPose(T / 2, 0).progress).toBeCloseTo(0.5);
    expect(windupPose(T, 0).progress).toBe(1);
    expect(windupPose(T * 3, 0).progress).toBe(1);
    expect(windupPose(-1, 0).progress).toBe(0);
  });

  it('沈み込みは進捗の 2 乗で単調に増え、最大量に達する', () => {
    const sinks = [0, 0.25, 0.5, 0.75, 1].map((p) => windupPose(p * T, 0).sinkTiles);
    for (let i = 1; i < sinks.length; i++) expect(sinks[i]).toBeGreaterThan(sinks[i - 1]);
    expect(sinks[0]).toBe(0);
    expect(windupPose(T, 0).sinkTiles).toBeCloseTo(WINDUP_MAX_SINK_TILES);
    expect(windupPose(T / 2, 0).sinkTiles).toBeCloseTo(WINDUP_MAX_SINK_TILES * 0.25);
  });

  it('震えは進捗 0 で 0、振幅は p^2 × 最大量を超えない', () => {
    for (const t of [0, 0.3, 1.7, 42]) expect(windupPose(0, t).shakeTiles).toBe(0);
    for (const p of [0.25, 0.5, 0.75, 1]) {
      for (let t = 0; t < 2; t += 0.05) {
        const s = windupPose(p * T, t).shakeTiles;
        expect(Math.abs(s)).toBeLessThanOrEqual(WINDUP_MAX_SHAKE_TILES * p * p + 1e-9);
      }
    }
    // 終盤では実際に揺れる(符号が変わる時刻がある)
    const signs = new Set<number>();
    for (let t = 0; t < 1; t += 0.02) signs.add(Math.sign(windupPose(T, t).shakeTiles));
    expect(signs.has(1)).toBe(true);
    expect(signs.has(-1)).toBe(true);
  });

  it('点滅は開始直後に淡色、現行 10Hz 相当の周期で暗色と交互する', () => {
    expect(WINDUP_BLINK_START_HZ).toBe(10);
    expect(windupPose(0, 0).bodyColor).toBe('#c7d0ce');
    // 0.1 秒後は位相が 1 サイクルを超え、暗色側に倒れる
    expect(windupPose(0.1, 0).bodyColor).toBe('#5a3a24');
    // 0.2 秒後は 2 サイクルを超え、淡色側に戻る
    expect(windupPose(0.2, 0).bodyColor).toBe('#c7d0ce');
  });

  it('点滅は終盤ほど速い(同じ時間幅で位相の進みが大きい)', () => {
    // 前半 0.1 秒と後半(熱色固定の手前)0.1 秒で、本体色の切り替わり回数を比べる
    const flips = (from: number, to: number): number => {
      let n = 0;
      let prev = windupPose(from, 0).bodyColor;
      for (let t = from + 0.005; t <= to; t += 0.005) {
        const c = windupPose(t, 0).bodyColor;
        if (c !== prev) n++;
        prev = c;
      }
      return n;
    };
    const early = flips(0, 0.2);
    const late = flips(0.32, WINDUP_HEAT_FROM * T - 0.005);
    expect(late).toBeGreaterThan(early);
    expect(WINDUP_BLINK_GAIN_HZ).toBeGreaterThan(0);
  });

  it('p > 0.75 では点滅せず熱色に固定し、目は白くなる', () => {
    for (const p of [0.76, 0.85, 0.95, 1]) {
      const pose = windupPose(p * T, 0);
      expect(pose.bodyColor).toBe('#9a6d32');
      expect(pose.eyeColor).toBe('#c7d0ce');
    }
    // 境界未満では熱色固定にならない
    expect(windupPose(WINDUP_HEAT_FROM * T, 0).bodyColor).not.toBe('#9a6d32');
  });

  it('目の灯は終盤までは金、色はすべてパレット実在色だけ', () => {
    expect(windupPose(0, 0).eyeColor).toBe('#caa64a');
    expect(windupPose(T / 2, 0).eyeColor).toBe('#caa64a');
    const palette = new Set(['#c7d0ce', '#caa64a', '#9a6d32', '#5a3a24', '#3d2618', '#16202b', '#51728d']);
    for (let t = 0; t <= T; t += 0.01) {
      const pose = windupPose(t, t * 3);
      expect(palette.has(pose.bodyColor)).toBe(true);
      expect(palette.has(pose.eyeColor)).toBe(true);
    }
  });
});
