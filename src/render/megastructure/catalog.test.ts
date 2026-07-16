import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import { buildStructure, damageOpCount } from './catalog';

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
