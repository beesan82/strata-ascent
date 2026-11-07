import { describe, expect, it } from 'vitest';
import {
  AUTO_EAT_THRESHOLD,
  initialSatiety,
  MAX_RATIONS,
  RATION_RESTORE,
  resetSatietyOnDeath,
  SATIETY_BIOME_MUL,
  satietyBiomeMulFor,
  SATIETY_MAX,
  SATIETY_ON_DEATH,
  satietyLevel,
  stepSatiety,
  type SatietyState,
} from './satiety';

const DT = 0.1;

/** moving(安全圏外・活動倍率 1.0)で seconds 秒ぶん進める(ステップ数で数え、浮動小数の誤差を避ける) */
function advance(state: SatietyState, seconds: number, opts: { safe?: boolean; still?: boolean; mul?: number } = {}): SatietyState {
  let s = state;
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    s = stepSatiety(s, { dt: DT, inSafeZone: opts.safe ?? false, still: opts.still ?? false, biomeMul: opts.mul }).state;
  }
  return s;
}

describe('initialSatiety(初期状態)', () => {
  it('満腹度 100、糧食 1 個で始まる(設計 §4)', () => {
    const s = initialSatiety();
    expect(s.value).toBe(SATIETY_MAX);
    expect(s.rations).toBe(1);
    expect(s.starveT).toBe(0);
  });
});

describe('stepSatiety(消耗)', () => {
  it('標準地区では約 12 分(720 秒)で 0 になる', () => {
    const s0: SatietyState = { value: 100, rations: 0, starveT: 0 };
    expect(advance(s0, 360).value).toBeCloseTo(50, 1);
    expect(advance(s0, 719).value).toBeGreaterThan(0);
    expect(advance(s0, 721).value).toBe(0);
  });

  it('安全圏では減らない', () => {
    const s0: SatietyState = { value: 80, rations: 0, starveT: 0 };
    expect(advance(s0, 600, { safe: true }).value).toBe(80);
  });

  it('静止中は 0.7 倍(720 秒で 70 だけ減る)', () => {
    const s0: SatietyState = { value: 100, rations: 0, starveT: 0 };
    expect(advance(s0, 720, { still: true }).value).toBeCloseTo(30, 1);
  });

  it('地区倍率が掛かる(段階 2 の接続点)', () => {
    let s: SatietyState = { value: 100, rations: 0, starveT: 0 };
    for (let t = 0; t < 360; t += DT) {
      s = stepSatiety(s, { dt: DT, inSafeZone: false, still: false, biomeMul: 2 }).state;
    }
    expect(s.value).toBeCloseTo(0, 1);
  });

  it('dt の分割で結果が一致する(1 秒刻みと 0.1 秒刻み)', () => {
    const s0: SatietyState = { value: 90, rations: 0, starveT: 0 };
    let coarse = s0;
    for (let t = 0; t < 120; t += 1) {
      coarse = stepSatiety(coarse, { dt: 1, inSafeZone: false, still: false }).state;
    }
    const fine = advance(s0, 120);
    expect(coarse.value).toBeCloseTo(fine.value, 6);
  });

  it('0 未満にはならない', () => {
    const s0: SatietyState = { value: 1, rations: 0, starveT: 0 };
    expect(advance(s0, 60).value).toBe(0);
  });
});

describe('satietyLevel(状態の境界)', () => {
  it('50 超は ok、50 以下は low、20 以下は critical、0 は starving', () => {
    expect(satietyLevel(100)).toBe('ok');
    expect(satietyLevel(50.1)).toBe('ok');
    expect(satietyLevel(50)).toBe('low');
    expect(satietyLevel(20.1)).toBe('low');
    expect(satietyLevel(20)).toBe('critical');
    expect(satietyLevel(0.1)).toBe('critical');
    expect(satietyLevel(0)).toBe('starving');
  });
});

