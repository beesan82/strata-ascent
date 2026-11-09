import { describe, expect, it } from 'vitest';
import { BIOME_IDS } from '../world/biomeCells';
import {
  AMBIENT_LOOPS, EAT_SAMPLES, FOOTSTEP_SAMPLES, HIT_SAMPLES, LADDER_SAMPLES, MINING_SAMPLES,
  PULSE_SAMPLES, SAMPLE_URLS, pickupSampleName,
} from './samples';

describe('audio samples table', () => {
  it('対応表の URL は全て空でなく、名前は一意', () => {
    const names = Object.keys(SAMPLE_URLS);
    expect(names.length).toBe(42);
    expect(new Set(names).size).toBe(names.length);
    for (const url of Object.values(SAMPLE_URLS)) {
      expect(typeof url).toBe('string');
      expect(url.length).toBeGreaterThan(0);
    }
  });
  it('バリエーション列は全て対応表に実在する素材だけを指す', () => {
    for (const list of [PULSE_SAMPLES, HIT_SAMPLES, FOOTSTEP_SAMPLES, LADDER_SAMPLES, EAT_SAMPLES, MINING_SAMPLES]) {
      expect(list.length).toBeGreaterThan(0);
      for (const name of list) expect(SAMPLE_URLS[name]).toBeDefined();
    }
  });
  it('取得音は種別で素材が変わり、未知の種別は糧食に落ちる', () => {
    expect(pickupSampleName('charge')).toBe('pickupCharge');
    expect(pickupSampleName('heal')).toBe('pickupHeal');
    expect(pickupSampleName('ration')).toBe('pickupRation');
    expect(pickupSampleName('unknown')).toBe('pickupRation');
  });
  it('環境ループは全バイオームに割り当てがあり、実在する素材を指す', () => {
    for (const id of BIOME_IDS) {
      expect(AMBIENT_LOOPS[id]).toBeDefined();
      expect(SAMPLE_URLS[AMBIENT_LOOPS[id]]).toBeDefined();
    }
    // 機械系と水域と標準は別の録音であること(地区の聞き分けの最低条件)
    expect(AMBIENT_LOOPS.coldSteel).not.toBe(AMBIENT_LOOPS.waterVoid);
    expect(AMBIENT_LOOPS.coldSteel).not.toBe(AMBIENT_LOOPS.habitation);
    expect(AMBIENT_LOOPS.waterVoid).not.toBe(AMBIENT_LOOPS.habitation);
  });
});
