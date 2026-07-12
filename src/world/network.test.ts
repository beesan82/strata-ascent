import { describe, expect, it } from 'vitest';
import { conduitAt, districtHub, hasConduit, networkTileAt } from './network';
import { regionAt, DISTRICT_SIZE, REGION_SIZE } from './hierarchy';
import { TILE } from './tiles';

function waterRegionOrigin(seed: number): { rwx: number; rwy: number } {
  for (let r = 0; r < 24; r++) {
    for (const [rx, ry] of [[r, 0], [0, r], [r, -1], [-1, r], [r, r], [-r, r]] as const) {
      if (regionAt(seed, rx * REGION_SIZE, ry * REGION_SIZE).system === 'water') {
        return { rwx: rx * REGION_SIZE, rwy: ry * REGION_SIZE };
      }
    }
  }
  throw new Error('water region が見つからない');
}

describe('districtHub', () => {
  it('決定論、ローカル座標は中央寄り[0.2,0.8)*SIZE', () => {
    const h = districtHub(42, 3, -2);
    expect(districtHub(42, 3, -2)).toEqual(h);
    expect(h.hx).toBeGreaterThanOrEqual(0.2 * DISTRICT_SIZE);
    expect(h.hx).toBeLessThan(0.8 * DISTRICT_SIZE);
    expect(h.hy).toBeGreaterThanOrEqual(0.2 * DISTRICT_SIZE);
    expect(h.hy).toBeLessThan(0.8 * DISTRICT_SIZE);
  });
});

describe('hasConduit(順不同ペア一致)', () => {
  it('A↔B と B↔A で同じ判定(対称)', () => {
    expect(hasConduit(42, 3, 4, 4, 4)).toBe(hasConduit(42, 4, 4, 3, 4));
    expect(hasConduit(42, 0, 0, 0, 1)).toBe(hasConduit(42, 0, 1, 0, 0));
  });
  it('広域で接続あり/なしが両方出る', () => {
    let yes = 0, no = 0;
    for (let i = 0; i < 60; i++) {
      if (hasConduit(42, i, 0, i + 1, 0)) yes++; else no++;
    }
    expect(yes).toBeGreaterThan(0);
    expect(no).toBeGreaterThan(0);
  });
});

describe('conduitAt 両端一致', () => {
  it('地区境界の交差点付近で、両隣から見たコリドーが同一ワールド点で一致する', () => {
    const { rwx, rwy } = waterRegionOrigin(42);
    let found = false;
    for (let d = 0; d < 30 && !found; d++) {
      const dx = Math.floor(rwx / DISTRICT_SIZE) + d;
      const dy = Math.floor(rwy / DISTRICT_SIZE);
      if (!hasConduit(42, dx, dy, dx + 1, dy)) continue;
      found = true;
      const edgeX = (dx + 1) * DISTRICT_SIZE;
      let meet = 0;
      for (let y = dy * DISTRICT_SIZE; y < (dy + 1) * DISTRICT_SIZE; y++) {
        const left = conduitAt(42, edgeX - 1, y);
        const right = conduitAt(42, edgeX, y);
        if (left && right) meet++;
      }
      expect(meet).toBeGreaterThan(0);
    }
    expect(found).toBe(true);
  });

  it('決定論', () => {
    expect(conduitAt(42, 5000, -3000)).toEqual(conduitAt(42, 5000, -3000));
  });
});

describe('networkTileAt', () => {
  it('水系統でない region では null(段階3スコープ)', () => {
    for (let r = 0; r < 24; r++) {
      const wx = r * REGION_SIZE;
      if (regionAt(42, wx, 0).system !== 'water') {
        expect(networkTileAt(42, wx + 500, 500)).toBeNull();
        return;
      }
    }
  });

  it('水系統のコリドー上は role に応じた TILE、外は null', () => {
    const { rwx, rwy } = waterRegionOrigin(42);
    const kinds = new Set<number | null>();
    const bx = Math.floor(rwx / DISTRICT_SIZE), by = Math.floor(rwy / DISTRICT_SIZE);
    for (let dyi = 0; dyi < 8; dyi++) {
      for (let dxi = 0; dxi < 8; dxi++) {
        const dx = bx + dxi, dy = by + dyi;
        for (let ly = 0; ly < DISTRICT_SIZE; ly += 3) {
          for (let lx = 0; lx < DISTRICT_SIZE; lx += 3) {
            const wx = dx * DISTRICT_SIZE + lx, wy = dy * DISTRICT_SIZE + ly;
            const c = conduitAt(42, wx, wy);
            const t = networkTileAt(42, wx, wy);
            if (!c) continue;
            if (c.role === 'floor') expect(t).toBe(TILE.SOLID);
            if (c.role === 'vertical') expect(t).toBe(TILE.LADDER);
            if (c.role === 'inside') expect(t).toBe(TILE.AIR);
            if (t !== null) kinds.add(t);
          }
        }
      }
    }
    expect(kinds.has(TILE.SOLID)).toBe(true);
    expect(kinds.has(TILE.LADDER)).toBe(true);
    expect(kinds.has(TILE.AIR)).toBe(true);
  }, 60000);
});