describe('自動摂取', () => {
  it('20 以下になったら糧食を 1 個食べて +45 される', () => {
    const s0: SatietyState = { value: AUTO_EAT_THRESHOLD + 0.05, rations: 2, starveT: 0 };
    const r = stepSatiety(s0, { dt: 1, inSafeZone: false, still: false });
    expect(r.ateRation).toBe(true);
    expect(r.state.rations).toBe(1);
    expect(r.state.value).toBeCloseTo(AUTO_EAT_THRESHOLD + 0.05 - 100 / 720 + RATION_RESTORE, 4);
  });

  it('20 を超えている間は食べない', () => {
    const s0: SatietyState = { value: 60, rations: 2, starveT: 0 };
    const r = stepSatiety(s0, { dt: 1, inSafeZone: false, still: false });
    expect(r.ateRation).toBe(false);
    expect(r.state.rations).toBe(2);
  });

  it('1 回の摂取で 2 個は食べない(45 増えれば閾値を大きく超える)', () => {
    const s0: SatietyState = { value: 5, rations: 2, starveT: 0 };
    const r = stepSatiety(s0, { dt: DT, inSafeZone: false, still: false });
    expect(r.state.rations).toBe(1);
    // 0.1 秒ぶんの消耗を引いてから +45 される
    expect(r.state.value).toBeCloseTo(5 - (100 / 720) * DT + RATION_RESTORE, 4);
  });

  it('糧食が無ければ食べられない', () => {
    const s0: SatietyState = { value: 10, rations: 0, starveT: 0 };
    const r = stepSatiety(s0, { dt: DT, inSafeZone: false, still: false });
    expect(r.ateRation).toBe(false);
    expect(r.state.value).toBeLessThan(10);
  });

  it('0 になっても糧食があれば飢餓に入らず先に食べる', () => {
    const s0: SatietyState = { value: 0.05, rations: 1, starveT: 0 };
    const r = stepSatiety(s0, { dt: 1, inSafeZone: false, still: false });
    expect(r.state.value).toBeCloseTo(RATION_RESTORE, 4);
    expect(r.state.starveT).toBe(0);
    expect(r.hpDamage).toBe(0);
  });

  it('所持上限は MAX_RATIONS=2 の前提で state を作る(定数の固定)', () => {
    expect(MAX_RATIONS).toBe(2);
  });
});

describe('飢餓ダメージ', () => {
  const starving: SatietyState = { value: 0, rations: 0, starveT: 0 };

  it('30 秒の猶予の間は HP が減らない', () => {
    let s = starving;
    let dmg = 0;
    for (let t = 0; t < 29; t += DT) {
      const r = stepSatiety(s, { dt: DT, inSafeZone: false, still: false });
      s = r.state;
      dmg += r.hpDamage;
    }
    expect(dmg).toBe(0);
  });

  it('30 秒で 1 回目、その後は 20 秒ごとに減る', () => {
    // 100 秒で閾値 30/50/70/90 を跨ぐ = 4 回
    const r = stepSatiety(starving, { dt: 100, inSafeZone: false, still: false });
    expect(r.hpDamage).toBe(4);
    // dt 分割でも一致する
    let s = starving;
    let dmg = 0;
    for (let t = 0; t < 100; t += DT) {
      const step = stepSatiety(s, { dt: DT, inSafeZone: false, still: false });
      s = step.state;
      dmg += step.hpDamage;
    }
    expect(dmg).toBe(4);
  });

  it('安全圏でも 0 のままなら飢餓は進む(減らないのは満腹度そのものだけ)', () => {
    const r = stepSatiety(starving, { dt: 31, inSafeZone: true, still: true });
    expect(r.hpDamage).toBe(1);
  });

  it('食べれば starveT が戻り、猶予から数え直す', () => {
    const s0: SatietyState = { value: 0, rations: 0, starveT: 25 };
    const ate = stepSatiety({ ...s0, rations: 1 }, { dt: DT, inSafeZone: false, still: false });
    expect(ate.state.value).toBeGreaterThan(0);
    expect(ate.state.starveT).toBe(0);
  });
});

describe('resetSatietyOnDeath(死亡時)', () => {
  it('満腹度は 35 に戻り、糧食は保持、starveT は 0', () => {
    const s = resetSatietyOnDeath({ value: 0, rations: 2, starveT: 55 });
    expect(s.value).toBe(SATIETY_ON_DEATH);
    expect(s.value).toBe(35);
    expect(s.rations).toBe(2);
    expect(s.starveT).toBe(0);
  });
});

describe('地区消耗倍率(段階 2、設計 §4 の地区表)', () => {
  it('7 地区ぶんの倍率が設計表どおり', () => {
    expect(SATIETY_BIOME_MUL).toEqual({
      coldSteel: 1.0,
      habitation: 0.85,
      disposal: 1.05,
      waterVoid: 1.15,
      power: 1.0,
      foundry: 1.1,
      biomech: 1.25,
    });
    expect(satietyBiomeMulFor('biomech')).toBe(1.25);
    expect(satietyBiomeMulFor('habitation')).toBe(0.85);
  });

  it('生体異物区(×1.25)では 576 秒で 0 になる', () => {
    const s0: SatietyState = { value: 100, rations: 0, starveT: 0 };
    expect(advance(s0, 288, { mul: satietyBiomeMulFor('biomech') }).value).toBeCloseTo(50, 1);
    expect(advance(s0, 576, { mul: satietyBiomeMulFor('biomech') }).value).toBeCloseTo(0, 1);
  });

  it('居住区画(×0.85)では 720 秒でも 15 残る', () => {
    const s0: SatietyState = { value: 100, rations: 0, starveT: 0 };
    expect(advance(s0, 720, { mul: satietyBiomeMulFor('habitation') }).value).toBeCloseTo(15, 1);
  });

  it('倍率を掛けても安全圏では減らない', () => {
    const s0: SatietyState = { value: 100, rations: 0, starveT: 0 };
    expect(advance(s0, 720, { safe: true, mul: satietyBiomeMulFor('biomech') }).value).toBe(100);
  });
});
