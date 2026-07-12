import { hash2 } from './noise';

export const ROOM_SIZE = 128;
export const DISTRICT_SIZE = 1024;
export const SECTOR_SIZE = 16384;
export const REGION_SIZE = 262144;

export const SYSTEMS = ['water', 'power', 'habitation', 'disposal', 'foundry'] as const;
export type System = (typeof SYSTEMS)[number];

/** 座標をセルサイズで床方向に割る(負座標対応) */
export function cellOf(coord: number, size: number): number {
  return Math.floor(coord / size);
}

/** セル座標+salt → [0,1) 決定論ハッシュ。level ごとに salt を変えて系列を分ける */
export function cellHash(seed: number, cx: number, cy: number, salt: number): number {
  return hash2(seed + salt * 1000, cx, cy);
}

/** 重み付き抽選。r∈[0,1)。決定論。 */
export function weighted<T>(table: { v: T; w: number }[], r: number): T {
  const total = table.reduce((s, e) => s + e.w, 0);
  let acc = 0;
  const target = r * total;
  for (const e of table) {
    acc += e.w;
    if (target < acc) return e.v;
  }
  return table[table.length - 1].v;
}

export interface Region {
  rx: number;
  ry: number;
  system: System;
}

const SYSTEM_TABLE = SYSTEMS.map((v) => ({ v, w: 1 }));

const regionCache = new Map<string, Region>();

export function regionAt(seed: number, x: number, y: number): Region {
  const rx = cellOf(x, REGION_SIZE);
  const ry = cellOf(y, REGION_SIZE);
  const key = `${seed},${rx},${ry}`;
  let r = regionCache.get(key);
  if (!r) {
    const system = weighted(SYSTEM_TABLE, cellHash(seed, rx, ry, 11));
    r = { rx, ry, system };
    regionCache.set(key, r);
  }
  return r;
}

/** 系統ごとの施設タイプ集合 */
export const FACILITY_BY_SYSTEM: Record<System, string[]> = {
  water: ['pump', 'filter', 'tank'],
  power: ['substation', 'battery', 'control'],
  habitation: ['dwelling', 'corridor', 'hall'],
  disposal: ['compactor', 'silo'],
  foundry: ['smelter', 'caster'],
};

export interface Sector {
  sx: number;
  sy: number;
  system: System;
  hubX: number; // セクター内相対 [0,SECTOR_SIZE)
  hubY: number;
}

const sectorCache = new Map<string, Sector>();

export function sectorAt(seed: number, x: number, y: number): Sector {
  const sx = cellOf(x, SECTOR_SIZE);
  const sy = cellOf(y, SECTOR_SIZE);
  const key = `${seed},${sx},${sy}`;
  let s = sectorCache.get(key);
  if (!s) {
    const system = regionAt(seed, x, y).system;
    const hubX = Math.floor(cellHash(seed, sx, sy, 21) * SECTOR_SIZE);
    const hubY = Math.floor(cellHash(seed, sx, sy, 22) * SECTOR_SIZE);
    s = { sx, sy, system, hubX, hubY };
    sectorCache.set(key, s);
  }
  return s;
}

export interface District {
  dx: number;
  dy: number;
  facilityType: string;
  state: 'active' | 'ruined' | 'sealed';
}

const STATE_TABLE = [
  { v: 'active' as const, w: 5 },
  { v: 'ruined' as const, w: 3 },
  { v: 'sealed' as const, w: 1 },
];

const districtCache = new Map<string, District>();

export function districtAt(seed: number, x: number, y: number): District {
  const dx = cellOf(x, DISTRICT_SIZE);
  const dy = cellOf(y, DISTRICT_SIZE);
  const key = `${seed},${dx},${dy}`;
  let d = districtCache.get(key);
  if (!d) {
    const system = regionAt(seed, x, y).system;
    const facilities = FACILITY_BY_SYSTEM[system];
    const facilityType =
      facilities[Math.min(facilities.length - 1, Math.floor(cellHash(seed, dx, dy, 31) * facilities.length))];
    const state = weighted(STATE_TABLE, cellHash(seed, dx, dy, 32));
    d = { dx, dy, facilityType, state };
    districtCache.set(key, d);
  }
  return d;
}

export interface Room {
  rmx: number;
  rmy: number;
  present: boolean;
  type: string;
  variantSeed: number;
  decay: number;
}

const roomCache = new Map<string, Room>();

export function roomAt(seed: number, x: number, y: number): Room {
  const rmx = cellOf(x, ROOM_SIZE);
  const rmy = cellOf(y, ROOM_SIZE);
  const key = `${seed},${rmx},${rmy}`;
  let r = roomCache.get(key);
  if (!r) {
    const d = districtAt(seed, x, y);
    const density = d.state === 'active' ? 0.6 : d.state === 'ruined' ? 0.4 : 0.2;
    const present = cellHash(seed, rmx, rmy, 41) < density;
    const type = present ? d.facilityType : '';
    const variantSeed = Math.floor(cellHash(seed, rmx, rmy, 42) * 0xffffff);
    const decay = present ? clamp01(cellHash(seed, rmx, rmy, 43) + (d.state === 'ruined' ? 0.3 : 0)) : 0;
    r = { rmx, rmy, present, type, variantSeed, decay };
    roomCache.set(key, r);
  }
  return r;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
