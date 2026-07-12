import { describe, expect, it } from 'vitest';
import { conduitAt, districtHub, hasConduit, networkTileAt, sectorTrunkAt, sectorTrunkTileAt, hasTrunk } from './network';
import { regionAt, sectorAt, DISTRICT_SIZE, REGION_SIZE, SECTOR_SIZE } from './hierarchy';
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
  it('全系統でコリドー上は role に応じた TILE(段階4)', () => {
    for (const sys of ['power', 'habitation', 'disposal', 'foundry'] as const) {
      let origin: { rwx: number; rwy: number } | null = null;
      for (let r = 0; r < 24 && !origin; r++) {
        for (const [rx, ry] of [[r, 0], [0, r], [r, -1], [-1, r], [r, r]] as const) {
          if (regionAt(42, rx * REGION_SIZE, ry * REGION_SIZE).system === sys) {
            origin = { rwx: rx * REGION_SIZE, rwy: ry * REGION_SIZE }; break;
          }
        }
      }
      if (!origin) continue;
      const bx = Math.floor(origin.rwx / DISTRICT_SIZE), by = Math.floor(origin.rwy / DISTRICT_SIZE);
      let sawConduit = false;
      for (let dyi = 0; dyi < 3 && !sawConduit; dyi++) {
        for (let dxi = 0; dxi < 3 && !sawConduit; dxi++) {
          for (let ly = 0; ly < DISTRICT_SIZE && !sawConduit; ly += 8) {
            for (let lx = 0; lx < DISTRICT_SIZE; lx += 8) {
              const wx = (bx + dxi) * DISTRICT_SIZE + lx, wy = (by + dyi) * DISTRICT_SIZE + ly;
              if (conduitAt(42, wx, wy) && networkTileAt(42, wx, wy) !== null) { sawConduit = true; break; }
            }
          }
        }
      }
      expect(sawConduit).toBe(true);
    }
  });

  it('水系統のコリドー上は role に応じた TILE、外は null', () => {
    const { rwx, rwy } = waterRegionOrigin(42);
    const kinds = new Set<number | null>();
    const bx = Math.floor(rwx / DISTRICT_SIZE), by = Math.floor(rwy / DISTRICT_SIZE);
    for (let dyi = 0; dyi < 3; dyi++) {
      for (let dxi = 0; dxi < 3; dxi++) {
        const dx = bx + dxi, dy = by + dyi;
        for (let ly = 0; ly < DISTRICT_SIZE; ly += 8) {
          for (let lx = 0; lx < DISTRICT_SIZE; lx += 8) {
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
  });
});

describe('hasTrunk(順不同ペア対称)', () => {
  it('A↔B と B↔A で同じ', () => {
    expect(hasTrunk(42, 3, 4, 4, 4)).toBe(hasTrunk(42, 4, 4, 3, 4));
  });
  it('接続あり/なしが両方出る', () => {
    let yes = 0, no = 0;
    for (let i = 0; i < 60; i++) { if (hasTrunk(42, i, 0, i + 1, 0)) yes++; else no++; }
    expect(yes).toBeGreaterThan(0); expect(no).toBeGreaterThan(0);
  });
});

describe('sectorTrunkAt', () => {
  it('決定論', () => {
    expect(sectorTrunkAt(42, 50000, -30000)).toEqual(sectorTrunkAt(42, 50000, -30000));
  });
  it('接続を持つセクターのハブ付近は幹線が通る', () => {
    for (let s = 0; s < 20; s++) {
      const hasAny = hasTrunk(42, s, 0, s + 1, 0) || hasTrunk(42, s, 0, s - 1, 0) ||
                     hasTrunk(42, s, 0, s, 1) || hasTrunk(42, s, 0, s, -1);
      if (!hasAny) continue;
      const sec = sectorAt(42, s * SECTOR_SIZE, 0);
      expect(sectorTrunkAt(42, s * SECTOR_SIZE + sec.hubX, sec.hubY)).not.toBeNull();
      return;
    }
    throw new Error('接続を持つセクターが見つからない');
  });
  it('幹線の両端一致(セクター境界を跨いで連続する点が存在)', () => {
    for (let s = 0; s < 20; s++) {
      if (!hasTrunk(42, s, 0, s + 1, 0)) continue;
      const edgeX = (s + 1) * SECTOR_SIZE;
      let meet = 0;
      for (let y = 0; y < SECTOR_SIZE; y += 4) {
        if (sectorTrunkAt(42, edgeX - 1, y) && sectorTrunkAt(42, edgeX, y)) meet++;
      }
      expect(meet).toBeGreaterThan(0);
      return;
    }
    throw new Error('東接続を持つセクターが見つからない');
  });
});

describe('sectorTrunkTileAt', () => {
  it('決定論、幹線上は role に応じた TILE、外は null', () => {
    // 接続を持つセクターのハブで幹線タイルが出る
    for (let s = 0; s < 20; s++) {
      const hasAny = hasTrunk(42, s, 0, s + 1, 0) || hasTrunk(42, s, 0, s - 1, 0) ||
                     hasTrunk(42, s, 0, s, 1) || hasTrunk(42, s, 0, s, -1);
      if (!hasAny) continue;
      const sec = sectorAt(42, s * SECTOR_SIZE, 0);
      const t = sectorTrunkTileAt(42, s * SECTOR_SIZE + sec.hubX, sec.hubY);
      expect([TILE.SOLID, TILE.AIR, TILE.LADDER]).toContain(t);
      expect(sectorTrunkTileAt(42, s * SECTOR_SIZE + sec.hubX, sec.hubY)).toBe(t);
      return;
    }
    throw new Error('接続セクターなし');
  });
});
