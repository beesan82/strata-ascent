import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import { buildStructure, damageOpCount } from './catalog';
import { SYSTEMS } from '../../world/hierarchy';

const rng = () => makeRng(20260711, 3, 7);

describe('buildStructure(power)', () => {
  it('決定論: 同じ type/damage/seed は同じオペ列', () => {
    const a = buildStructure('power', 0.5, rng());
    const b = buildStructure('power', 0.5, rng());
    expect(a).toEqual(b);
  });

  it('非空のオペ列を返す', () => {
    expect(buildStructure('power', 0.3, rng()).ops.length).toBeGreaterThan(0);
  });

  it('損傷が上がるほど損傷オペ(gap+frame)は増える(単調非減少)', () => {
    const low = damageOpCount(buildStructure('power', 0.1, rng()));
    const mid = damageOpCount(buildStructure('power', 0.5, rng()));
    const high = damageOpCount(buildStructure('power', 0.9, rng()));
    expect(mid).toBeGreaterThanOrEqual(low);
    expect(high).toBeGreaterThanOrEqual(mid);
  });

  it('稼働灯(glow)は低損傷のみ出る', () => {
    const low = buildStructure('power', 0.1, rng()).ops.some((o) => o.t === 'glow');
    const high = buildStructure('power', 0.9, rng()).ops.some((o) => o.t === 'glow');
    expect(low).toBe(true);
    expect(high).toBe(false);
  });
});

describe('buildStructure(全系統)', () => {
  for (const sys of SYSTEMS) {
    it(`${sys}: 非空・決定論・損傷単調・低損傷のみglow`, () => {
      const mk = () => makeRng(42, 9, 1);
      const a = buildStructure(sys, 0.5, mk());
      const b = buildStructure(sys, 0.5, mk());
      expect(a).toEqual(b);
      expect(a.ops.length).toBeGreaterThan(0);
      const low = damageOpCount(buildStructure(sys, 0.1, mk()));
      const high = damageOpCount(buildStructure(sys, 0.9, mk()));
      expect(high).toBeGreaterThanOrEqual(low);
      expect(buildStructure(sys, 0.9, mk()).ops.some((o) => o.t === 'glow')).toBe(false);
    });
  }

  it('各系統は異なるオペ列を生む(全委譲バグの防止)', () => {
    const specs = SYSTEMS.map((sys) => JSON.stringify(buildStructure(sys, 0.5, makeRng(1, 2, 3))));
    expect(new Set(specs).size).toBe(SYSTEMS.length);
  });
});

describe('buildStructure(biomech)', () => {
  it('決定論・非空', () => {
    const a = buildStructure('biomech', 0.5, makeRng(7, 1, 2));
    const b = buildStructure('biomech', 0.5, makeRng(7, 1, 2));
    expect(a).toEqual(b);
    expect(a.ops.length).toBeGreaterThan(0);
  });

  it('損傷が上がるほど損傷オペ(gap+frame)は増える(単調非減少)', () => {
    const low = damageOpCount(buildStructure('biomech', 0.1, makeRng(7, 1, 2)));
    const high = damageOpCount(buildStructure('biomech', 0.9, makeRng(7, 1, 2)));
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('脈光(glow)は損傷に関わらず残る(まだ生きている不気味さ)', () => {
    expect(buildStructure('biomech', 0.1, makeRng(7, 1, 2)).ops.some((o) => o.t === 'glow')).toBe(true);
    expect(buildStructure('biomech', 0.9, makeRng(7, 1, 2)).ops.some((o) => o.t === 'glow')).toBe(true);
  });
});
